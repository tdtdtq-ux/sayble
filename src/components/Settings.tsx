import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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
  resourceId: string;
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
  resourceId: "volc.bigasr.sauc.duration",
  language: "zh",
  autoPunctuation: true,
  outputMode: "Clipboard",
  microphoneDevice: "",
  autoStart: false,
  autoOutput: true,
  toggleHotkey: "右Ctrl",
  holdHotkey: "左Ctrl + Space",
};

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [recording, setRecording] = useState(false);
  const [asrText, setAsrText] = useState("");
  const [asrStatus, setAsrStatus] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    loadDevices();
    loadSettings();
    return () => {
      unlistenRef.current?.();
    };
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
      if (!settings.appId || !settings.accessKey || !settings.resourceId) {
        setTestResult("请先填写完整的 API 配置");
        return;
      }
      const msg = await invoke<string>("cmd_test_asr_connection", {
        appId: settings.appId,
        accessKey: settings.accessKey,
        resourceId: settings.resourceId,
      });
      setTestResult(msg);
    } catch (e) {
      setTestResult(`测试失败: ${e}`);
    } finally {
      setTesting(false);
    }
  };

  const handleToggleRecording = async () => {
    if (recording) {
      try {
        await invoke("cmd_stop_recording");
        setRecording(false);
        setAsrStatus("已停止录音，等待识别结果...");
      } catch (e) {
        setAsrStatus(`停止失败: ${e}`);
      }
    } else {
      if (!settings.appId || !settings.accessKey || !settings.resourceId) {
        setAsrStatus("请先在 API 配置 Tab 填写完整的认证信息");
        return;
      }
      try {
        setAsrText("");
        setAsrStatus(null);
        // 先注册 ASR 事件监听
        unlistenRef.current?.();
        const unlisten = await listen<{ PartialResult?: string; FinalResult?: string; Error?: string; Connected?: null; Disconnected?: null }>("asr-event", (event) => {
          const payload = event.payload;
          if (typeof payload === "string") {
            // 简单字符串事件如 "Connected"
            if (payload === "Connected") setAsrStatus("ASR 已连接");
            else if (payload === "Disconnected") {
              setAsrStatus("ASR 已断开");
              setRecording(false);
            }
          } else if (payload && typeof payload === "object") {
            if ("PartialResult" in payload && payload.PartialResult) {
              setAsrText(payload.PartialResult);
              setAsrStatus("识别中...");
            } else if ("FinalResult" in payload && payload.FinalResult) {
              setAsrText(payload.FinalResult);
              setAsrStatus("识别完成");
              setRecording(false);
            } else if ("Error" in payload && payload.Error) {
              setAsrStatus(`错误: ${payload.Error}`);
              setRecording(false);
            } else if ("Connected" in payload) {
              setAsrStatus("ASR 已连接");
            } else if ("Disconnected" in payload) {
              setAsrStatus("ASR 已断开");
              setRecording(false);
            }
          }
        });
        unlistenRef.current = unlisten;

        await invoke("cmd_start_recording", {
          appId: settings.appId,
          accessKey: settings.accessKey,
          resourceId: settings.resourceId,
          deviceName: settings.microphoneDevice,
        });
        setRecording(true);
        setAsrStatus("录音中...");
      } catch (e) {
        setAsrStatus(`启动失败: ${e}`);
      }
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">设置</h1>
        <p className="text-sm text-muted-foreground">配置 Voice Keyboard 的各项参数</p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>语音识别测试</CardTitle>
          <CardDescription>点击按钮开始录音，说完后点击停止，查看识别结果</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Button
              variant={recording ? "destructive" : "default"}
              onClick={handleToggleRecording}
            >
              {recording ? "停止录音" : "开始录音"}
            </Button>
            {asrStatus && (
              <span className="text-sm text-muted-foreground">{asrStatus}</span>
            )}
          </div>
          {asrText && (
            <div className="rounded-md border bg-muted/50 p-3">
              <p className="text-sm font-mono whitespace-pre-wrap">{asrText}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="api" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="api">API 配置</TabsTrigger>
          <TabsTrigger value="hotkey">快捷键</TabsTrigger>
          <TabsTrigger value="general">通用</TabsTrigger>
        </TabsList>

        <TabsContent value="api">
          <Card>
            <CardHeader>
              <CardTitle>火山引擎语音识别</CardTitle>
              <CardDescription>配置火山引擎 ASR 服务的认证信息</CardDescription>
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
              <div className="space-y-2">
                <Label htmlFor="resourceId">Resource ID</Label>
                <Input
                  id="resourceId"
                  placeholder="输入 Resource ID"
                  value={settings.resourceId}
                  onChange={(e) => updateSetting("resourceId", e.target.value)}
                />
              </div>
              <Separator />
              <div className="flex items-center gap-4">
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={testing}
                >
                  {testing ? "测试中..." : "测试连接"}
                </Button>
                {testResult && (
                  <span className="text-sm text-muted-foreground">{testResult}</span>
                )}
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
}
