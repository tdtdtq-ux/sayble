import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { HotkeyRecorder } from "./HotkeyRecorder";

interface AudioDevice {
  name: string;
  is_default: boolean;
}

interface AppSettings {
  appId: string;
  accessKey: string;
  language: string;
  autoPunctuation: boolean;
  outputMode: "Clipboard" | "SimulateKeyboard";
  microphoneDevice: string;
  autoStart: boolean;
  autoOutput: boolean;
  toggleHotkey: string;
  holdHotkey: string;
}

const defaultSettings: AppSettings = {
  appId: "",
  accessKey: "",
  language: "zh",
  autoPunctuation: true,
  outputMode: "Clipboard",
  microphoneDevice: "",
  autoStart: false,
  autoOutput: true,
  toggleHotkey: "右Ctrl",
  holdHotkey: "左Ctrl + Space",
};

export interface SettingsHandle {
  getRecordingParams: () => {
    appId: string;
    accessKey: string;
    microphoneDevice: string;
    outputMode: "Clipboard" | "SimulateKeyboard";
    autoOutput: boolean;
  };
}

interface SettingsProps {
  recording: boolean;
  onStartRecording: (settings: {
    appId: string;
    accessKey: string;
    microphoneDevice: string;
  }) => void;
  onStopRecording: () => void;
}

export const Settings = forwardRef<SettingsHandle, SettingsProps>(
  function Settings({ recording, onStartRecording, onStopRecording }, ref) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useImperativeHandle(ref, () => ({
    getRecordingParams: () => ({
      appId: settings.appId,
      accessKey: settings.accessKey,
      microphoneDevice: settings.microphoneDevice,
      outputMode: settings.outputMode,
      autoOutput: settings.autoOutput,
    }),
  }), [settings.appId, settings.accessKey, settings.microphoneDevice, settings.outputMode, settings.autoOutput]);

  useEffect(() => {
    loadDevices();
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const result = await invoke<AppSettings | null>("cmd_load_settings");
      if (result) {
        setSettings((prev) => ({ ...prev, ...result }));
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  };

  const loadDevices = async () => {
    try {
      const result = await invoke<AudioDevice[]>("cmd_list_audio_devices");
      setDevices(result);
    } catch (e) {
      console.error("Failed to load devices:", e);
    }
  };

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  const handleSave = async () => {
    try {
      await invoke("cmd_save_settings", { settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Failed to save:", e);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      if (!settings.appId || !settings.accessKey) {
        setTestResult("请先填写完整的 API 配置");
        return;
      }
      const msg = await invoke<string>("cmd_test_asr_connection", {
        appId: settings.appId,
        accessKey: settings.accessKey,
      });
      setTestResult(msg);
    } catch (e) {
      setTestResult(`测试失败: ${e}`);
    } finally {
      setTesting(false);
    }
  };

  const handleToggleRecording = () => {
    if (recording) {
      onStopRecording();
    } else {
      onStartRecording({
        appId: settings.appId,
        accessKey: settings.accessKey,
        microphoneDevice: settings.microphoneDevice,
      });
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">设置</h1>
          <p className="text-sm text-muted-foreground">配置 Voice Keyboard 的各项参数</p>
        </div>
        <Button
          variant={recording ? "destructive" : "default"}
          onClick={handleToggleRecording}
        >
          {recording ? "停止录音" : "开始录音"}
        </Button>
      </div>

      <Tabs defaultValue="api" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="api">API 配置</TabsTrigger>
          <TabsTrigger value="hotkey">快捷键</TabsTrigger>
          <TabsTrigger value="general">通用</TabsTrigger>
        </TabsList>

        <TabsContent value="api">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>火山引擎语音识别</CardTitle>
                  <CardDescription>配置火山引擎 ASR 服务的认证信息</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={testing}
                >
                  {testing ? "测试中..." : "测试连接"}
                </Button>
              </div>
              {testResult && (
                <p className="text-sm text-muted-foreground">{testResult}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="appId">App ID</Label>
                <Input
                  id="appId"
                  placeholder="输入 App ID"
                  value={settings.appId}
                  onChange={(e) => updateSetting("appId", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accessKey">Access Key</Label>
                <Input
                  id="accessKey"
                  type="password"
                  placeholder="输入 Access Key"
                  value={settings.accessKey}
                  onChange={(e) => updateSetting("accessKey", e.target.value)}
                />
              </div>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="language">识别语言</Label>
                <Select
                  value={settings.language}
                  onValueChange={(v) => updateSetting("language", v)}
                >
                  <SelectTrigger id="language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh">中文</SelectItem>
                    <SelectItem value="en">英文</SelectItem>
                    <SelectItem value="auto">自动检测</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="autoPunctuation">自动标点</Label>
                <Switch
                  id="autoPunctuation"
                  checked={settings.autoPunctuation}
                  onCheckedChange={(v) => updateSetting("autoPunctuation", v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hotkey">
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
                  onChange={(v) => updateSetting("toggleHotkey", v)}
                />
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>长按模式（按住录音，松开停止）</Label>
                <HotkeyRecorder
                  value={settings.holdHotkey}
                  onChange={(v) => updateSetting("holdHotkey", v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>通用设置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="outputMode">输出方式</Label>
                <Select
                  value={settings.outputMode}
                  onValueChange={(v) => updateSetting("outputMode", v as AppSettings["outputMode"])}
                >
                  <SelectTrigger id="outputMode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Clipboard">剪贴板粘贴</SelectItem>
                    <SelectItem value="SimulateKeyboard">模拟键盘输入</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="microphone">麦克风设备</Label>
                <Select
                  value={settings.microphoneDevice || "default"}
                  onValueChange={(v) => updateSetting("microphoneDevice", v === "default" ? "" : v)}
                >
                  <SelectTrigger id="microphone">
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
                <Button variant="ghost" size="sm" onClick={loadDevices}>
                  刷新设备列表
                </Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <Label htmlFor="autoOutput">自动输出（识别完成后直接粘贴）</Label>
                <Switch
                  id="autoOutput"
                  checked={settings.autoOutput}
                  onCheckedChange={(v) => updateSetting("autoOutput", v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="autoStart">开机自启</Label>
                <Switch
                  id="autoStart"
                  checked={settings.autoStart}
                  onCheckedChange={(v) => updateSetting("autoStart", v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="mt-6 flex justify-end">
        <Button onClick={handleSave}>
          {saved ? "已保存" : "保存设置"}
        </Button>
      </div>
    </div>
  );
});
