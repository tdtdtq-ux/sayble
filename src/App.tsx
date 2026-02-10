import { useState, useEffect, useRef, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HomePage } from "@/components/HomePage";
import { Settings, type SettingsHandle } from "@/components/Settings";
import { Toaster } from "@/components/ui/sonner";

function App() {
  const settingsRef = useRef<SettingsHandle>(null);
  const [page, setPage] = useState<"home" | "settings">("home");
  const [pendingShowAbout, setPendingShowAbout] = useState(false);
  const [autostartWarning, setAutostartWarning] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const warningRef = useRef<HTMLDivElement>(null);

  // 监听托盘"关于"事件
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen("show-about", () => {
      if (cancelled) return;
      if (settingsRef.current) {
        // 已在设置页，直接切换 tab
        settingsRef.current.showAbout();
      } else {
        // 从首页切换，标记待执行，等 Settings 挂载后触发
        setPage("settings");
        setPendingShowAbout(true);
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

  // Settings 挂载后消费 pendingShowAbout
  useEffect(() => {
    if (pendingShowAbout && settingsRef.current) {
      settingsRef.current.showAbout();
      setPendingShowAbout(false);
    }
  }, [pendingShowAbout, page]);

  // 检测自启动状态
  const checkAutostart = useCallback(() => {
    invoke<string | null>("cmd_check_autostart").then((result) => {
      setAutostartWarning(result);
    }).catch(() => {});
  }, []);

  // 启动时检测 + 窗口每次获得焦点时重新检测
  useEffect(() => {
    checkAutostart();
    let unlisten: (() => void) | null = null;
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) checkAutostart();
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [checkAutostart]);

  // Settings 手动检测回调，统一用顶部警告条展示
  const handleAutostartWarning = useCallback((source: string | null) => {
    if (source) {
      if (autostartWarning) {
        // 已经在显示，闪烁提醒
        setFlash(true);
        setTimeout(() => setFlash(false), 600);
      }
      setAutostartWarning(source);
    } else {
      setAutostartWarning(null);
    }
  }, [autostartWarning]);

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      {autostartWarning && (
        <div
          ref={warningRef}
          className={`shrink-0 bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between gap-2 transition-opacity duration-150 ${flash ? "opacity-40" : "opacity-100"}`}
        >
          <p className="text-sm text-amber-700 dark:text-amber-400">
            开机自启动已被第三方软件禁用（来源：{autostartWarning}）。
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={async () => {
                try {
                  await invoke("cmd_restore_autostart");
                  setAutostartWarning(null);
                } catch (e) {
                  console.error("restore autostart failed:", e);
                }
              }}
              className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
            >
              恢复自启动
            </button>
            <button
              onClick={() => setAutostartWarning(null)}
              className="text-amber-700 dark:text-amber-400 hover:opacity-70 text-lg leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        {page === "home" ? (
          <HomePage onOpenSettings={() => setPage("settings")} />
        ) : (
          <Settings
            ref={settingsRef}
            onBack={() => setPage("home")}
            onAutostartWarning={handleAutostartWarning}
          />
        )}
      </div>
      <Toaster position="top-center" duration={1500} />
    </div>
  );
}

export default App;
