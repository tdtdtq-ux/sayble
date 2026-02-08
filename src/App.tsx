import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Settings, type SettingsHandle } from "@/components/Settings";

function App() {
  const settingsRef = useRef<SettingsHandle>(null);

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

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0">
        <Settings
          ref={settingsRef}
        />
      </div>
    </div>
  );
}

export default App;
