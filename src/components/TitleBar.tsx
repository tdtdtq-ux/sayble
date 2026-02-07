import { getCurrentWindow } from "@tauri-apps/api/window";

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
      className="flex h-9 items-center justify-between border-b bg-background select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 px-3 text-sm font-medium">
        Voice Keyboard
      </div>
      <div className="flex h-full">
        <button
          onClick={handleMinimize}
          className="inline-flex h-full w-11 items-center justify-center hover:bg-accent transition-colors"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          onClick={handleToggleMaximize}
          className="inline-flex h-full w-11 items-center justify-center hover:bg-accent transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        </button>
        <button
          onClick={handleClose}
          className="inline-flex h-full w-11 items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
