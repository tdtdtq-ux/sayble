import { useState, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Settings, type SettingsHandle } from "@/components/Settings";

function App() {
  const settingsRef = useRef<SettingsHandle>(null);
  const [autostartWarning, setAutostartWarning] = useState<string | null>(null);

  // 监听托盘"关于"事件
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen("show-about", () => {
      if (cancelled) return;
      settingsRef.current?.showAbout();
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

  // 监听自启动被第三方软件劫持事件
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<string>("autostart-hijacked", (ev) => {
      if (cancelled) return;
      setAutostartWarning(ev.payload);
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

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      {autostartWarning && (
        <div className="shrink-0 bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between gap-2">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            开机自启动已被第三方软件禁用（来源：{autostartWarning}）。请在该软件的"启动项管理"中允许 Sayble 自启动，或卸载相关优化软件。
          </p>
          <button
            onClick={() => setAutostartWarning(null)}
            className="shrink-0 text-amber-700 dark:text-amber-400 hover:opacity-70 text-lg leading-none px-1"
          >
            ×
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <Settings
          ref={settingsRef}
        />
      </div>
    </div>
  );
}

export default App;
