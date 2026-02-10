import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { HotkeyRecorder } from "../HotkeyRecorder";
import type { AppSettings } from "@/types/settings";

interface HotkeySettingsProps {
  settings: AppSettings;
  onUpdate: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function HotkeySettings({ settings, onUpdate }: HotkeySettingsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>快捷键配置</CardTitle>
        <CardDescription>支持区分左右修饰键（左Ctrl / 右Ctrl 等）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>切换模式（按一次开始，再按一次停止）</Label>
          <HotkeyRecorder
            value={settings.toggleHotkey}
            onChange={(v) => onUpdate("toggleHotkey", v)}
          />
        </div>
        <Separator />
        <div className="space-y-2">
          <Label>长按模式（按住录音，松开停止）</Label>
          <HotkeyRecorder
            value={settings.holdHotkey}
            onChange={(v) => onUpdate("holdHotkey", v)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
