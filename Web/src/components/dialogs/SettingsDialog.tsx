import React, { useEffect, useMemo, useState } from "react";
import { Dialog } from "../ui/Dialog";
import {
  Plus,
  Trash2,
  Edit2,
  Upload,
  Key,
  Server,
  ChevronDown,
  ChevronUp,
  Box,
  Check,
  RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AddConfigDialog } from "./AddConfigDialog";
import { ImportExportDialog } from "./ImportExportDialog";
import { StorageService } from "../../services/StorageService";
import { ImportExportService } from "../../services/ImportExportService";
import { AuthService } from "../../services/AuthService";
import { CloudSyncManager } from "../../services/CloudSyncManager";

import { type ApiConfig } from "../../db";
import { useLiveQuery } from "dexie-react-hooks";
import { ApiService } from "../../services/ApiService";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const INITIAL_CONFIGS: ApiConfig[] = [
  {
    id: "text_default_gemini",
    provider: "Gemini",
    name: "默认配置",
    baseUrl:
      import.meta.env.VITE_DEFAULT_TEXT_API_URL ||
      import.meta.env.VITE_GOOGLE_API_BASE_URL ||
      "https://generativelanguage.googleapis.com",
    apiKey: import.meta.env.VITE_DEFAULT_TEXT_API_KEY || "",
    models: import.meta.env.VITE_DEFAULT_TEXT_MODELS
      ? (import.meta.env.VITE_DEFAULT_TEXT_MODELS as string).split(",")
      : ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    channel: "Gemini",
    isDefault: true,
    modality: "TEXT",
  },
  {
    id: "text_openai",
    provider: "OpenAI",
    name: "OpenAI",
    baseUrl: "https://api.openai.com",
    apiKey: "",
    models: ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
    channel: "OpenAI兼容",
    isDefault: false,
    modality: "TEXT",
  },
];

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const [showAddConfig, setShowAddConfig] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ApiConfig | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiConfig | null>(null);
  const [modelEditTarget, setModelEditTarget] = useState<ApiConfig | null>(
    null
  );
  const [newModelId, setNewModelId] = useState("");

  const [isSignedIn, setIsSignedIn] = useState(AuthService.isSignedIn());
  const [authBusy, setAuthBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const googleBtnRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    setIsSignedIn(AuthService.isSignedIn());

    const clientId = (import.meta as any).env?.VITE_GOOGLE_WEB_CLIENT_ID as
      | string
      | undefined;
    if (!clientId) return;

    const w = window as any;
    let cleared = false;
    let intervalId: number | null = null;
    let timeoutId: number | null = null;

    const tryRender = (): boolean => {
      const hasGis = !!w?.google?.accounts?.id;
      if (!hasGis) return false;
      if (!googleBtnRef.current) return false;

      try {
        w.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (resp: any) => {
            const cred = resp?.credential;
            if (!cred) return;
            setAuthBusy(true);
            try {
              await AuthService.signInWithGoogleIdToken(cred);
              setIsSignedIn(true);
              alert("登录成功");
            } catch (e: any) {
              alert(`登录失败: ${e?.message ?? String(e)}`);
            } finally {
              setAuthBusy(false);
            }
          },
        });

        googleBtnRef.current.innerHTML = "";
        w.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "outline",
          size: "large",
          width: 260,
        });
        return true;
      } catch (e) {
        return true;
      }
    };

    if (!tryRender()) {
      intervalId = window.setInterval(() => {
        if (cleared) return;
        if (tryRender() && intervalId != null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }, 300);

      timeoutId = window.setTimeout(() => {
        if (intervalId != null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }, 6000);
    }

    return () => {
      cleared = true;
      if (intervalId != null) window.clearInterval(intervalId);
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [isOpen]);

  const handleSignOut = () => {
    AuthService.signOut();
    setIsSignedIn(false);
    alert("已退出登录");
  };

  const handleTestPull = async () => {
    setSyncBusy(true);
    try {
      const res = await CloudSyncManager.syncOnce();
      alert(`云同步完成\n推送变更=${res.pushed}\n拉取时间戳=${res.pulledNow}`);
    } catch (e: any) {
      alert(`sync/pull 失败: ${e?.message ?? String(e)}`);
    } finally {
      setSyncBusy(false);
    }
  };

  const liveConfigs = useLiveQuery(
    () =>
      isOpen
        ? StorageService.getAllApiConfigs("TEXT")
        : Promise.resolve([] as ApiConfig[]),
    [isOpen]
  );

  const configs = useMemo(() => liveConfigs ?? [], [liveConfigs]);

  const sortedConfigs = useMemo(() => {
    return [...configs].sort((a, b) => {
      // "Default" config (Built-in) always at top
      const isBuiltInA = a.id === "text_default_gemini";
      const isBuiltInB = b.id === "text_default_gemini";
      if (isBuiltInA !== isBuiltInB) return isBuiltInA ? -1 : 1;

      // Then sort by Provider
      const providerCompare = a.provider.localeCompare(b.provider);
      if (providerCompare !== 0) return providerCompare;

      // Then by Name
      return a.name.localeCompare(b.name);
    });
  }, [configs]);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const list = await StorageService.getAllApiConfigs("TEXT");

      // Force sync default config with env vars if present
      const defaultConfig = list.find((c) => c.id === "text_default_gemini");
      const envModelsStr = import.meta.env.VITE_DEFAULT_TEXT_MODELS;
      const envApiUrl = import.meta.env.VITE_DEFAULT_TEXT_API_URL;
      const envApiKey = import.meta.env.VITE_DEFAULT_TEXT_API_KEY;

      if (defaultConfig) {
        if ((import.meta as any).env?.DEV) {
          console.log(
            "[SettingsDialog] Syncing default config. Env models:",
            envModelsStr
          );
        }
        let needsUpdate = false;
        let newConfig = { ...defaultConfig };

        // Use env models OR hardcoded defaults if env is missing (to ensure user gets the update even without restart)
        const targetModels = envModelsStr
          ? (envModelsStr as string)
              .split(",")
              .map((m) => m.trim())
              .filter(Boolean)
          : [
              "gemini-3-flash-preview",
              "gemini-2.5-flash",
              "gemini-2.5-flash-lite",
            ];

        if (
          JSON.stringify(defaultConfig.models) !== JSON.stringify(targetModels)
        ) {
          newConfig.models = targetModels;
          needsUpdate = true;
        }
        if (envApiUrl && defaultConfig.baseUrl !== envApiUrl) {
          newConfig.baseUrl = envApiUrl;
          needsUpdate = true;
        }
        if (envApiKey && defaultConfig.apiKey !== envApiKey) {
          newConfig.apiKey = envApiKey;
          needsUpdate = true;
        }

        // Enforce Gemini channel for default config as per user request
        if (defaultConfig.channel !== "Gemini") {
          newConfig.channel = "Gemini";
          needsUpdate = true;
        }

        if (needsUpdate) {
          await StorageService.saveApiConfig(newConfig);
        }
      }

      if (list.length > 0) return;
      for (const c of INITIAL_CONFIGS) {
        await StorageService.saveApiConfig(c);
      }
    })();
  }, [isOpen]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    // If selectedId is null, select the active default initially
    if (sortedConfigs.length > 0 && selectedId === null) {
      const active = sortedConfigs.find((c) => c.isDefault);
      setSelectedId(active?.id ?? sortedConfigs[0].id);
    }
  }, [sortedConfigs, selectedId]);

  const handleSelect = async (cfg: ApiConfig) => {
    setSelectedId(cfg.id);
    await StorageService.setDefaultApiConfig(cfg.id, "TEXT");
  };

  const handleAddConfig = async (newConfig: {
    provider: string;
    address: string;
    key: string;
    channel: string;
    toolsJson?: string;
    models?: string[];
  }) => {
    const id = `text_${Date.now()}`;
    const cfg: ApiConfig = {
      id,
      provider: newConfig.provider,
      name: newConfig.provider,
      baseUrl: newConfig.address,
      apiKey: newConfig.key,
      models: newConfig.models || [],
      channel: newConfig.channel as ApiConfig["channel"],
      isDefault: false,
      modality: "TEXT",
      toolsJson: newConfig.toolsJson,
    };
    await StorageService.saveApiConfig(cfg);
  };

  const handleEditConfirm = async (newConfig: {
    provider: string;
    address: string;
    key: string;
    channel: string;
    toolsJson?: string;
    models?: string[];
  }) => {
    if (!editingConfig) return;
    const next: ApiConfig = {
      ...editingConfig,
      provider: newConfig.provider,
      name: newConfig.provider,
      baseUrl: newConfig.address,
      apiKey: newConfig.key,
      channel: newConfig.channel as ApiConfig["channel"],
      toolsJson: newConfig.toolsJson,
      models: newConfig.models || editingConfig.models,
    };
    await StorageService.saveApiConfig(next);
    setEditingConfig(null);
  };

  const handleFetchModelsForConfig = async (config: ApiConfig) => {
    try {
      const models = await ApiService.fetchModels({
        provider: config.provider,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        channel: config.channel,
      });
      if (models.length > 0) {
        await StorageService.saveApiConfig({ ...config, models });
        return true;
      }
      return false;
    } catch (e) {
      console.error("Failed to fetch models for config", config.name, e);
      return false;
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const wasDefault = !!deleteTarget.isDefault;
    await StorageService.deleteApiConfig(deleteTarget.id);
    setDeleteTarget(null);
    const list = await StorageService.getAllApiConfigs("TEXT");
    if (wasDefault && list.length > 0) {
      await StorageService.setDefaultApiConfig(list[0].id, "TEXT");
    }
  };

  const handleRemoveModel = async (cfg: ApiConfig, model: string) => {
    const nextModels = cfg.models.filter((m) => m !== model);
    await StorageService.saveApiConfig({ ...cfg, models: nextModels });
  };

  const handleAddModel = async () => {
    if (!modelEditTarget) return;
    const v = newModelId.trim();
    if (!v) return;
    const nextModels = modelEditTarget.models.includes(v)
      ? modelEditTarget.models
      : [...modelEditTarget.models, v];
    await StorageService.saveApiConfig({
      ...modelEditTarget,
      models: nextModels,
    });
    setModelEditTarget(null);
    setNewModelId("");
  };

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title="模型配置管理"
        maxWidth="max-w-3xl"
      >
        <div className="flex flex-col h-[650px] bg-[#09090b] text-zinc-100 relative">
          <div className="flex-1 overflow-y-auto px-6 custom-scrollbar pb-6 pt-6">
            <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-bold text-white">账号同步</div>
                  <div className="text-xs text-zinc-400">
                    登录后可使用云端同步（Web/Android 同账号共享数据）
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div
                    className={`text-xs font-bold ${
                      isSignedIn ? "text-emerald-400" : "text-zinc-400"
                    }`}
                  >
                    {isSignedIn ? "已登录" : "未登录"}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={!isSignedIn || authBusy}
                      onClick={handleSignOut}
                      className="px-3 py-2 rounded-lg text-xs font-bold bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
                    >
                      退出
                    </button>
                    <button
                      disabled={!isSignedIn || syncBusy}
                      onClick={handleTestPull}
                      className="px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                    >
                      测试同步
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-4">
                <div ref={googleBtnRef} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 mb-6">
              <button
                onClick={() => setShowAddConfig(true)}
                className="flex-1 flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-emerald-500/30 text-emerald-500 hover:text-emerald-400 py-3 rounded-xl transition-all font-bold active:scale-[0.98] group shadow-sm"
              >
                <div className="p-0.5 rounded-full bg-emerald-500/10 group-hover:bg-emerald-500/20 transition-colors">
                  <Plus size={18} strokeWidth={2.5} />
                </div>
                <span>添加新配置</span>
              </button>
              <button
                onClick={() => setShowImportExport(true)}
                className="flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-emerald-500/30 text-zinc-300 hover:text-white py-3 px-4 rounded-xl transition-all font-bold active:scale-[0.98] group shadow-sm"
              >
                <Upload size={18} strokeWidth={2.5} />
                <span>导入/导出</span>
              </button>
            </div>

            <div className="space-y-4">
              {sortedConfigs.map((config) => (
                <ConfigCard
                  key={config.id}
                  config={config}
                  isSelected={selectedId === config.id}
                  onSelect={() => handleSelect(config)}
                  onEdit={() => setEditingConfig(config)}
                  onDelete={() => setDeleteTarget(config)}
                  onAddModel={() => {
                    setModelEditTarget(config);
                    setNewModelId("");
                  }}
                  onRemoveModel={(model) => handleRemoveModel(config, model)}
                  onFetchModels={() => handleFetchModelsForConfig(config)}
                />
              ))}
              {sortedConfigs.length === 0 && (
                <div className="flex flex-col items-center justify-center h-[200px] text-zinc-500 border-2 border-dashed border-zinc-800 rounded-2xl bg-zinc-900/30 mt-4">
                  <Server size={48} className="mb-4 opacity-50" />
                  <p>暂无配置</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </Dialog>

      <AddConfigDialog
        isOpen={showAddConfig}
        onClose={() => setShowAddConfig(false)}
        onConfirm={handleAddConfig}
      />

      <AddConfigDialog
        isOpen={!!editingConfig}
        onClose={() => setEditingConfig(null)}
        onConfirm={handleEditConfirm}
        initialConfig={
          editingConfig
            ? {
                provider: editingConfig.provider,
                address: editingConfig.baseUrl,
                key: editingConfig.apiKey,
                channel: editingConfig.channel ?? "OpenAI兼容",
                toolsJson: (editingConfig as any).toolsJson,
              }
            : undefined
        }
        title="编辑配置"
        confirmText="保存"
      />

      <Dialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="删除配置"
        maxWidth="max-w-sm"
      >
        <div className="p-1">
          <p className="text-gray-300 mb-6">
            确定要删除该配置吗？此操作无法撤销。
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDeleteTarget(null)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10"
            >
              取消
            </button>
            <button
              onClick={handleDelete}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-900/20"
            >
              删除
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={!!modelEditTarget}
        onClose={() => setModelEditTarget(null)}
        title="添加模型"
        maxWidth="max-w-sm"
      >
        <div className="p-1">
          <input
            value={newModelId}
            onChange={(e) => setNewModelId(e.target.value)}
            placeholder="例如：gpt-4o"
            className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 mb-6"
            autoFocus
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setModelEditTarget(null)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10"
            >
              取消
            </button>
            <button
              onClick={handleAddModel}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20"
            >
              添加
            </button>
          </div>
        </div>
      </Dialog>

      <ImportExportDialog
        isOpen={showImportExport}
        onClose={() => setShowImportExport(false)}
        onImport={async (file) => {
          try {
            const text = await file.text();
            const result = await ImportExportService.importFromJson(text);
            alert(result.message);
          } catch (e) {
            const msg = e instanceof Error ? e.message : "导入失败: 未知错误";
            alert(msg);
          }
        }}
        onExport={async (includeHistory) => {
          try {
            await ImportExportService.exportToFile(includeHistory);
          } catch (e) {
            const msg = e instanceof Error ? e.message : "导出失败: 未知错误";
            alert(msg);
          }
        }}
      />
    </>
  );
};

interface ConfigCardProps {
  config: ApiConfig;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddModel: () => void;
  onRemoveModel: (model: string) => void;
  onFetchModels: () => Promise<boolean>;
}

const ConfigCard = ({
  config,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  onAddModel,
  onRemoveModel,
  onFetchModels,
}: ConfigCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  const handleFetch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFetching(true);
    await onFetchModels();
    setIsFetching(false);
  };

  return (
    <div
      onClick={onSelect}
      className={`relative overflow-hidden transition-all duration-200 group cursor-pointer border rounded-2xl ${
        isSelected
          ? "bg-emerald-950/20 border-emerald-500/50 ring-1 ring-emerald-500/30"
          : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
      }`}
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl transition-colors ${
                isSelected
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {config.isDefault ? <Box size={20} /> : <Server size={20} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3
                  className={`text-base font-bold transition-colors ${
                    isSelected ? "text-emerald-100" : "text-zinc-100"
                  }`}
                >
                  {config.name}
                </h3>
                {config.id === "text_default_gemini" && (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded border border-zinc-600">
                    DEFAULT
                  </span>
                )}
                {config.isDefault && config.id !== "text_default_gemini" && (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                    Active
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                {config.id !== "text_default_gemini" ? (
                  <div
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded border transition-colors ${
                      isSelected
                        ? "bg-emerald-950/30 border-emerald-500/20"
                        : "bg-zinc-950/50 border-zinc-800/50"
                    }`}
                  >
                    <Key
                      size={10}
                      className={`${
                        isSelected ? "text-emerald-400/70" : "text-zinc-500"
                      }`}
                    />
                    <span
                      className={`text-xs font-mono ${
                        isSelected ? "text-emerald-200/70" : "text-zinc-400"
                      }`}
                    >
                      {config.apiKey ? "已设置" : "未设置"}
                    </span>
                  </div>
                ) : (
                  <div
                    className={`flex items-center gap-1.5 text-xs ${
                      isSelected ? "text-emerald-300/80" : "text-zinc-500"
                    }`}
                  >
                    <Box size={10} />
                    <span>内置模型</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Edit/Delete (Not for Built-in) */}
            {config.id !== "text_default_gemini" && (
              <>
                <button
                  className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-lg transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                >
                  <Edit2 size={16} />
                </button>
                <button
                  className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}

            {/* Active Indicator (Checkmark) */}
            {config.isDefault && (
              <div className="p-2 text-emerald-500">
                <Check size={20} strokeWidth={2.5} />
              </div>
            )}
          </div>
        </div>

        {/* Models Grid */}
        <div
          className={`
            rounded-xl border p-3 transition-colors
            ${
              isSelected
                ? "bg-emerald-950/30 border-emerald-500/20"
                : "bg-zinc-950/50 border-zinc-800/50"
            }
          `}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex items-center justify-between mb-2 cursor-pointer select-none"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div
              className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wider ${
                isSelected ? "text-emerald-400/60" : "text-zinc-500"
              }`}
            >
              <Box size={12} />
              Models ({config.models.length})
            </div>
            <div className="flex items-center gap-2">
              {config.id !== "text_default_gemini" && (
                <>
                  <button
                    onClick={handleFetch}
                    className={`p-1 transition-colors ${
                      isSelected
                        ? "text-emerald-400/60 hover:text-emerald-300"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                    title="刷新模型列表"
                  >
                    <RefreshCw
                      size={14}
                      className={isFetching ? "animate-spin" : ""}
                    />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddModel();
                    }}
                    className={`p-1 transition-colors ${
                      isSelected
                        ? "text-emerald-400/60 hover:text-emerald-300"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                    title="添加模型"
                  >
                    <Plus size={14} />
                  </button>
                </>
              )}
              <button
                className={`transition-colors ${
                  isSelected
                    ? "text-emerald-400/60 hover:text-emerald-300"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {isExpanded ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-2 pt-1">
                  {config.models.map((model, idx) => (
                    <div
                      key={idx}
                      className={`
                        group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-sm transition-all
                        ${
                          isSelected
                            ? "bg-emerald-900/30 border-emerald-500/20 text-emerald-100 hover:border-emerald-500/40"
                            : "bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:border-zinc-600"
                        }
                      `}
                    >
                      <span className="font-mono text-xs">{model}</span>
                      {config.id !== "text_default_gemini" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveModel(model);
                          }}
                          className={`opacity-0 group-hover:opacity-100 p-0.5 rounded-full transition-all ${
                            isSelected
                              ? "hover:bg-emerald-800 text-emerald-400"
                              : "hover:bg-zinc-700 text-zinc-500 hover:text-red-400"
                          }`}
                        >
                          <XIcon size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                  {config.models.length === 0 && (
                    <div
                      className={`w-full text-center py-2 text-xs italic ${
                        isSelected ? "text-emerald-500/50" : "text-zinc-600"
                      }`}
                    >
                      No models configured
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

const XIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);
