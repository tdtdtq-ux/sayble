import { Label } from "@/components/ui/label";
import { HotkeyRecorder } from "../HotkeyRecorder";
import { useSettingsStore } from "@/stores/useSettingsStore";

export function HotkeySettings() {
  const { appSettings, updateAppSetting } = useSettingsStore();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">快捷键</h2>
        <p className="text-sm text-muted-foreground mt-1">支持区分左右修饰键（左Ctrl / 右Ctrl 等）</p>
      </div>

      <div className="space-y-2">
        <Label>切换模式</Label>
        <p className="text-xs text-muted-foreground">按一次开始录音，再按一次停止</p>
        <HotkeyRecorder
          value={appSettings.toggleHotkey}
          onChange={(v) => updateAppSetting("toggleHotkey", v)}
        />
      </div>
    </div>
  );
}
