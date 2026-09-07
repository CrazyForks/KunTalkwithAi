#!/usr/bin/env python3
"""在 Linux 临时目录运行真实 Wrapper，不连接 VPS；每个测试仅拥有自己的进程会话。"""
import hashlib
import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

SOURCE = Path(sys.argv.pop(1)).resolve()


def process(pid):
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()
        if fields[0] in ("Z", "X"):
            return None
        return int(fields[3]), int(fields[19])  # session ID、start_ticks
    except (OSError, IndexError, ValueError):
        return None


class RuntimeCancelTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="everytalk-cancel-test-"))
        self.wrapper = self.root / "wrapper.sh"
        self.wrapper.write_text(SOURCE.read_text(), encoding="utf-8", newline="\n")
        self.wrapper.chmod(0o700)
        self.user_dir = self.root / "user"
        self.user_dir.mkdir()
        self.env = dict(os.environ, HOME=str(self.user_dir))
        self.runs = []
        self.services = []

    def tearDown(self):
        # 即使断言失败，也只回收本测试创建的会话；不匹配进程名、不清理其他目录。
        for session, _ in self.runs:
            for stat in Path("/proc").glob("[0-9]*/stat"):
                pid = int(stat.parent.name)
                observed = process(pid)
                if observed and observed[0] == session:
                    if process(pid) == observed:
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
        for service in self.services:
            if service.poll() is None:
                service.kill()
            service.wait(timeout=3)
        self.assertTrue(self.root.name.startswith("everytalk-cancel-test-"))
        shutil.rmtree(self.root)

    def wait_until(self, predicate, message, seconds=10):
        # 按就绪文件/进程状态推进，不靠固定长 sleep 猜执行时序。
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if predicate():
                return
            time.sleep(0.02)
        self.fail(message)

    def state(self, directory):
        return dict(line.split("=", 1) for line in (directory / "state").read_text().splitlines())

    def start(self, name, command, timeout=0, direct=False):
        execution_id = f"execution_{name}"
        runtime_id = f"run_{name}"
        digest = hashlib.sha256(command.encode()).hexdigest()
        if direct:
            workspace = self.user_dir / ".everytalk/workspaces/ws_test"
            (workspace / ".everytalk/runtime").mkdir(parents=True, exist_ok=True)
            (workspace / ".everytalk/executions").mkdir(exist_ok=True)
            directory = workspace / ".everytalk/executions" / execution_id
            runtime = workspace / ".everytalk/runtime" / runtime_id
            args = [str(runtime), str(directory), "--envelope-v2"]
            magic, cwd = "EVERYTALK_EXEC_V1", ""
            query = str(directory)
        else:
            directory = self.user_dir / ".everytalk/host-executions" / execution_id
            runtime = self.user_dir / ".everytalk/host-runtime" / runtime_id
            args = [runtime_id, execution_id, "--host-envelope-v2"]
            magic, cwd = "EVERYTALK_EXEC_HOST_V1", str(self.root)
            query = execution_id
        parts = [cwd.encode(), b"", command.encode(), b""]
        payload = (magic + "\n" + "".join(f"{len(p)}\n" for p in parts)).encode() + b"".join(parts)
        result = subprocess.run([str(self.wrapper), *args, str(timeout), digest], input=payload,
                                env=self.env, capture_output=True, timeout=10)
        self.assertEqual(0, result.returncode, result.stderr.decode())
        snapshot = self.state(directory)
        self.runs.append((int(snapshot["pid"]), int(snapshot["start_ticks"])))
        return directory, runtime, query, digest, direct

    def cancel(self, run, digest=None):
        _, _, query, expected_hash, direct = run
        mode = "--execution-cancel" if direct else "--host-execution-cancel"
        return subprocess.run([str(self.wrapper), query, "", mode, "0", digest or expected_hash],
                              env=self.env, capture_output=True, text=True, timeout=20)

    def assert_stopped(self, run):
        directory, runtime, *_ = run
        result = self.cancel(run)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("CANCELLED", self.state(directory)["status"], result.stdout)
        session = int(self.state(directory)["pid"])
        members = [p for p in Path("/proc").glob("[0-9]*/stat")
                   if (info := process(int(p.parent.name))) and info[0] == session]
        self.assertEqual([], members, "不能只停止主进程而留下子进程")
        self.assertFalse(runtime.exists(), "强杀后本次临时目录也应回收")

    def test_timeout_child_group_and_other_service(self):
        service = subprocess.Popen(["sleep", "120"], start_new_session=True)
        self.services.append(service)
        other = self.start("other", "sleep 120")
        artifact = self.root / "project.txt"
        artifact.write_text("用户文件不能删除")
        ready = self.root / "ready"
        # timeout 会创建第二个进程组；再让命令忽略 TERM，强制验证 KILL 分支。
        run = self.start("target", f"trap '' TERM; echo ready > {shlex.quote(str(ready))}; sleep 120", timeout=120)
        self.wait_until(ready.exists, "目标命令未就绪")
        self.assert_stopped(run)
        self.assertIsNone(service.poll(), "正常服务不能被停止")
        self.assertIsNotNone(process(int(self.state(other[0])["pid"])), "另一条命令必须继续")
        self.assertEqual("用户文件不能删除", artifact.read_text())

    def test_many_processes_use_bounded_scans_and_preserve_services(self):
        # 有限压力：100 个独立 sleep 服务 + 32 个当前命令子进程，不使用无界 fork。
        for _ in range(100):
            self.services.append(subprocess.Popen(["sleep", "120"], start_new_session=True))
        self.wrapper.write_text(self.wrapper.read_text().replace(
            "    collect_cancel_members() {\n",
            '    collect_cancel_members() {\n        printf "scan\\n" >> "$HOME/scans"\n',
        ))
        ready = self.root / "many-ready"
        run = self.start("many", f"trap '' TERM; i=0; while [ $i -lt 32 ]; do sleep 120 & i=$((i+1)); done; echo ready > {ready}; wait")
        self.wait_until(ready.exists, "32 个命令子进程未就绪")
        started = time.monotonic()
        self.assert_stopped(run)
        elapsed = time.monotonic() - started
        scans = len((self.user_dir / "scans").read_text().splitlines())
        self.assertLess(elapsed, 11, "停止预算不能随进程数量无限延长")
        self.assertLessEqual(scans, 6, "等待阶段不能不断扫描整台服务器")
        self.assertTrue(all(p.poll() is None for p in self.services))
        print(f"\nprocess-pressure: services=100 children=32 scans={scans} elapsed={elapsed:.2f}s", flush=True)

    def test_slow_scan_returns_unconfirmed_at_real_deadline(self):
        # 注入固定慢读取来模拟受压的 /proc；断言按真实截止时间退出，而非等待 70 轮。
        # 固定至少 40 个进程，使首轮扫描必定超过预算，避免依赖宿主机当时的进程数量。
        for _ in range(40):
            self.services.append(subprocess.Popen(["sleep", "120"], start_new_session=True))
        self.wrapper.write_text(self.wrapper.read_text().replace(
            '        for cancel_stat in /proc/[0-9]*/stat; do\n',
            '        for cancel_stat in /proc/[0-9]*/stat; do\n            sleep 0.25\n',
        ))
        run = self.start("slow_scan", "sleep 120")
        started = time.monotonic()
        result = self.cancel(run)
        elapsed = time.monotonic() - started
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("status=UNKNOWN\n", result.stdout)
        self.assertLess(elapsed, 11)
        self.assertFalse((run[0] / "cancel.complete").exists())
        self.assertIsNotNone(process(int(self.state(run[0])["pid"])))

    def test_concurrent_cancel_has_one_terminal_writer(self):
        ready = self.root / "concurrent-ready"
        run = self.start("concurrent", f"trap '' TERM; echo ready > {ready}; sleep 120")
        self.wait_until(ready.exists, "命令未就绪")
        args = [str(self.wrapper), run[2], "", "--host-execution-cancel", "0", run[3]]
        first = subprocess.Popen(args, env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.wait_until(lambda: (run[0] / "cancel.members").exists(), "首个取消请求尚未登记")
            second = self.cancel(run)
            self.assertEqual(75, second.returncode, second.stderr)
            self.assertFalse((run[0] / "cancel.complete").exists())
            # 查询不得在取消过程中改写状态；watch 的 event 和 status 也必须一致。
            before = (run[0] / "state").read_bytes()
            queried = subprocess.run([str(self.wrapper), run[2], "", "--host-watch-execution", "0", "0", "2048", run[3]],
                                     env=self.env, capture_output=True, text=True, timeout=3)
            self.assertEqual(0, queried.returncode, queried.stderr)
            self.assertIn("status=UNKNOWN\n", queried.stdout)
            self.assertIn("event_type=TERMINAL\n", queried.stdout)
            self.assertEqual(before, (run[0] / "state").read_bytes())
            out, err = first.communicate(timeout=15)
            self.assertEqual(0, first.returncode, err)
            self.assertIn("status=CANCELLED\n", out)
            terminal = (run[0] / "state").read_bytes()
            self.assertEqual(0, self.cancel(run).returncode)
            self.assertEqual(terminal, (run[0] / "state").read_bytes())
        finally:
            if first.poll() is None:
                first.kill()
            first.wait(timeout=3)

    def test_worker_cannot_overwrite_registered_cancellation(self):
        # 直接运行生产状态写入函数，覆盖 signal/normal-exit 两条路径共享的写保护。
        function = SOURCE.read_text().split("    write_v2_state() {", 1)[1].split("    print_v2_state() {", 1)[0]
        directory = self.root / "writer"
        directory.mkdir()
        (directory / "cancel.members").write_text("123 456\n")
        state = directory / "state"
        state.write_text("status=RUNNING\n")
        for mode in ("--managed-v2", "--host-managed-v2"):
            result = subprocess.run(["sh", "-s"], input=f'''set -eu
execution_dir={shlex.quote(str(directory))}
state_file="$execution_dir/state"
input_mode={mode}
write_v2_state() {{{function}
write_v2_state SUCCEEDED 0
write_v2_state CANCELLED 143
''', capture_output=True, text=True, timeout=3)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual("status=RUNNING\n", state.read_text())

    def test_parent_exits_but_stubborn_child_remains(self):
        ready = self.root / "child-ready"
        command = f"sh -c 'trap \"\" TERM; echo ready > {shlex.quote(str(ready))}; sleep 120' & wait"
        run = self.start("orphan", command)
        self.wait_until(ready.exists, "顽固子进程未就绪")
        self.assert_stopped(run)
        # 同一固定 ID 的重复取消不应改变目标范围或重新执行命令。
        self.assertEqual(0, self.cancel(run).returncode)

    def test_direct_workspace_and_bounded_cancelled_logs(self):
        ready = self.root / "log-ready"
        run = self.start("direct", f"head -c 1048576 /dev/zero; echo ready > {ready}; sleep 120", direct=True)
        self.wait_until(ready.exists, "日志未写完")
        self.assert_stopped(run)
        self.assertEqual(262144, (run[0] / "stdout.log").stat().st_size)
        self.assertTrue((run[0] / "state").exists())

    def test_wrong_request_identity_does_not_kill(self):
        run = self.start("identity", "sleep 120")
        result = self.cancel(run, "0" * 64)
        self.assertEqual(49, result.returncode)
        self.assertIsNotNone(process(int(self.state(run[0])["pid"])))
        self.assertTrue(run[1].exists())

    def test_changed_process_identity_is_not_killed(self):
        run = self.start("pid_identity", "sleep 120")
        original = self.state(run[0])
        state_path = run[0] / "state"
        state_path.write_text(state_path.read_text().replace(
            "start_ticks=" + original["start_ticks"], "start_ticks=1"))
        result = self.cancel(run)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("status=UNKNOWN\n", result.stdout)
        self.assertIsNotNone(process(int(original["pid"])))

    def test_pidfd_unavailable_never_falls_back_to_numeric_kill(self):
        run = self.start("no_pidfd", "sleep 120")
        # 只对测试副本模拟系统不支持；真实取消入口必须返回 UNKNOWN，不能改用 kill。
        self.wrapper.write_text(self.wrapper.read_text().replace(
            '    if not hasattr(os, "pidfd_open")', '    if True or not hasattr(os, "pidfd_open")'))
        result = self.cancel(run)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("status=UNKNOWN\n", result.stdout)
        self.assertIn("系统缺少 pidfd 支持", result.stderr)
        self.assertIsNotNone(process(int(self.state(run[0])["pid"])))
        self.assertFalse((run[0] / "cancel.complete").exists())
        self.assertTrue(run[1].exists(), "未确认退出不能提前删除输入文件")

    def test_process_name_with_spaces_and_parentheses(self):
        renamed = self.root / "wrapper (x).sh"
        self.wrapper.rename(renamed)
        self.wrapper = renamed
        run = self.start("comm_spaces", "sleep 120")
        self.assertIsNotNone(process(int(self.state(run[0])["pid"])))
        self.assert_stopped(run)

    def test_log_links_do_not_truncate_user_files(self):
        for hard_link in (False, True):
            run = self.start(f"links_{hard_link}", "sleep 120")
            user_file = self.root / f"user-log-{hard_link}"
            user_file.write_bytes(b"x" * 1048576)
            log = run[0] / "stdout.log"
            log.unlink()
            if hard_link:
                os.link(user_file, log)
            else:
                log.symlink_to(user_file)
            self.assert_stopped(run)
            self.assertEqual(1048576, user_file.stat().st_size)

    def test_cancel_retry_after_canceller_disconnect(self):
        ready = self.root / "retry-ready"
        run = self.start("retry", f"trap '' TERM; echo ready > {ready}; sleep 120", timeout=120)
        self.wait_until(ready.exists, "目标未就绪")
        canceller = subprocess.Popen([str(self.wrapper), run[2], "", "--host-execution-cancel", "0", run[3]],
                                     env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            self.wait_until(lambda: (run[0] / "cancel.members").exists(), "没有持久化取消目标")
        finally:
            canceller.kill()
            canceller.wait(timeout=3)
        # 被杀取消进程的短命子进程可能暂时继承锁，必须等待锁真正释放，而不是猜延时。
        self.wait_until(lambda: subprocess.run(
            ["flock", "-n", str(run[0] / "cancel.lock"), "true"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ).returncode == 0, "取消锁没有释放")
        self.assert_stopped(run)

    def test_runtime_mapping_cannot_delete_other_command(self):
        other = self.start("mapping_other", "sleep 120")
        ready = self.root / "mapping-ready"
        run = self.start("mapping", f"trap '' TERM; echo ready > {ready}; sleep 120")
        self.wait_until(ready.exists, "目标未就绪")
        # 模拟元数据损坏。必须反查 execution.id，不能删除其他命令的临时文件。
        (run[0] / "runtime.id").write_text(other[1].name)
        result = self.cancel(run)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("status=UNKNOWN\n", result.stdout)
        self.assertTrue((other[1] / "command.sh").exists())
        self.assertIsNotNone(process(int(self.state(other[0])["pid"])))

    def test_cancel_before_start_does_not_launch_late_command(self):
        command = "touch should-not-exist"
        digest = hashlib.sha256(command.encode()).hexdigest()
        result = subprocess.run([str(self.wrapper), "execution_early", "", "--host-execution-cancel", "0", digest],
                                env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(0, result.returncode, result.stderr)
        run = self.start("early", command)
        # 这个任务没有进程，不能把 pid=0 当作测试拥有的会话。
        self.runs.pop()
        self.assertEqual("CANCELLED", self.state(run[0])["status"])
        self.assertFalse((self.root / "should-not-exist").exists())

    def test_completed_command_is_not_cleaned_or_restarted(self):
        run = self.start("completed", "printf done")
        self.wait_until(lambda: self.state(run[0])["status"] == "SUCCEEDED", "命令未正常结束")
        result = self.cancel(run)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("SUCCEEDED", self.state(run[0])["status"])
        self.assertEqual("done", (run[0] / "stdout.log").read_text())
        self.assertFalse((run[0] / "cancel.members").exists())

    def test_detached_service_is_not_chased_across_sessions(self):
        ready = self.root / "detached-pid"
        service_command = f"echo $$ > {ready}; exec sleep 120"
        command = f"setsid sh -c {shlex.quote(service_command)} > {self.root}/service.log 2>&1 < /dev/null & sleep 120"
        run = self.start("detached", command)
        self.wait_until(ready.exists, "独立服务未就绪")
        service_pid = int(ready.read_text())
        service_identity = process(service_pid)
        self.assertIsNotNone(service_identity)
        self.runs.append(service_identity)
        self.assert_stopped(run)
        self.assertEqual(service_identity, process(service_pid), "不能追杀已脱离命令会话的服务")

    def test_shell_syntax_and_existing_runtime_regressions(self):
        for filename in ("runtime-wrapper.sh", "everytalk-containerctl.sh"):
            result = subprocess.run(["sh", "-n"], input=SOURCE.with_name(filename).read_text(),
                                    capture_output=True, text=True)
            self.assertEqual(0, result.returncode, result.stderr)
        self_test = Path(__file__).with_name("runtime-wrapper-self-test.sh")
        result = subprocess.run(["sh", "-s", "--", str(self.wrapper)], input=self_test.read_text(),
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def test_container_upgrade_installs_script_without_recreating_service(self):
        # Docker daemon 非必需：运行真实 Helper 函数，仅把 Docker 执行映射到隔离目录。
        # 不会写 /usr/local/bin，不会调用真实 docker。
        definitions = SOURCE.with_name("everytalk-containerctl.sh").read_text().split("\nrequire_root\n", 1)[0]
        container_bin = self.root / "container-bin"
        container_bin.mkdir()
        fake = self.root / "fake-docker.py"
        fake.write_text('''import json, os, subprocess, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ["TEST_DOCKER_CALLS"], "a") as log:
    log.write(json.dumps(args) + "\\n")
assert args.pop(0) == "exec", args
while args[0].startswith("-"):
    flag = args.pop(0)
    if flag == "--user": args.pop(0)
assert args.pop(0) == "test-container", args
args = [arg.replace("/usr/local/bin", os.environ["TEST_CONTAINER_BIN"]) for arg in args]
sys.exit(subprocess.run(args).returncode)
''')
        digest = hashlib.sha256(self.wrapper.read_bytes()).hexdigest()
        source_prefix = self.root / "runtime"
        shutil.copyfile(self.wrapper, f"{source_prefix}-{digest}")
        version_file = self.root / "version"
        version_file.write_text(digest + "\n")
        env = dict(self.env, TEST_CONTAINER_BIN=str(container_bin), TEST_DOCKER_CALLS=str(self.root / "docker-calls"))
        body = definitions + f'''
RUNTIME_WRAPPER_PATH={shlex.quote(str(source_prefix))}
RUNTIME_WRAPPER_VERSION_PATH={shlex.quote(str(version_file))}
name=test-container
docker() {{ python3 {shlex.quote(str(fake))} "$@"; }}
container_runtime
container_runtime
'''
        result = subprocess.run(["sh", "-s"], input=body, env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(0, result.returncode, result.stderr)
        installed = container_bin / f"everytalk-runtime-wrapper-{digest}"
        self.assertEqual(self.wrapper.read_bytes(), installed.read_bytes())
        self.assertEqual([], list(container_bin.glob(".everytalk-runtime.*")))

        # 再执行 ensure_workspace 的已有容器分支；任何 stop/rm/run 都让测试立即失败。
        body = definitions + f'''
workspace_path() {{ printf '%s' {shlex.quote(str(self.root / "workspace"))}; }}
target_user() {{ id -un; }}
ensure_network() {{ :; }}
runtime_wrapper_hash() {{ printf '%s' {digest}; }}
docker() {{
    case "$1" in
        container|update|start) return 0 ;;
        inspect)
            case "$3" in
                *com.everytalk.managed*) printf true ;;
                *com.everytalk.workspace*) printf ws_test ;;
                *) return 91 ;;
            esac ;;
        *) printf 'unexpected docker operation: %s\\n' "$*" >&2; return 92 ;;
    esac
}}
ensure_workspace ws_test
'''
        result = subprocess.run(["sh", "-s"], input=body, env=env, capture_output=True, text=True, timeout=10)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("container=everytalk-ws_test", result.stdout)

    @unittest.skipUnless(os.environ.get("EVERYTALK_DOCKER_CLI"), "真实 Docker 升级测试需指定 CLI")
    def test_real_docker_upgrade_preserves_existing_container_and_service(self):
        # 显式使用调用方提供的 Docker CLI，只创建/删除本测试带唯一标签的容器。
        cli = os.environ["EVERYTALK_DOCKER_CLI"]
        label = self.root.name
        name = "everytalk-" + label

        def docker(*args, **kwargs):
            return subprocess.run([cli, *args], capture_output=True, text=True, timeout=30, **kwargs)

        created = docker("run", "-d", "--init", "--network", "none", "--pids-limit", "256", "--memory", "256m",
                         "--name", name, "--label", f"everytalk.test={label}", "python:3.13-slim", "sleep", "120")
        self.assertEqual(0, created.returncode, created.stderr)
        container_id = created.stdout.strip()
        try:
            self.assertEqual(0, docker("exec", "-d", container_id, "sh", "-c",
                "echo $$ > /tmp/service.pid; exec sleep 120").returncode)
            self.wait_until(lambda: docker("exec", container_id, "test", "-s", "/tmp/service.pid").returncode == 0,
                            "真实容器服务未就绪")
            before = docker("inspect", "--format", "{{.Id}} {{.State.StartedAt}}", container_id).stdout
            identity = docker("exec", container_id, "sh", "-c", 'cat /proc/$(cat /tmp/service.pid)/stat').stdout
            digest = hashlib.sha256(self.wrapper.read_bytes()).hexdigest()
            prefix = self.root / "real-runtime"
            shutil.copyfile(self.wrapper, f"{prefix}-{digest}")
            version = self.root / "real-version"
            version.write_text(digest + "\n")
            definitions = SOURCE.with_name("everytalk-containerctl.sh").read_text().split("\nrequire_root\n", 1)[0]
            body = definitions + f'''
RUNTIME_WRAPPER_PATH={shlex.quote(str(prefix))}
RUNTIME_WRAPPER_VERSION_PATH={shlex.quote(str(version))}
name={shlex.quote(container_id)}
docker() {{ {shlex.quote(cli)} "$@"; }}
container_runtime
container_runtime
'''
            installed = subprocess.run(["sh", "-s"], input=body, capture_output=True, text=True, timeout=20)
            self.assertEqual(0, installed.returncode, installed.stderr)
            script = f"/usr/local/bin/everytalk-runtime-wrapper-{digest}"
            checked = docker("exec", container_id, "sha256sum", script)
            self.assertEqual(0, checked.returncode, checked.stderr)
            self.assertTrue(checked.stdout.startswith(digest))
            self.assertEqual(before, docker("inspect", "--format", "{{.Id}} {{.State.StartedAt}}", container_id).stdout)
            after = docker("exec", container_id, "sh", "-c", 'cat /proc/$(cat /tmp/service.pid)/stat').stdout
            # PID/start_ticks 不变，证明是原来的服务而非停止后重启的新进程。
            self.assertEqual(identity.split()[0], after.split()[0])
            self.assertEqual(identity.rsplit(") ", 1)[1].split()[19], after.rsplit(") ", 1)[1].split()[19])
        finally:
            owned = docker("inspect", "--format", '{{index .Config.Labels "everytalk.test"}}', container_id)
            self.assertEqual(label, owned.stdout.strip(), "拒绝删除无法确认归属的容器")
            removed = docker("rm", "-f", container_id)
            self.assertEqual(0, removed.returncode, removed.stderr)


class PidfdSignalTest(unittest.TestCase):
    """直接执行随 Wrapper 发布的代码，在精确检查点控制退出顺序，不等待 PID 自然复用。"""

    def setUp(self):
        code = SOURCE.read_text().split("<<'EVERYTALK_PIDFD'\n", 1)[1].split("\nEVERYTALK_PIDFD", 1)[0]
        namespace = {}
        exec(compile(code.rsplit("\ntry:\n", 1)[0], str(SOURCE), "exec"), namespace)
        self.send = namespace["signal_members"]
        self.root = tempfile.TemporaryDirectory(prefix="everytalk-pidfd-test-")
        self.members = Path(self.root.name) / "members"
        self.target = subprocess.Popen(["sleep", "120"], start_new_session=True)
        self.service = subprocess.Popen(["sleep", "120"], start_new_session=True)
        self.session, self.ticks = process(self.target.pid)
        self.members.write_text(f"{self.target.pid} {self.ticks}\n")

    def tearDown(self):
        for child in (self.target, self.service):
            if child.poll() is None:
                child.kill()
            child.wait(timeout=3)
        self.root.cleanup()

    def call_send(self):
        self.send(str(self.members), self.session, "KILL", int(time.monotonic() * 100) + 800, {os.getuid()})
        self.assertIsNone(self.service.poll(), "独立服务不能收到信号")

    def test_real_pidfd_stops_only_target_and_closes_handle(self):
        opened = []
        original = os.pidfd_open
        def capture(pid, flags):
            fd = original(pid, flags)
            opened.append(fd)
            return fd
        with mock.patch.object(os, "pidfd_open", side_effect=capture):
            self.call_send()
        self.assertEqual(-signal.SIGKILL, self.target.wait(timeout=3))
        self.assertEqual(1, len(opened))
        with self.assertRaises(OSError):
            os.fstat(opened[0])

    def test_exit_exactly_between_validation_and_signal(self):
        original = signal.pidfd_send_signal
        def exit_before_signal(fd, sig):
            # 正好在生产代码已验证身份、即将发信号时让原进程退出并回收。
            self.target.kill()
            self.target.wait(timeout=3)
            with self.assertRaises(ProcessLookupError):
                original(fd, sig)
            raise ProcessLookupError()
        with mock.patch.object(signal, "pidfd_send_signal", side_effect=exit_before_signal) as sent:
            self.call_send()
            sent.assert_called_once()

    def test_reused_pid_identity_is_rejected_after_open(self):
        self.members.write_text(f"{self.target.pid} {self.ticks + 1}\n")
        with mock.patch.object(signal, "pidfd_send_signal") as sent:
            self.call_send()
            sent.assert_not_called()
        self.assertIsNone(self.target.poll())

    def test_exit_after_open_before_identity_validation(self):
        original = os.pidfd_open
        def exit_after_open(pid, flags):
            fd = original(pid, flags)
            self.target.kill()
            self.target.wait(timeout=3)
            return fd
        with mock.patch.object(os, "pidfd_open", side_effect=exit_after_open), \
                mock.patch.object(signal, "pidfd_send_signal") as sent:
            self.call_send()
            sent.assert_not_called()

    def test_denied_pidfd_does_not_use_numeric_signal(self):
        with mock.patch.object(os, "pidfd_open", side_effect=PermissionError()), \
                mock.patch.object(os, "kill") as numeric_kill:
            with self.assertRaises(PermissionError):
                self.call_send()
            numeric_kill.assert_not_called()
        self.assertIsNone(self.target.poll())


if __name__ == "__main__":
    unittest.main(verbosity=2)
