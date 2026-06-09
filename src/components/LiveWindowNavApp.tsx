import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeft, ArrowRight, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeLiveWindowUrl } from "@/types/liveWindow";

export function LiveWindowNavApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const id = params.get("id") ?? "";
  const [address, setAddress] = useState(params.get("url") ?? "");

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<string>("live-window-url-changed", (event) => {
      if (!cancelled) {
        setAddress(event.payload);
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

  const navigate = async () => {
    const normalized = normalizeLiveWindowUrl(address);
    if (!normalized || !id) return;
    setAddress(normalized);
    await invoke("cmd_live_window_navigate", { id, url: normalized });
  };

  const invokeNavigation = (command: string) => {
    if (!id) return;
    invoke(command, { id }).catch((e) => console.error(`[live-window] ${command} failed:`, e));
  };

  const closeWindow = () => {
    if (!id) return;
    invoke("cmd_live_window_close", { id }).catch((e) =>
      console.error("[live-window] close failed:", e),
    );
  };

  const startDragging = () => {
    getCurrentWindow()
      .startDragging()
      .catch((e) => console.error("[live-window] start dragging failed:", e));
  };

  return (
    <div
      className="h-screen bg-background border-b flex items-center gap-1 px-2 select-none"
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button,input,form")) return;
        startDragging();
      }}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="后退"
        onClick={() => invokeNavigation("cmd_live_window_go_back")}
      >
        <ArrowLeft className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="前进"
        onClick={() => invokeNavigation("cmd_live_window_go_forward")}
      >
        <ArrowRight className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="刷新"
        onClick={() => invokeNavigation("cmd_live_window_reload")}
      >
        <RotateCw className="size-4" />
      </Button>
      <form
        className="flex-1 min-w-0"
        onSubmit={(e) => {
          e.preventDefault();
          navigate().catch((err) => console.error("[live-window] navigate failed:", err));
        }}
      >
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="h-7 rounded-full bg-muted/60 select-text"
        />
      </form>
      <div
        className="h-full w-8 shrink-0 cursor-grab active:cursor-grabbing"
        onMouseDown={startDragging}
        aria-hidden="true"
      />
      <Button variant="ghost" size="icon-sm" aria-label="关闭" onClick={closeWindow}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
