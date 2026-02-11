import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AppIcon } from "./AppIcon";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

declare const __BUILD_TIME__: string;

const GITHUB_URL = "https://github.com/tdtdtq-ux/sayble";

const badges = ["Tauri v2", "Rust", "React 19", "MIT"];

export function About() {
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const deviceId = useSettingsStore((s) => s.appSettings.deviceId);
  const updateAvailable = useSettingsStore((s) => s.updateAvailable);
  const checkUpdate = useSettingsStore((s) => s.checkUpdate);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("0.1.0"));
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateError(null);
    try {
      await checkUpdate();
      const update = useSettingsStore.getState().updateAvailable;
      if (update) {
        setShowUpdateDialog(true);
      } else {
        toast.success("已经是最新版本");
      }
    } catch (e) {
      setUpdateError(String(e).replace(/^Error:\s*/i, "") || "未知错误");
    } finally {
      setChecking(false);
    }
  };

  const handleOpenDownload = () => {
    if (updateAvailable) {
      openUrl(updateAvailable.url);
    }
  };

  return (
    <>
      <div className="flex flex-col items-center text-center py-10 px-6 space-y-6">
        <AppIcon className="size-20 text-foreground" />

        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Sayble</h2>
          <p className="text-muted-foreground text-sm">
            桌面语音输入工具 — 按下快捷键说话，文字自动输入到任意应用。
          </p>
          <p className="text-muted-foreground/60 text-xs italic">
            Voice-to-text, anywhere you type.
          </p>
        </div>

        <div className="flex flex-wrap justify-center items-center gap-2">
          {version && (
            <span className="inline-block rounded-full border px-3 py-0.5 text-xs text-muted-foreground">
              v{version}
            </span>
          )}
          <span className="inline-block rounded-full border px-3 py-0.5 text-xs text-muted-foreground">
            Build {__BUILD_TIME__.slice(0, 16).replace("T", " ")} UTC
          </span>
          {deviceId && (
            <span
              className="inline-block rounded-full border px-3 py-0.5 text-xs text-muted-foreground cursor-pointer hover:border-primary/50 transition-colors"
              title="点击复制完整 UID"
              onClick={() => {
                navigator.clipboard.writeText(deviceId).then(() => toast.success("UID 已复制"));
              }}
            >
              UID: {deviceId.slice(0, 8)}...
            </span>
          )}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {badges.map((badge) => (
            <span
              key={badge}
              className="rounded-md bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
            >
              {badge}
            </span>
          ))}
        </div>

        <button
          onClick={() => openUrl(GITHUB_URL)}
          className="text-sm text-primary underline underline-offset-4 hover:text-primary/80 transition-colors cursor-pointer"
        >
          GitHub
        </button>

        {updateAvailable ? (
          <button
            onClick={() => setShowUpdateDialog(true)}
            className="rounded-md bg-emerald-500 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-600 transition-colors cursor-pointer"
          >
            更新至 {updateAvailable.version}
          </button>
        ) : (
          <button
            onClick={handleCheckUpdate}
            disabled={checking}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-muted-foreground/80 transition-colors cursor-pointer disabled:opacity-50"
          >
            {checking ? "检查中..." : "检查更新"}
          </button>
        )}

        <p className="text-xs text-muted-foreground/50">
          &copy; {new Date().getFullYear()} Sayble contributors
        </p>
      </div>

      <Dialog open={showUpdateDialog && updateAvailable !== null} onOpenChange={(open) => !open && setShowUpdateDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发现新版本</DialogTitle>
            <DialogDescription>
              Sayble {updateAvailable?.version} 已发布，点击下方按钮前往下载页面。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpdateDialog(false)}>
              取消
            </Button>
            <Button onClick={handleOpenDownload}>
              前往下载
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={updateError !== null} onOpenChange={(open) => !open && setUpdateError(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>检查更新失败</DialogTitle>
            <DialogDescription>
              {updateError}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateError(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
