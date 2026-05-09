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
const WINDOW_WIDTH = 340;
const WINDOW_HEIGHT = 84;
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
    <div className="h-screen w-screen">
      {notification && (
        <div
          className={cn(
            "grid h-full w-full grid-cols-[2rem_1fr_1.75rem] items-start gap-3 overflow-hidden rounded-md border bg-background px-3.5 py-3 shadow-none",
            isSuccess ? "border-border" : "border-destructive/35",
          )}
        >
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-md",
              isSuccess ? "bg-primary text-primary-foreground" : "bg-destructive text-white",
            )}
          >
            {isSuccess ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
          </div>

          <div className="min-w-0 pt-px">
            <div className="truncate text-sm font-semibold leading-5">{notification.title}</div>
            <div className="mt-0.5 line-clamp-2 text-xs leading-[18px] text-muted-foreground">
              {notification.body}
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon-xs"
            className="-mr-1 -mt-1 size-7 rounded-md text-muted-foreground/70 hover:text-foreground [&_svg]:size-3.5"
            onClick={hide}
            aria-label="关闭通知"
          >
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}
