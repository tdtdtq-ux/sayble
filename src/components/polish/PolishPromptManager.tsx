import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PolishPromptForm } from "./PolishPromptForm";
import type { PolishPrompt } from "@/types/polish";

interface PolishPromptManagerProps {
  prompts: PolishPrompt[];
  onChange: (prompts: PolishPrompt[]) => void;
}

export function PolishPromptManager({ prompts, onChange }: PolishPromptManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PolishPrompt | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isBuiltin = (id: string) => id.startsWith("builtin-");

  const openAddDialog = () => {
    setEditingPrompt(null);
    setDialogOpen(true);
  };

  const openEditDialog = (prompt: PolishPrompt) => {
    setEditingPrompt(prompt);
    setDialogOpen(true);
  };

  const handleSave = (data: Omit<PolishPrompt, "id">) => {
    if (editingPrompt) {
      onChange(prompts.map((p) => (p.id === editingPrompt.id ? { ...p, ...data } : p)));
    } else {
      const newPrompt: PolishPrompt = { id: crypto.randomUUID(), ...data };
      onChange([...prompts, newPrompt]);
    }
    setDialogOpen(false);
  };

  const handleDelete = (id: string) => {
    onChange(prompts.filter((p) => p.id !== id));
    setDeletingId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Prompt 模板列表</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={openAddDialog}
        >
          <Plus className="size-4 mr-1" />
          新建
        </Button>
      </div>

      {prompts.map((prompt) => (
        <Card key={prompt.id}>
          <CardContent>
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
                  onClick={() => { openEditDialog(prompt); setDeletingId(null); }}
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
          </CardContent>
        </Card>
      ))}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPrompt ? "编辑 Prompt" : "新建 Prompt"}</DialogTitle>
            <DialogDescription>
              {editingPrompt ? "修改 Prompt 模板内容" : "创建新的 Prompt 模板"}
            </DialogDescription>
          </DialogHeader>
          <PolishPromptForm
            key={editingPrompt?.id ?? "__new__"}
            initial={editingPrompt ?? undefined}
            onSave={handleSave}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
