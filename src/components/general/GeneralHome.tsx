import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RefreshCw } from "lucide-react";
import type { AppSettings, AudioDevice } from "@/types/settings";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { HotkeyRecorder } from "../HotkeyRecorder";

export function GeneralHome() {
  const { appSettings, updateAppSetting, setAutostartWarning } = useSettingsStore();
  const [devices, setDevices] = useState<AudioDevice[]>([]);

  const loadDevices = async () => {
    try {
      const result = await invoke<AudioDevice[]>("cmd_list_audio_devices");
      setDevices(result);
    } catch (e) {
      console.error("Failed to load devices:", e);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  return (
    <div className="space-y-5">
      {/* 输出方式 */}
      <div className="flex items-center justify-between">
        <div>
          <Label>输出方式</Label>
          <p className="text-xs text-muted-foreground mt-0.5">识别结果的输出方法</p>
        </div>
        <Select
          value={appSettings.outputMode}
          onValueChange={(v) => updateAppSetting("outputMode", v as AppSettings["outputMode"])}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Clipboard">剪贴板粘贴</SelectItem>
            <SelectItem value="SimulateKeyboard">模拟键盘输入</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 麦克风 */}
      <div className="flex items-center justify-between">
        <div>
          <Label>麦克风</Label>
          <p className="text-xs text-muted-foreground mt-0.5">录音使用的输入设备</p>
        </div>
        <Select
          value={appSettings.microphoneDevice || "default"}
          onValueChange={(v) => updateAppSetting("microphoneDevice", v === "default" ? "" : v)}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="选择麦克风" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">系统默认</SelectItem>
            {devices.map((d) => (
              <SelectItem key={d.name} value={d.name}>
                {d.name} {d.is_default ? "(默认)" : ""}
              </SelectItem>
            ))}
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mt-1 border-t pt-2"
              onMouseDown={(e) => {
                e.preventDefault();
                loadDevices();
              }}
            >
              <RefreshCw className="size-3" />
              刷新设备列表
            </button>
          </SelectContent>
        </Select>
      </div>

      {/* 快捷键 */}
      <div className="flex items-center justify-between">
        <div>
          <Label>快捷键</Label>
          <p className="text-xs text-muted-foreground mt-0.5">按一次开始，再按一次停止</p>
        </div>
        <div className="w-48">
          <HotkeyRecorder
            value={appSettings.toggleHotkey}
            onChange={(v) => updateAppSetting("toggleHotkey", v)}
          />
        </div>
      </div>

      {/* 自动输出 */}
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="autoOutput">自动输出</Label>
          <p className="text-xs text-muted-foreground mt-0.5">识别完成后直接粘贴到光标处</p>
        </div>
        <Switch
          id="autoOutput"
          checked={appSettings.autoOutput}
          onCheckedChange={(v) => updateAppSetting("autoOutput", v)}
        />
      </div>

      {/* 开机自启 */}
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="autoStart">开机自启</Label>
          <p className="text-xs text-muted-foreground mt-0.5">系统启动时自动运行 Sayble</p>
        </div>
        <div className="flex items-center gap-2">
          {appSettings.autoStart && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const result = await invoke<string | null>("cmd_check_autostart");
                  if (result) {
                    setAutostartWarning(result);
                  } else {
                    setAutostartWarning(null);
                    toast.success("自启动状态正常");
                  }
                } catch {
                  setAutostartWarning(null);
                }
              }}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            >
              检测
            </button>
          )}
          <Switch
            id="autoStart"
            checked={appSettings.autoStart}
            onCheckedChange={(v) => updateAppSetting("autoStart", v)}
          />
        </div>
      </div>
    </div>
  );
}
