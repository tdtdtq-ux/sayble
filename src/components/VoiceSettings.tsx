import { useState } from "react";
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
import { Plug, Eye, EyeOff } from "lucide-react";
import type { AppSettings } from "@/types/settings";

interface VoiceSettingsProps {
  settings: AppSettings;
  onUpdate: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function VoiceSettings({ settings, onUpdate }: VoiceSettingsProps) {
  const [testing, setTesting] = useState(false);
  const [showAccessKey, setShowAccessKey] = useState(false);

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      if (!settings.appId || !settings.accessKey) {
        toast.error("请先填写完整的 API 配置");
        return;
      }
      const msg = await invoke<string>("cmd_test_asr_connection", {
        appId: settings.appId,
        accessKey: settings.accessKey,
      });
      toast.success(msg);
    } catch (e) {
      toast.error(`测试失败: ${e}`);
    } finally {
      setTesting(false);
    }
  };

  return (
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
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Label htmlFor="appId" className="shrink-0 w-20">App ID</Label>
          <Input
            id="appId"
            placeholder="输入 App ID"
            value={settings.appId}
            onChange={(e) => onUpdate("appId", e.target.value)}
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
              onChange={(e) => onUpdate("accessKey", e.target.value)}
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
            onValueChange={(v) => onUpdate("language", v)}
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
            onCheckedChange={(v) => onUpdate("autoPunctuation", v)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
