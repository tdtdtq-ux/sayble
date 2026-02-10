import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AsrProviderCard } from "./voice/AsrProviderCard";
import { AsrProviderConfigForm } from "./voice/AsrProviderConfigForm";
import { builtinAsrProviders, type AsrSettings, type AsrProviderMeta } from "@/types/asr";

interface VoiceSettingsProps {
  settings: AsrSettings;
  onUpdate: (next: AsrSettings) => void;
}

export function VoiceSettings({ settings, onUpdate }: VoiceSettingsProps) {
  const [editingMeta, setEditingMeta] = useState<AsrProviderMeta | null>(null);

  const handleSaveConfig = (config: Record<string, string>) => {
    if (!editingMeta) return;
    onUpdate({
      ...settings,
      providers: {
        ...settings.providers,
        [editingMeta.type]: config,
      },
    });
    setEditingMeta(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>语音识别服务</CardTitle>
          <CardDescription>选择并配置 ASR 服务商</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">服务商列表</h3>
            {builtinAsrProviders.map((meta) => (
              <AsrProviderCard
                key={meta.type}
                meta={meta}
                config={settings.providers[meta.type] ?? {}}
                isSelected={settings.selectedProvider === meta.type}
                onSelect={(type) => onUpdate({ ...settings, selectedProvider: type })}
                onEdit={setEditingMeta}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editingMeta} onOpenChange={(open) => { if (!open) setEditingMeta(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>配置 {editingMeta?.name}</DialogTitle>
            <DialogDescription>
              填写 {editingMeta?.name} 的认证信息
            </DialogDescription>
          </DialogHeader>
          {editingMeta && (
            <AsrProviderConfigForm
              key={editingMeta.type}
              meta={editingMeta}
              initial={settings.providers[editingMeta.type] ?? {}}
              onSave={handleSaveConfig}
              onCancel={() => setEditingMeta(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
