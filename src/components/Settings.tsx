import { useState, useEffect, useCallback, useImperativeHandle, type Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { HotkeyRecorder } from "./HotkeyRecorder";
import { AppIcon } from "./AppIcon";
import { About } from "./About";
import { Key, Keyboard, Settings2, Info, Plug, RefreshCw, Save, Check, Home, Mic, Type, Clock, Hash } from "lucide-react";

function formatStatsDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

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
  showAbout: () => void;
}

interface SettingsProps {
  ref?: Ref<SettingsHandle>;
}

export function Settings({ ref }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState("home");

  // 切到首页时刷新统计数据
  useEffect(() => {
    if (activeTab === "home") {
      loadStats();
    }
  }, [activeTab]);

  // 监听 ASR 完成事件，自动刷新统计
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<{ event: string | object }>("asr-event", (ev) => {
      if (cancelled) return;
      const { event } = ev.payload;
      if (event === "Finished") {
        loadStats();
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  const [stats, setStats] = useState<{ totalDurationMs: number; totalChars: number; totalCount: number } | null>(null);

  useImperativeHandle(ref, () => ({
    getRecordingParams: () => ({
      appId: settings.appId,
      accessKey: settings.accessKey,
      microphoneDevice: settings.microphoneDevice,
      outputMode: settings.outputMode,
      autoOutput: settings.autoOutput,
    }),
    showAbout: () => setActiveTab("about"),
  }), [settings.appId, settings.accessKey, settings.microphoneDevice, settings.outputMode, settings.autoOutput]);

  useEffect(() => {
    loadDevices();
    loadSettings();
    loadStats();
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

  const loadStats = async () => {
    try {
      const result = await invoke<{ totalDurationMs: number; totalChars: number; totalCount: number }>("cmd_load_stats");
      setStats(result);
    } catch (e) {
      console.error("Failed to load stats:", e);
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

  return (
    <div className="mx-auto max-w-2xl h-full flex flex-col">
      <div className="shrink-0 px-6 pt-6 pb-4">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <AppIcon className="size-6" />
              Sayble
            </h1>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-0">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="home"><Home className="size-4 mr-1.5" />首页</TabsTrigger>
            <TabsTrigger value="api"><Key className="size-4 mr-1.5" />API 配置</TabsTrigger>
            <TabsTrigger value="hotkey"><Keyboard className="size-4 mr-1.5" />快捷键</TabsTrigger>
            <TabsTrigger value="general"><Settings2 className="size-4 mr-1.5" />通用</TabsTrigger>
            <TabsTrigger value="about"><Info className="size-4 mr-1.5" />关于</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 pb-6">
          {activeTab === "home" && (
          <Card>
            <CardHeader>
              <CardTitle>使用统计</CardTitle>
              <CardDescription>语音识别累计使用数据</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
                  <Hash className="size-5 text-muted-foreground" />
                  <span className="text-2xl font-bold">{stats?.totalCount ?? 0}</span>
                  <span className="text-sm text-muted-foreground">识别次数</span>
                </div>
                <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
                  <Type className="size-5 text-muted-foreground" />
                  <span className="text-2xl font-bold">{stats?.totalChars ?? 0}</span>
                  <span className="text-sm text-muted-foreground">识别字数</span>
                </div>
                <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
                  <Clock className="size-5 text-muted-foreground" />
                  <span className="text-2xl font-bold">{formatStatsDuration(stats?.totalDurationMs ?? 0)}</span>
                  <span className="text-sm text-muted-foreground">录音时长</span>
                </div>
              </div>
            </CardContent>
          </Card>
          )}

          {activeTab === "api" && (
          <Card>
            <CardHeader>
              <CardTitle>火山引擎语音识别</CardTitle>
              <CardDescription>配置火山引擎 ASR 服务的认证信息</CardDescription>
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={testing}
                >
                  <Plug className="size-4 mr-1.5" />
                  {testing ? "测试中..." : "测试连接"}
                </Button>
              </CardAction>
              {testResult && (
                <p className="text-sm text-muted-foreground">{testResult}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Label htmlFor="appId" className="shrink-0 w-20">App ID</Label>
                <Input
                  id="appId"
                  placeholder="输入 App ID"
                  value={settings.appId}
                  onChange={(e) => updateSetting("appId", e.target.value)}
                  className="flex-1"
                />
              </div>
              <div className="flex items-center gap-4">
                <Label htmlFor="accessKey" className="shrink-0 w-20">Access Key</Label>
                <Input
                  id="accessKey"
                  type="password"
                  placeholder="输入 Access Key"
                  value={settings.accessKey}
                  onChange={(e) => updateSetting("accessKey", e.target.value)}
                  className="flex-1"
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <Label htmlFor="language">识别语言</Label>
                <Select
                  value={settings.language}
                  onValueChange={(v) => updateSetting("language", v)}
                >
                  <SelectTrigger id="language" className="w-36">
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
          )}

          {activeTab === "hotkey" && (
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
          )}

          {activeTab === "general" && (
          <Card>
            <CardHeader>
              <CardTitle>通用设置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Label htmlFor="outputMode" className="shrink-0 w-20">输出方式</Label>
                <Select
                  value={settings.outputMode}
                  onValueChange={(v) => updateSetting("outputMode", v as AppSettings["outputMode"])}
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
                  onValueChange={(v) => updateSetting("microphoneDevice", v === "default" ? "" : v)}
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
          )}

          {activeTab === "about" && <About />}

        {activeTab !== "about" && activeTab !== "home" && (
        <div className="mt-6 flex justify-end">
          <Button onClick={handleSave}>
            {saved ? <Check className="size-4 mr-1.5" /> : <Save className="size-4 mr-1.5" />}
            {saved ? "已保存" : "保存设置"}
          </Button>
        </div>
        )}
      </div>
    </div>
  );
}
