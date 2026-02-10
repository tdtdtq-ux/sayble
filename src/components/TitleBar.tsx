import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const handleMinimize = () => appWindow.minimize();
  const handleToggleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  return (
    <div
      className="shrink-0 h-8 flex select-none bg-background"
      data-tauri-drag-region
    >
      <div className="w-56 shrink-0 border-r" data-tauri-drag-region />
      <div className="flex-1 flex items-center justify-end" data-tauri-drag-region>
        <button
          onClick={handleMinimize}
          className="h-full px-3.5 hover:bg-muted transition-colors inline-flex items-center justify-center"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          onClick={handleToggleMaximize}
          className="h-full px-3.5 hover:bg-muted transition-colors inline-flex items-center justify-center"
        >
          {isMaximized ? (
            <Copy className="size-3 -scale-x-100" />
          ) : (
            <Square className="size-3" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="h-full px-3.5 hover:bg-red-500 hover:text-white transition-colors inline-flex items-center justify-center"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
