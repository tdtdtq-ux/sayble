import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type FloatingStatus = "idle" | "recording" | "recognizing" | "done";

interface FloatingWindowProps {
  status: FloatingStatus;
  partialText: string;
  finalText: string;
  duration: number;
  onCancel?: () => void;
}

export function FloatingWindow({
  status,
  partialText,
  finalText,
  duration,
  onCancel,
}: FloatingWindowProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (status === "idle") {
      setVisible(false);
    } else {
      setVisible(true);
    }
  }, [status]);

  if (!visible) return null;

  return (
    <div className="p-2">
      <div
        className={cn(
          "rounded-xl border bg-card px-6 py-4 shadow-lg backdrop-blur-sm",
          "min-w-[320px] max-w-[600px] transition-all duration-300",
          status === "recording" && "border-red-500/50",
          status === "recognizing" && "border-orange-500/50",
          status === "done" && "border-green-500/50"
        )}
      >
        <div className="flex items-center gap-3">
          <StatusIndicator status={status} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {status === "recording" && "录音中"}
                {status === "recognizing" && "识别中"}
                {status === "done" && "识别完成"}
              </span>
              {status === "recording" && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatDuration(duration)}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground truncate">
              {status === "recording" && (partialText || "请开始说话...")}
              {status === "recognizing" && (partialText || "正在识别...")}
              {status === "done" && finalText}
            </p>
          </div>
          {(status === "recording" || status === "recognizing") && (
            <button
              onClick={onCancel}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Esc 取消
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIndicator({ status }: { status: FloatingStatus }) {
  return (
    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
      {status === "recording" && (
        <>
          <div className="absolute h-8 w-8 animate-ping rounded-full bg-red-500/20" />
          <div className="h-3 w-3 rounded-full bg-red-500" />
        </>
      )}
      {status === "recognizing" && (
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
      )}
      {status === "done" && (
        <svg
          className="h-5 w-5 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
