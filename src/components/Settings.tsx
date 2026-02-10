import { useState, useEffect, useCallback, useImperativeHandle, useRef, type Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
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
import { Separator } from "@/components/ui/separator";
import { HotkeyRecorder } from "./HotkeyRecorder";
import { About } from "./About";
import { Mic, Settings2, Info, Plug, RefreshCw, Eye, EyeOff, ArrowLeft } from "lucide-react";

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
  showAbout: () => void;
}

interface SettingsProps {
  ref?: Ref<SettingsHandle>;
  onBack?: () => void;
  onAutostartWarning?: (source: string | null) => void;
}

const menuItems = [
  { key: "voice", label: "语音", icon: Mic },
  { key: "general", label: "通用", icon: Settings2 },
  { key: "about", label: "关于", icon: Info },
] as const;

type TabKey = (typeof menuItems)[number]["key"];

export function Settings({ ref, onBack, onAutostartWarning }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showAccessKey, setShowAccessKey] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("voice");

  useImperativeHandle(ref, () => ({
    showAbout: () => setActiveTab("about"),
  }), []);

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

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const saveSettings = useCallback((newSettings: AppSettings) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await invoke("cmd_save_settings", { settings: newSettings });
        toast.success("设置已保存");
      } catch (e) {
        console.error("Failed to save:", e);
        toast.error("保存失败");
      }
    }, 500);
  }, []);

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

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
    <div className="h-full flex">
      {/* 左侧菜单 */}
      <nav className="shrink-0 w-36 border-r px-3 pt-6 pb-3 flex flex-col gap-1">
        <div className="flex items-center gap-2 px-3 pb-4">
          {onBack && (
            <button
              onClick={onBack}
              className="size-8 rounded-md hover:bg-muted flex items-center justify-center transition-colors"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          <h1 className="text-lg font-bold tracking-tight">设置</h1>
        </div>
        {menuItems.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors text-left ${
              activeTab === key
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      {/* 右侧内容区 */}
      <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar px-6 pt-6 pb-6">
          {activeTab === "voice" && (
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
                  <div className="relative flex-1">
                    <Input
                      id="accessKey"
                      type={showAccessKey ? "text" : "password"}
                      placeholder="输入 Access Key"
                      value={settings.accessKey}
                      onChange={(e) => updateSetting("accessKey", e.target.value)}
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAccessKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showAccessKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
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

          {activeTab === "general" && (
            <div className="space-y-4">
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
                        onCheckedChange={(v) => updateSetting("autoStart", v)}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

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
            </div>
          )}

          {activeTab === "about" && <About />}
        </div>
    </div>
  );
}
