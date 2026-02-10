import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PolishProviderForm } from "./PolishProviderForm";
import type { PolishProvider } from "@/types/polish";

interface PolishProviderManagerProps {
  providers: PolishProvider[];
  onChange: (providers: PolishProvider[]) => void;
}

export function PolishProviderManager({ providers, onChange }: PolishProviderManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleAdd = (data: Omit<PolishProvider, "id">) => {
    const newProvider: PolishProvider = { id: crypto.randomUUID(), ...data };
    onChange([...providers, newProvider]);
    setIsAdding(false);
  };

  const handleEdit = (id: string, data: Omit<PolishProvider, "id">) => {
    onChange(providers.map((p) => (p.id === id ? { ...p, ...data } : p)));
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    onChange(providers.filter((p) => p.id !== id));
    setDeletingId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">供应商列表</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setIsAdding(true); setEditingId(null); }}
          disabled={isAdding}
        >
          <Plus className="size-4 mr-1" />
          新建
        </Button>
      </div>

      {isAdding && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">新建供应商</CardTitle>
          </CardHeader>
          <CardContent>
            <PolishProviderForm
              onSave={handleAdd}
              onCancel={() => setIsAdding(false)}
            />
          </CardContent>
        </Card>
      )}

      {providers.length === 0 && !isAdding && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          暂无供应商，点击"新建"添加
        </p>
      )}

      {providers.map((provider) => (
        <Card key={provider.id}>
          {editingId === provider.id ? (
            <>
              <CardHeader>
                <CardTitle className="text-sm">编辑供应商</CardTitle>
              </CardHeader>
              <CardContent>
                <PolishProviderForm
                  initial={provider}
                  onSave={(data) => handleEdit(provider.id, data)}
                  onCancel={() => setEditingId(null)}
                />
              </CardContent>
            </>
          ) : (
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium text-sm">{provider.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{provider.baseUrl}</p>
                  <p className="text-xs text-muted-foreground">模型: {provider.model}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => { setEditingId(provider.id); setIsAdding(false); setDeletingId(null); }}
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
          )}
        </Card>
      ))}
    </div>
  );
}
