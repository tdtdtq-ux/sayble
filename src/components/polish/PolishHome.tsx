import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PolishSettings } from "@/types/polish";

interface PolishHomeProps {
  settings: PolishSettings;
  onChange: (settings: PolishSettings) => void;
}

export function PolishHome({ settings, onChange }: PolishHomeProps) {
  const handleEnabledChange = (enabled: boolean) => {
    if (enabled) {
      if (settings.providers.length === 0) {
        toast.error("请先添加至少一个供应商");
        return;
      }
      if (!settings.selectedProviderId) {
        toast.error("请先选择一个供应商");
        return;
      }
      if (!settings.selectedPromptId) {
        toast.error("请先选择一个 Prompt 模板");
        return;
      }
    }
    onChange({ ...settings, enabled });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>润色设置</CardTitle>
        <CardAction>
          <Switch
            checked={settings.enabled}
            onCheckedChange={handleEnabledChange}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>供应商</Label>
          <Select
            value={settings.selectedProviderId || undefined}
            onValueChange={(v) => onChange({ ...settings, selectedProviderId: v })}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="选择供应商" />
            </SelectTrigger>
            <SelectContent>
              {settings.providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label>Prompt 模板</Label>
          <Select
            value={settings.selectedPromptId || undefined}
            onValueChange={(v) => onChange({ ...settings, selectedPromptId: v })}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="选择 Prompt" />
            </SelectTrigger>
            <SelectContent>
              {settings.prompts.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
