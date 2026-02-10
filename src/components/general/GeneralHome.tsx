import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { RefreshCw } from "lucide-react";
import type { AppSettings, AudioDevice } from "@/types/settings";

interface GeneralHomeProps {
  settings: AppSettings;
  onUpdate: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onAutostartWarning?: (source: string | null) => void;
}

export function GeneralHome({ settings, onUpdate, onAutostartWarning }: GeneralHomeProps) {
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
    <Card>
      <CardHeader>
        <CardTitle>通用设置</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Label htmlFor="outputMode" className="shrink-0 w-20">输出方式</Label>
          <Select
            value={settings.outputMode}
            onValueChange={(v) => onUpdate("outputMode", v as AppSettings["outputMode"])}
          >
            <SelectTrigger id="outputMode" className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Clipboard">剪贴板粘贴</SelectItem>
              <SelectItem value="SimulateKeyboard">模拟键盘输入</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-4">
          <Label htmlFor="microphone" className="shrink-0 w-20">麦克风</Label>
          <Select
            value={settings.microphoneDevice || "default"}
            onValueChange={(v) => onUpdate("microphoneDevice", v === "default" ? "" : v)}
          >
            <SelectTrigger id="microphone" className="flex-1">
              <SelectValue placeholder="选择麦克风" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">系统默认</SelectItem>
              {devices.map((d) => (
                <SelectItem key={d.name} value={d.name}>
                  {d.name} {d.is_default ? "(默认)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={loadDevices} className="shrink-0 size-9">
            <RefreshCw className="size-4" />
          </Button>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <Label htmlFor="autoOutput">自动输出（识别完成后直接粘贴）</Label>
          <Switch
            id="autoOutput"
            checked={settings.autoOutput}
            onCheckedChange={(v) => onUpdate("autoOutput", v)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="autoStart">开机自启</Label>
          <div className="flex items-center gap-2">
            {settings.autoStart && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const result = await invoke<string | null>("cmd_check_autostart");
                    if (result) {
                      onAutostartWarning?.(result);
                    } else {
                      onAutostartWarning?.(null);
                      toast.success("自启动状态正常");
                    }
                  } catch {
                    onAutostartWarning?.(null);
                  }
                }}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
              >
                检测
              </button>
            )}
            <Switch
              id="autoStart"
              checked={settings.autoStart}
              onCheckedChange={(v) => onUpdate("autoStart", v)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
