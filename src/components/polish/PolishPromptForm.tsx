import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { PolishPrompt } from "@/types/polish";

interface PolishPromptFormProps {
  initial?: PolishPrompt;
  onSave: (prompt: Omit<PolishPrompt, "id">) => void;
  onCancel: () => void;
}

export function PolishPromptForm({ initial, onSave, onCancel }: PolishPromptFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [content, setContent] = useState(initial?.content ?? "");

  const canSave = name.trim() && content.trim();

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      content: content.trim(),
    });
  };

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-4">
        <Label className="shrink-0 w-20">名称</Label>
        <Input
          placeholder="如 口语转书面语"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
      </div>
      <div className="space-y-2">
        <Label>Prompt 内容（识别文字会自动附加在末尾）</Label>
        <textarea
          className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
          placeholder="请将以下口语化的文字转换为书面语，只输出润色后的文字。"
          value={content}
          onChange={(e) => setContent(e.target.value)}
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
