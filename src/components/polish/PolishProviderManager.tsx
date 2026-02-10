import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Plus, Trash2, Check, Plug, Eye, EyeOff } from "lucide-react";
import type { PolishProvider } from "@/types/polish";

interface PolishProviderManagerProps {
  providers: PolishProvider[];
  onChange: (providers: PolishProvider[]) => void;
  selectedProviderId: string;
  onSelectProvider: (id: string) => void;
}

export function PolishProviderManager({
  providers,
  onChange,
  selectedProviderId,
  onSelectProvider,
}: PolishProviderManagerProps) {
  const [activeId, setActiveId] = useState<string>(
    providers[0]?.id ?? ""
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeProvider = providers.find((p) => p.id === activeId);

  const updateProvider = (id: string, data: Partial<Omit<PolishProvider, "id">>) => {
    onChange(providers.map((p) => (p.id === id ? { ...p, ...data } : p)));
  };

  const startEdit = (field: string, value: string) => {
    setDraftValue(value);
    setEditingField(field);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const commitEdit = (field: string) => {
    if (activeProvider && draftValue.trim() && draftValue.trim() !== activeProvider[field as keyof PolishProvider]) {
      updateProvider(activeProvider.id, { [field]: draftValue.trim() });
    }
    setEditingField(null);
  };

  const handleCreate = () => {
    const newProvider: PolishProvider = {
      id: crypto.randomUUID(),
      name: "新供应商",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "",
      temperature: 0.7,
    };
    onChange([...providers, newProvider]);
    setActiveId(newProvider.id);
    setEditingField(null);
    requestAnimationFrame(() => {
      startEdit("name", newProvider.name);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    });
  };

  const handleDelete = (id: string) => {
    const idx = providers.findIndex((p) => p.id === id);
    const next = providers.filter((p) => p.id !== id);
    onChange(next);
    setDeletingId(null);
    if (activeId === id && next.length > 0) {
      const newIdx = Math.min(idx, next.length - 1);
      setActiveId(next[newIdx].id);
    }
  };

  const handleTestConnection = async (provider: PolishProvider) => {
    setTestingId(provider.id);
    try {
      const msg = await invoke<string>("cmd_test_polish_provider", {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
      });
      toast.success(msg);
    } catch (e) {
      toast.error(`${e}`);
    } finally {
      setTestingId(null);
    }
  };

  const renderField = (label: string, field: string, value: string, placeholder: string, isPassword = false) => (
    <div className="flex items-center gap-4">
      <Label className="shrink-0 w-24 text-muted-foreground">{label}</Label>
      {editingField === field ? (
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            type={isPassword && !showApiKey ? "password" : "text"}
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onBlur={() => commitEdit(field)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit(field);
              if (e.key === "Escape") setEditingField(null);
            }}
            className="flex-1"
          />
          {isPassword && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowApiKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          )}
        </div>
      ) : (
        <span
          className="flex-1 text-sm cursor-text hover:bg-muted/50 rounded px-2 py-1 transition-colors truncate"
          onClick={() => startEdit(field, value)}
        >
          {isPassword ? (value ? "••••••••" : <span className="text-muted-foreground">{placeholder}</span>) : (value || <span className="text-muted-foreground">{placeholder}</span>)}
        </span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between px-6 py-3 shrink-0">
        <h2 className="text-base font-semibold">LLM管理</h2>
        <Button variant="outline" size="sm" onClick={handleCreate}>
          <Plus className="size-4 mr-1" />
          新建
        </Button>
      </div>

      {/* 下方左右分栏 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧列表 */}
        <div className="w-48 shrink-0 overflow-y-auto custom-scrollbar space-y-1.5 pb-4 pl-6">
          {providers.map((provider) => (
            <button
              key={provider.id}
              onClick={() => setActiveId(provider.id)}
              className={`w-full text-left px-3 py-2 text-sm rounded-md border transition-colors ${
                activeId === provider.id
                  ? "border-primary bg-muted text-foreground"
                  : "border-border hover:border-primary/50 hover:bg-muted/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="block truncate font-medium">
                {provider.name}
              </span>
              <span className="block text-[11px] mt-0.5 min-h-[1em]">
                {provider.id === selectedProviderId ? (
                  <span className="bg-foreground text-background rounded px-1 py-0.5">使用中</span>
                ) : "\u00A0"}
              </span>
            </button>
          ))}
        </div>

        {/* 右侧详情 */}
        {activeProvider ? (
          <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar px-6 pb-6 space-y-3">
            {/* 名称 + 操作按钮 */}
            <div className="flex items-center gap-2">
              {editingField === "name" ? (
                <Input
                  ref={inputRef}
                  value={draftValue}
                  onChange={(e) => setDraftValue(e.target.value)}
                  onBlur={() => commitEdit("name")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit("name");
                    if (e.key === "Escape") setEditingField(null);
                  }}
                  className="text-lg font-semibold h-auto py-0.5 px-1.5 w-auto max-w-xs"
                />
              ) : (
                <h2
                  className="text-lg font-semibold cursor-text hover:bg-muted/50 rounded px-1.5 py-0.5 transition-colors"
                  onClick={() => startEdit("name", activeProvider.name)}
                >
                  {activeProvider.name}
                </h2>
              )}
              <div className="flex items-center gap-2 ml-auto">
                {activeProvider.id === selectedProviderId ? (
                  <Button variant="outline" size="sm" disabled>
                    <Check className="size-4 mr-1" />
                    使用中
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => onSelectProvider(activeProvider.id)}
                  >
                    使用该供应商
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testingId === activeProvider.id}
                  onClick={() => handleTestConnection(activeProvider)}
                >
                  <Plug className={`size-3.5 mr-1 ${testingId === activeProvider.id ? "animate-pulse" : ""}`} />
                  测试连接
                </Button>
                {deletingId === activeProvider.id ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(activeProvider.id)}
                    onBlur={() => setDeletingId(null)}
                  >
                    确认删除?
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeletingId(activeProvider.id)}
                  >
                    <Trash2 className="size-3.5 mr-1" />
                    删除
                  </Button>
                )}
              </div>
            </div>

            {/* 字段详情 */}
            <div className="space-y-3 bg-muted/50 rounded-md p-4">
              {renderField("API Base URL", "baseUrl", activeProvider.baseUrl, "如 https://api.deepseek.com/v1")}
              {renderField("API Key", "apiKey", activeProvider.apiKey, "输入 API Key", true)}
              {renderField("模型名称", "model", activeProvider.model, "如 deepseek-chat")}
              <div className="flex items-center gap-4">
                <Label className="shrink-0 w-24 text-muted-foreground">Temperature</Label>
                <div className="flex flex-1 items-center gap-3">
                  <Slider
                    min={0}
                    max={2}
                    step={0.1}
                    value={[activeProvider.temperature ?? 0.7]}
                    onValueChange={([v]) => updateProvider(activeProvider.id, { temperature: v })}
                    className="flex-1"
                  />
                  <span className="w-8 text-sm text-muted-foreground text-right">
                    {(activeProvider.temperature ?? 0.7).toFixed(1)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            暂无供应商，点击右上角新建
          </div>
        )}
      </div>
    </div>
  );
}
