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
        self.assertEqual("UNKNOWN", self.state(run[0])["status"])
        self.assertIsNotNone(process(int(original["pid"])))

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
        self.assertEqual("UNKNOWN", self.state(run[0])["status"])
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
