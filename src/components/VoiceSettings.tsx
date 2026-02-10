import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Plug, Eye, EyeOff, ExternalLink } from "lucide-react";
import { builtinAsrProviders, type AsrProviderMeta, type AsrProviderType } from "@/types/asr";
import { useSettingsStore } from "@/stores/useSettingsStore";

export function VoiceSettings() {
  const { asrSettings, updateAsrSettings } = useSettingsStore();

  const [activeType, setActiveType] = useState<AsrProviderType>(
    builtinAsrProviders[0]?.type ?? ("" as AsrProviderType)
  );
  const [testingType, setTestingType] = useState<AsrProviderType | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeMeta = builtinAsrProviders.find((p) => p.type === activeType);
  const activeConfig = asrSettings.providers[activeType] ?? {};

  const updateConfig = (key: string, value: string) => {
    updateAsrSettings({
      ...asrSettings,
      providers: {
        ...asrSettings.providers,
        [activeType]: { ...activeConfig, [key]: value },
      },
    });
  };

  const startEdit = (key: string, value: string) => {
    setDraftValue(value);
    setEditingField(key);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const commitEdit = (key: string) => {
    if (draftValue.trim() !== (activeConfig[key] ?? "")) {
      updateConfig(key, draftValue.trim());
    }
    setEditingField(null);
  };

  const isConfigured = (meta: AsrProviderMeta): boolean => {
    const config = asrSettings.providers[meta.type] ?? {};
    return meta.fields
      .filter((f) => f.required)
      .every((f) => config[f.key]?.trim());
  };

  const handleTestConnection = async (meta: AsrProviderMeta) => {
    const config = asrSettings.providers[meta.type] ?? {};
    if (!isConfigured(meta)) {
      toast.error("请先配置认证信息");
      return;
    }
    setTestingType(meta.type);
    try {
      const msg = await invoke<string>("cmd_test_asr_connection", {
        providerType: meta.type,
        credentials: config,
      });
      toast.success(msg);
    } catch (err) {
      toast.error(`测试失败: ${err}`);
    } finally {
      setTestingType(null);
    }
  };

  const handleSelect = (meta: AsrProviderMeta) => {
    if (!isConfigured(meta)) {
      toast.error("请先配置认证信息");
      return;
    }
    updateAsrSettings({ ...asrSettings, selectedProvider: meta.type });
  };

  const renderField = (field: AsrProviderMeta["fields"][number]) => {
    const value = activeConfig[field.key] ?? field.defaultValue ?? "";

    if (field.type === "select") {
      return (
        <div key={field.key} className="flex items-center gap-4">
          <Label className="shrink-0 w-24 text-muted-foreground">{field.label}</Label>
          <Select
            value={value}
            onValueChange={(v) => updateConfig(field.key, v)}
          >
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    if (field.type === "switch") {
      return (
        <div key={field.key} className="flex items-center gap-4">
          <Label className="shrink-0 w-24 text-muted-foreground">{field.label}</Label>
          <div className="flex-1 flex">
            <Switch
              checked={value === "true"}
              onCheckedChange={(v) => updateConfig(field.key, v ? "true" : "false")}
            />
          </div>
        </div>
      );
    }

    const isPassword = field.type === "password";

    return (
      <div key={field.key} className="flex items-center gap-4">
        <Label className="shrink-0 w-24 text-muted-foreground">{field.label}</Label>
        {editingField === field.key ? (
          <div className="relative flex-1">
            <Input
              ref={inputRef}
              type={isPassword && !showPassword ? "password" : "text"}
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onBlur={() => commitEdit(field.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit(field.key);
                if (e.key === "Escape") setEditingField(null);
              }}
              className="flex-1"
            />
            {isPassword && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            )}
          </div>
        ) : (
          <span
            className="flex-1 text-sm cursor-text hover:bg-muted/50 rounded px-2 py-1 transition-colors truncate"
            onClick={() => startEdit(field.key, activeConfig[field.key] ?? "")}
          >
            {isPassword
              ? (value ? "••••••••" : <span className="text-muted-foreground">{field.placeholder}</span>)
              : (value || <span className="text-muted-foreground">{field.placeholder}</span>)}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between px-6 py-3 shrink-0">
        <h2 className="text-base font-semibold">ASR管理</h2>
      </div>

      {/* 下方左右分栏 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧列表 */}
        <div className="w-48 shrink-0 overflow-y-auto custom-scrollbar space-y-1.5 pb-4 pl-6">
          {builtinAsrProviders.map((meta) => (
            <button
              key={meta.type}
              onClick={() => setActiveType(meta.type)}
              className={`w-full text-left px-3 py-2 text-sm rounded-md border transition-colors ${
                activeType === meta.type
                  ? "border-primary bg-muted text-foreground"
                  : "border-border hover:border-primary/50 hover:bg-muted/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="block truncate font-medium">
                {meta.name}
              </span>
              <span className="block text-[11px] mt-0.5 min-h-[1em]">
                {asrSettings.selectedProvider === meta.type ? (
                  <span className="bg-foreground text-background rounded px-1 py-0.5">使用中</span>
                ) : !isConfigured(meta) ? (
                  <span className="text-muted-foreground">未配置</span>
                ) : "\u00A0"}
              </span>
            </button>
          ))}
        </div>

        {/* 右侧详情 */}
        {activeMeta ? (
          <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar px-6 pb-6 space-y-3">
            {/* 名称 + 操作按钮 */}
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold px-1.5 py-0.5">
                {activeMeta.name}
              </h2>
              <div className="flex items-center gap-2 ml-auto">
                {asrSettings.selectedProvider === activeMeta.type ? (
                  <Button variant="outline" size="sm" disabled>
                    <Check className="size-4 mr-1" />
                    使用中
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => handleSelect(activeMeta)}
                  >
                    使用该服务
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testingType === activeMeta.type}
                  onClick={() => handleTestConnection(activeMeta)}
                >
                  <Plug className={`size-3.5 mr-1 ${testingType === activeMeta.type ? "animate-pulse" : ""}`} />
                  测试连接
                </Button>
                {activeMeta.docUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openUrl(activeMeta.docUrl!)}
                  >
                    <ExternalLink className="size-3.5 mr-1" />
                    文档
                  </Button>
                )}
              </div>
            </div>

            {/* 描述 */}
            <p className="text-sm text-muted-foreground px-1.5">
              {activeMeta.description}
            </p>

            {/* 字段详情 */}
            <div className="space-y-3 bg-muted/50 rounded-md p-4">
              {activeMeta.fields.map((field) => renderField(field))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            暂无服务商
          </div>
        )}
      </div>
    </div>
  );
}
