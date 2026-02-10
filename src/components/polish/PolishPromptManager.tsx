import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { PolishPrompt } from "@/types/polish";

interface PolishPromptManagerProps {
  prompts: PolishPrompt[];
  onChange: (prompts: PolishPrompt[]) => void;
}

export function PolishPromptManager({ prompts, onChange }: PolishPromptManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");

  const isBuiltin = (id: string) => id.startsWith("builtin-");

  const startEdit = (prompt: PolishPrompt) => {
    setEditingId(prompt.id);
    setEditName(prompt.name);
    setEditContent(prompt.content);
    setIsAdding(false);
    setDeletingId(null);
  };

  const startAdd = () => {
    setIsAdding(true);
    setEditingId(null);
    setEditName("");
    setEditContent("");
    setDeletingId(null);
  };

  const handleSaveEdit = (id: string) => {
    if (!editName.trim() || !editContent.trim()) return;
    onChange(
      prompts.map((p) =>
        p.id === id ? { ...p, name: editName.trim(), content: editContent.trim() } : p
      )
    );
    setEditingId(null);
  };

  const handleSaveNew = () => {
    if (!editName.trim() || !editContent.trim()) return;
    const newPrompt: PolishPrompt = {
      id: crypto.randomUUID(),
      name: editName.trim(),
      content: editContent.trim(),
    };
    onChange([...prompts, newPrompt]);
    setIsAdding(false);
  };

  const handleDelete = (id: string) => {
    onChange(prompts.filter((p) => p.id !== id));
    setDeletingId(null);
  };

  const canSave = editName.trim() && editContent.trim();

  const renderForm = (onSave: () => void) => (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-4">
        <Label className="shrink-0 w-16">名称</Label>
        <Input
          placeholder="如 口语转书面语"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="flex-1"
        />
      </div>
      <div className="space-y-2">
        <Label>Prompt 内容（使用 {"{{text}}"} 作为文本占位符）</Label>
        <textarea
          className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
          placeholder="请将以下文字润色...&#10;&#10;{{text}}"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setEditingId(null); setIsAdding(false); }}
        >
          取消
        </Button>
        <Button size="sm" onClick={onSave} disabled={!canSave}>
          保存
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Prompt 模板列表</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={startAdd}
          disabled={isAdding}
        >
          <Plus className="size-4 mr-1" />
          新建
        </Button>
      </div>

      {isAdding && (
        <Card>
          <CardContent className="pt-6">
            {renderForm(handleSaveNew)}
          </CardContent>
        </Card>
      )}

      {prompts.map((prompt) => (
        <Card key={prompt.id}>
          <CardContent className="pt-6">
            {editingId === prompt.id ? (
              renderForm(() => handleSaveEdit(prompt.id))
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{prompt.name}</p>
                    {isBuiltin(prompt.id) && (
                      <span className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">
                        内置
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                    {prompt.content}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => startEdit(prompt)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  {isBuiltin(prompt.id) ? null : deletingId === prompt.id ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="text-xs"
                      onClick={() => handleDelete(prompt.id)}
                      onBlur={() => setDeletingId(null)}
                    >
                      确认删除?
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => setDeletingId(prompt.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
