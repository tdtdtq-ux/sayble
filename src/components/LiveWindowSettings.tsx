import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Check, ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSettingsStore } from "@/stores/useSettingsStore";
import {
  getLiveWindowDraft,
  LIVE_WINDOW_PRESETS,
  normalizeLiveWindowUrl,
  validateLiveWindow,
  type LiveWindowConfig,
  type LiveWindowPresetValue,
} from "@/types/liveWindow";

interface CameraDevice {
  deviceId: string;
  label: string;
}

function createLiveWindow(): LiveWindowConfig {
  return {
    id: crypto.randomUUID(),
    name: "新直播窗口",
    url: "https://example.com",
    width: 900,
    height: 1200,
  };
}

function getPresetValue(config: LiveWindowConfig | undefined): LiveWindowPresetValue {
  if (!config) return "3:4";

  const matched = LIVE_WINDOW_PRESETS.find((preset) => {
    if (preset.value === "custom") return false;
    return config.width * preset.heightRatio === config.height * preset.widthRatio;
  });

  return matched?.value ?? "custom";
}

export function LiveWindowSettings() {
  const { appSettings, updateAppSetting } = useSettingsStore();
  const liveWindows = appSettings.liveWindows ?? [];
  const [activeId, setActiveId] = useState<string>(liveWindows[0]?.id ?? "");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([]);
  const [loadingCameras, setLoadingCameras] = useState(false);

  const activeWindow = useMemo(
    () => liveWindows.find((item) => item.id === activeId) ?? liveWindows[0],
    [activeId, liveWindows]
  );

  const activePreset = getPresetValue(activeWindow);

  useEffect(() => {
    listCameraDevices().then(setCameraDevices).catch(() => setCameraDevices([]));
  }, []);

  const setLiveWindows = (next: LiveWindowConfig[]) => {
    updateAppSetting("liveWindows", next);
  };

  const updateLiveWindow = (id: string, patch: Partial<LiveWindowConfig>) => {
    setLiveWindows(liveWindows.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const handleCreate = () => {
    const nextWindow = createLiveWindow();
    setLiveWindows([...liveWindows, nextWindow]);
    setActiveId(nextWindow.id);
    setDeletingId(null);
  };

  const handleDelete = (id: string) => {
    const idx = liveWindows.findIndex((item) => item.id === id);
    const next = liveWindows.filter((item) => item.id !== id);
    setLiveWindows(next);
    setDeletingId(null);

    if (activeId === id) {
      setActiveId(next[Math.min(idx, next.length - 1)]?.id ?? "");
    }
  };

  const handlePresetChange = (value: string) => {
    if (!activeWindow || !value) return;
    if (value === "custom") return;

    const draft = getLiveWindowDraft(value as LiveWindowPresetValue, activeWindow.width);
    updateLiveWindow(activeWindow.id, draft);
  };

  const handleUrlBlur = () => {
    if (!activeWindow) return;
    const normalized = normalizeLiveWindowUrl(activeWindow.url);
    if (normalized) {
      updateLiveWindow(activeWindow.id, { url: normalized });
    }
  };

  const handleOpen = async (config: LiveWindowConfig) => {
    const validated = validateLiveWindow(config);
    if (!validated) {
      toast.error("请填写有效的名称、URL 和内容尺寸");
      return;
    }

    setOpeningId(config.id);
    try {
      await invoke("cmd_open_live_window", { config: validated });
      if (validated.url !== config.url || validated.name !== config.name) {
        updateLiveWindow(config.id, validated);
      }
    } catch (e) {
      toast.error(`${e}`);
    } finally {
      setOpeningId(null);
    }
  };

  const handleRefreshCameras = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("当前环境不支持摄像头访问");
      return;
    }

    setLoadingCameras(true);
    try {
      const stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({ video: true, audio: false }),
        15000,
      );
      stream.getTracks().forEach((track) => track.stop());

      const devices = await listCameraDevices();
      setCameraDevices(devices);
      if (devices.length === 0) {
        toast.error("没有找到摄像头设备");
      } else {
        toast.success("摄像头列表已刷新");
      }
    } catch (error) {
      console.error("[live-window] failed to refresh cameras:", error);
      toast.error("摄像头授权失败或超时");
    } finally {
      setLoadingCameras(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-6 py-3 shrink-0">
        <h2 className="text-base font-semibold">直播窗口</h2>
        <Button variant="outline" size="sm" onClick={handleCreate}>
          <Plus className="size-4 mr-1" />
          新建
        </Button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-52 shrink-0 overflow-y-auto custom-scrollbar space-y-1.5 pb-4 pl-6">
          {liveWindows.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveId(item.id)}
              className={`w-full text-left px-3 py-2 text-sm rounded-md border transition-colors ${
                activeWindow?.id === item.id
                  ? "border-primary bg-muted text-foreground"
                  : "border-border hover:border-primary/50 hover:bg-muted/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="block truncate font-medium">{item.name || "未命名窗口"}</span>
              <span className="block text-[11px] mt-0.5 text-muted-foreground">
                {item.width} x {item.height}
              </span>
            </button>
          ))}
          {liveWindows.length === 0 && (
            <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
              暂无直播窗口
            </div>
          )}
        </div>

        {activeWindow ? (
          <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar px-6 pb-6">
            <div className="max-w-2xl flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">窗口配置</h3>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={openingId === activeWindow.id}
                    onClick={() => handleOpen(activeWindow)}
                  >
                    <ExternalLink className="size-3.5 mr-1" />
                    打开
                  </Button>
                  {deletingId === activeWindow.id ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(activeWindow.id)}
                      onBlur={() => setDeletingId(null)}
                    >
                      <Check className="size-3.5 mr-1" />
                      确认删除
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeletingId(activeWindow.id)}
                    >
                      <Trash2 className="size-3.5 mr-1" />
                      删除
                    </Button>
                  )}
                </div>
              </div>

              <div className="rounded-md bg-muted/50 p-4 flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <Label htmlFor="live-window-name" className="shrink-0 w-24 text-muted-foreground">
                    名称
                  </Label>
                  <Input
                    id="live-window-name"
                    value={activeWindow.name}
                    onChange={(e) => updateLiveWindow(activeWindow.id, { name: e.target.value })}
                    className="flex-1"
                  />
                </div>

                <div className="flex items-center gap-4">
                  <Label htmlFor="live-window-url" className="shrink-0 w-24 text-muted-foreground">
                    URL
                  </Label>
                  <Input
                    id="live-window-url"
                    value={activeWindow.url}
                    onBlur={handleUrlBlur}
                    onChange={(e) => updateLiveWindow(activeWindow.id, { url: e.target.value })}
                    className="flex-1"
                  />
                </div>

                <div className="flex items-center gap-4">
                  <Label className="shrink-0 w-24 text-muted-foreground">比例</Label>
                  <ToggleGroup
                    type="single"
                    value={activePreset}
                    onValueChange={handlePresetChange}
                    variant="outline"
                    size="sm"
                  >
                    {LIVE_WINDOW_PRESETS.map((preset) => (
                      <ToggleGroupItem key={preset.value} value={preset.value}>
                        {preset.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>

                <div className="flex items-center gap-4">
                  <Label htmlFor="live-window-width" className="shrink-0 w-24 text-muted-foreground">
                    内容尺寸
                  </Label>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 flex-1">
                    <Input
                      id="live-window-width"
                      type="number"
                      min={200}
                      max={3840}
                      value={activeWindow.width}
                      onChange={(e) => {
                        const width = Number(e.target.value);
                        if (activePreset !== "custom") {
                          updateLiveWindow(activeWindow.id, getLiveWindowDraft(activePreset, width));
                        } else {
                          updateLiveWindow(activeWindow.id, { width });
                        }
                      }}
                    />
                    <span className="text-sm text-muted-foreground">x</span>
                    <Input
                      type="number"
                      min={200}
                      max={3840}
                      value={activeWindow.height}
                      disabled={activePreset !== "custom"}
                      onChange={(e) => updateLiveWindow(activeWindow.id, { height: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <Label className="shrink-0 w-24 text-muted-foreground">摄像头</Label>
                  <div className="flex flex-1 min-w-0 items-center gap-2">
                    <Select
                      value={activeWindow.cameraDeviceId || "default"}
                      onValueChange={(value) =>
                        updateLiveWindow(activeWindow.id, {
                          cameraDeviceId: value === "default" ? undefined : value,
                        })
                      }
                    >
                      <SelectTrigger className="flex-1 min-w-0">
                        <SelectValue placeholder="选择摄像头" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">系统默认摄像头</SelectItem>
                        {cameraDevices.map((device, index) => (
                          <SelectItem key={device.deviceId} value={device.deviceId}>
                            {device.label || `摄像头 ${index + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={loadingCameras}
                      onClick={handleRefreshCameras}
                    >
                      <RefreshCw className="size-3.5 mr-1" />
                      授权/刷新
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            点击右上角新建直播窗口
          </div>
        )}
      </div>
    </div>
  );
}

async function listCameraDevices(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "videoinput" && device.deviceId)
    .map((device) => ({
      deviceId: device.deviceId,
      label: device.label,
    }));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
