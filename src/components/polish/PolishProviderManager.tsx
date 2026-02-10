import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Plug, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PolishProviderForm } from "./PolishProviderForm";
import type { PolishProvider } from "@/types/polish";

interface PolishProviderManagerProps {
  providers: PolishProvider[];
  onChange: (providers: PolishProvider[]) => void;
  selectedProviderId?: string;
}

export function PolishProviderManager({ providers, onChange, selectedProviderId }: PolishProviderManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<PolishProvider | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const openAddDialog = () => {
    setEditingProvider(null);
    setDialogOpen(true);
  };

  const openEditDialog = (provider: PolishProvider) => {
    setEditingProvider(provider);
    setDialogOpen(true);
  };

  const handleSave = (data: Omit<PolishProvider, "id">) => {
    if (editingProvider) {
      onChange(providers.map((p) => (p.id === editingProvider.id ? { ...p, ...data } : p)));
    } else {
      const newProvider: PolishProvider = { id: crypto.randomUUID(), ...data };
      onChange([...providers, newProvider]);
    }
    setDialogOpen(false);
  };

  const handleDelete = (id: string) => {
    onChange(providers.filter((p) => p.id !== id));
    setDeletingId(null);
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">供应商列表（OpenAI 兼容）</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={openAddDialog}
        >
          <Plus className="size-4 mr-1" />
          新建
        </Button>
      </div>

      {providers.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          暂无供应商，点击"新建"添加
        </p>
      )}

      {providers.map((provider) => (
        <Card key={provider.id}>
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium text-sm">
                  {provider.name}
                  {provider.id === selectedProviderId && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1.5">使用中</Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground truncate">{provider.baseUrl}</p>
                <p className="text-xs text-muted-foreground">模型: {provider.model}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={testingId === provider.id}
                  onClick={() => handleTestConnection(provider)}
                  title="测试连接"
                >
                  <Plug className={`size-3.5 ${testingId === provider.id ? "animate-pulse" : ""}`} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => {
                    const copy: PolishProvider = {
                      ...provider,
                      id: crypto.randomUUID(),
                      name: `${provider.name} (副本)`,
                    };
                    onChange([...providers, copy]);
                  }}
                  title="复制"
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => { openEditDialog(provider); setDeletingId(null); }}
                >
                  <Pencil className="size-3.5" />
                </Button>
                {deletingId === provider.id ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="text-xs"
                    onClick={() => handleDelete(provider.id)}
                    onBlur={() => setDeletingId(null)}
                  >
                    确认删除?
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => setDeletingId(provider.id)}
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
            <DialogTitle>{editingProvider ? "编辑供应商" : "新建供应商"}</DialogTitle>
            <DialogDescription>
              填写 OpenAI 兼容供应商的连接信息
            </DialogDescription>
          </DialogHeader>
          <PolishProviderForm
            key={editingProvider?.id ?? "__new__"}
            initial={editingProvider ?? undefined}
            onSave={handleSave}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
