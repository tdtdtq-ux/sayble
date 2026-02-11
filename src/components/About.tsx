import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AppIcon } from "./AppIcon";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "sonner";

declare const __BUILD_TIME__: string;

const GITHUB_URL = "https://github.com/tdtdtq-ux/sayble";

const badges = ["Tauri v2", "Rust", "React 19", "MIT"];

export function About() {
  const [version, setVersion] = useState("");
  const deviceId = useSettingsStore((s) => s.appSettings.deviceId);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("0.1.0"));
  }, []);

  return (
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
            title="点击复制完整 Device ID"
            onClick={() => {
              navigator.clipboard.writeText(deviceId).then(() => toast.success("Device ID 已复制"));
            }}
          >
            ID: {deviceId.slice(0, 8)}...
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

      <p className="text-xs text-muted-foreground/50">
        &copy; {new Date().getFullYear()} Sayble contributors
      </p>
    </div>
  );
}
