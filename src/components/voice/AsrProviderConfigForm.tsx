import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Eye, EyeOff } from "lucide-react";
import type { AsrProviderMeta, AsrProviderConfig } from "@/types/asr";

interface AsrProviderConfigFormProps {
  meta: AsrProviderMeta;
  initial: AsrProviderConfig;
  onSave: (config: AsrProviderConfig) => void;
  onCancel: () => void;
}

export function AsrProviderConfigForm({ meta, initial, onSave, onCancel }: AsrProviderConfigFormProps) {
  // 初始化时，为 select/switch 字段填充默认值
  const initialWithDefaults: AsrProviderConfig = { ...initial };
  for (const field of meta.fields) {
    if ((field.type === "select" || field.type === "switch") && initialWithDefaults[field.key] === undefined) {
      initialWithDefaults[field.key] = String(field.defaultValue ?? "");
    }
  }

  const [values, setValues] = useState<AsrProviderConfig>(initialWithDefaults);
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());

  const toggleVisibility = (key: string) => {
    setVisibleFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const canSave = meta.fields
    .filter((f) => f.required)
    .every((f) => values[f.key]?.trim());

  const handleSave = () => {
    if (!canSave) return;
    const trimmed: AsrProviderConfig = {};
    for (const field of meta.fields) {
      if (field.type === "select" || field.type === "switch") {
        trimmed[field.key] = values[field.key] ?? String(field.defaultValue ?? "");
      } else {
        trimmed[field.key] = (values[field.key] ?? "").trim();
      }
    }
    onSave(trimmed);
  };

  return (
    <div className="space-y-3 py-2">
      {meta.fields.map((field) => (
        <div key={field.key} className="flex items-center gap-4">
          <Label className="shrink-0 w-24">{field.label}</Label>
          {field.type === "password" ? (
            <div className="relative flex-1">
              <Input
                type={visibleFields.has(field.key) ? "text" : "password"}
                placeholder={field.placeholder}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => toggleVisibility(field.key)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {visibleFields.has(field.key) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          ) : field.type === "select" ? (
            <Select
              value={values[field.key] ?? String(field.defaultValue ?? "")}
              onValueChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
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
          ) : field.type === "switch" ? (
            <div className="flex-1 flex justify-end">
              <Switch
                checked={values[field.key] === "true"}
                onCheckedChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v ? "true" : "false" }))}
              />
            </div>
          ) : (
            <Input
              placeholder={field.placeholder}
              value={values[field.key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              className="flex-1"
            />
          )}
        </div>
      ))}
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
