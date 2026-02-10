import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import type { PolishProvider } from "@/types/polish";

interface PolishProviderFormProps {
  initial?: PolishProvider;
  onSave: (provider: Omit<PolishProvider, "id">) => void;
  onCancel: () => void;
}

export function PolishProviderForm({ initial, onSave, onCancel }: PolishProviderFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [showApiKey, setShowApiKey] = useState(false);

  const canSave = name.trim() && baseUrl.trim() && apiKey.trim() && model.trim();

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
    });
  };

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-4">
        <Label className="shrink-0 w-20">名称</Label>
        <Input
          placeholder="如 DeepSeek"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
      </div>
      <div className="flex items-center gap-4">
        <Label className="shrink-0 w-20">API Base URL</Label>
        <Input
          placeholder="如 https://api.deepseek.com/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="flex-1"
        />
      </div>
      <div className="flex items-center gap-4">
        <Label className="shrink-0 w-20">API Key</Label>
        <div className="relative flex-1">
          <Input
            type={showApiKey ? "text" : "password"}
            placeholder="输入 API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="pr-9"
          />
          <button
            type="button"
            onClick={() => setShowApiKey((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Label className="shrink-0 w-20">模型名称</Label>
        <Input
          placeholder="如 deepseek-chat"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="flex-1"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!canSave}>
          保存
        </Button>
      </div>
    </div>
  );
}
