import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
  monitorFromPoint,
  primaryMonitor,
} from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const appWindow = getCurrentWindow();
const WINDOW_WIDTH = 360;
const WINDOW_HEIGHT = 108;
const WINDOW_GAP = 18;
const HIDE_DELAY = 8000;

interface TunnelNotificationPayload {
  title: string;
  body: string;
  level: "success" | "warn" | "error";
}

export function TunnelNotificationApp() {
  const [notification, setNotification] = useState<TunnelNotificationPayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(async () => {
    clearTimer();
    setNotification(null);
    await appWindow.hide();
  }, [clearTimer]);

  const positionWindow = useCallback(async () => {
    const cursor = await cursorPosition().catch(() => null);
    const monitor =
      (cursor ? await monitorFromPoint(cursor.x, cursor.y).catch(() => null) : null) ??
      (await currentMonitor().catch(() => null)) ??
      (await primaryMonitor().catch(() => null));

    if (!monitor) return;

    const scale = monitor.scaleFactor;
    const x = Math.round(
      monitor.workArea.position.x +
        monitor.workArea.size.width -
        WINDOW_WIDTH * scale -
        WINDOW_GAP * scale
    );
    const y = Math.round(
      monitor.workArea.position.y +
        monitor.workArea.size.height -
        WINDOW_HEIGHT * scale -
        WINDOW_GAP * scale
    );
    await appWindow.setPosition(new PhysicalPosition(x, y));
  }, []);

  const show = useCallback(
    async (payload: TunnelNotificationPayload) => {
      clearTimer();
      setNotification(payload);
      await positionWindow();
      await appWindow.show();
      await appWindow.setAlwaysOnTop(true);
      timerRef.current = setTimeout(() => {
        hide();
      }, HIDE_DELAY);
    },
    [clearTimer, hide, positionWindow],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<TunnelNotificationPayload>("tunnel-notification", (event) => {
      if (cancelled) return;
      show(event.payload);
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
      clearTimer();
    };
  }, [clearTimer, show]);

  const isSuccess = notification?.level === "success";

  return (
    <div className="flex h-screen w-screen items-center justify-center p-2">
      {notification && (
        <div
          className={cn(
            "w-full rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur",
            isSuccess ? "border-border" : "border-destructive/30",
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md",
                isSuccess ? "bg-primary text-primary-foreground" : "bg-destructive text-white",
              )}
            >
              {isSuccess ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{notification.title}</div>
              <div className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                {notification.body}
              </div>
            </div>
            <Button variant="ghost" size="icon-xs" onClick={hide} aria-label="关闭通知">
              <X />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
