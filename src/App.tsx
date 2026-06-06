import { useState, useEffect, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Dashboard } from "@/components/Dashboard";
import { Settings } from "@/components/Settings";
import { TitleBar } from "@/components/TitleBar";
import { Toaster } from "@/components/ui/sonner";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { setupKeyEventBridge } from "@/lib/keyEventBridge";

function App() {
  const [page, setPage] = useState<"home" | "settings">("home");
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);

  const autostartWarning = useSettingsStore((s) => s.autostartWarning);
  const autostartFlash = useSettingsStore((s) => s.autostartFlash);
  const dismissAutostartWarning = useSettingsStore((s) => s.dismissAutostartWarning);
  const setAutostartWarning = useSettingsStore((s) => s.setAutostartWarning);

  // 加载 settings
  useEffect(() => {
    useSettingsStore.getState().loadSettings();
    useSettingsStore.getState().checkUpdate();
  }, []);

  // WebView2 焦点时键盘钩子失效补偿：通过 JS 层监听按键并注入后端
  useEffect(() => {
    return setupKeyEventBridge();
  }, []);

  // 监听托盘点击事件，直接回到首页
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen("show-home", () => {
      if (cancelled) return;
      setSettingsTab(undefined);
      setPage("home");
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

  // 检测自启动状态
  const checkAutostart = useCallback(() => {
    invoke<string | null>("cmd_check_autostart").then((result) => {
      setAutostartWarning(result);
    }).catch(() => {});
  }, [setAutostartWarning]);

  // 启动时检测 + 窗口每次获得焦点时重新检测
  useEffect(() => {
    checkAutostart();
    let unlisten: (() => void) | null = null;
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) checkAutostart();
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [checkAutostart]);

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <TitleBar />
      {autostartWarning && (
        <div
          className={`shrink-0 bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between gap-2 transition-opacity duration-150 ${autostartFlash ? "opacity-40" : "opacity-100"}`}
        >
          <p className="text-sm text-amber-700 dark:text-amber-400">
            开机自启动已被第三方软件禁用（来源：{autostartWarning}）。
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={async () => {
                try {
                  await invoke("cmd_restore_autostart");
                  dismissAutostartWarning();
                } catch (e) {
                  console.error("restore autostart failed:", e);
                }
              }}
              className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
            >
              恢复自启动
            </button>
            <button
              onClick={dismissAutostartWarning}
              className="text-amber-700 dark:text-amber-400 hover:opacity-70 text-lg leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        {page === "home" ? (
          <Dashboard onOpenSettings={(tab?: string) => {
            setSettingsTab(tab);
            setPage("settings");
          }} />
        ) : (
          <Settings
            onBack={() => { setSettingsTab(undefined); setPage("home"); }}
            initialTab={settingsTab}
          />
        )}
      </div>
      <Toaster position="top-center" duration={1500} />
    </div>
  );
}

export default App;
