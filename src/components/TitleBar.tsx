import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

const appWindow = getCurrentWindow();

export function TitleBar() {
  const handleMinimize = () => appWindow.minimize();
  const handleToggleMaximize = async () => {
    if (await appWindow.isMaximized()) {
      appWindow.unmaximize();
    } else {
      appWindow.maximize();
    }
  };
  const handleClose = () => appWindow.hide();

  return (
    <div
      data-tauri-drag-region
      className="flex h-9 items-center justify-end bg-background select-none"
    >
      <div className="flex h-full">
        <button
          onClick={handleMinimize}
          className="inline-flex h-full w-11 items-center justify-center hover:bg-accent transition-colors"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          onClick={handleToggleMaximize}
          className="inline-flex h-full w-11 items-center justify-center hover:bg-accent transition-colors"
        >
          <Square className="size-3" />
        </button>
        <button
          onClick={handleClose}
          className="inline-flex h-full w-11 items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
