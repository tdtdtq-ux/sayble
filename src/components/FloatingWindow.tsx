import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type FloatingStatus = "idle" | "recording" | "recognizing" | "done" | "error" | "polishing" | "polish_error";

interface FloatingWindowProps {
  status: FloatingStatus;
  partialText: string;
  finalText: string;
  duration: number;
  errorMessage?: string;
  onCancel?: () => void;
}

export function FloatingWindow({
  status,
  partialText,
  finalText,
  duration,
  errorMessage,
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

  const displayText =
    status === "recording"
      ? partialText || "请开始说话..."
      : status === "recognizing"
        ? partialText || "正在识别..."
        : status === "polishing"
          ? finalText || "润色中..."
          : status === "done"
            ? finalText
            : status === "error"
              ? errorMessage || "连接失败"
              : status === "polish_error"
                ? finalText
                : "";

  return (
    <div
      className={cn(
        "h-screen w-screen bg-neutral-900 px-3 py-2",
        "border rounded-lg",
        status === "recording" && "border-red-500/40",
        status === "recognizing" && "border-orange-500/40",
        status === "polishing" && "border-blue-500/40",
        status === "done" && "border-green-500/40",
        status === "error" && "border-yellow-500/40",
        status === "polish_error" && "border-yellow-500/40"
      )}
    >
      <div className="flex items-center gap-2 h-full">
        <StatusIndicator status={status} />
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-neutral-300 shrink-0">
              {status === "recording" && "录音中"}
              {status === "recognizing" && "识别中"}
              {status === "polishing" && "润色中"}
              {status === "done" && "完成"}
              {status === "error" && "出错"}
              {status === "polish_error" && "润色失败"}
            </span>
            {status === "recording" && (
              <span className="text-[10px] text-neutral-500 tabular-nums shrink-0">
                {formatDuration(duration)}
              </span>
            )}
          </div>
          <div className="mt-0.5 overflow-hidden">
            <p
              className="text-xs text-neutral-400 whitespace-nowrap"
              style={{ direction: "rtl", textAlign: "left" }}
            >
              {displayText}
            </p>
          </div>
        </div>
        {(status === "recording" || status === "recognizing") && (
          <button
            onClick={onCancel}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 transition-colors"
          >
            Esc
          </button>
        )}
      </div>
    </div>
  );
}

function StatusIndicator({ status }: { status: FloatingStatus }) {
  return (
    <div className="relative flex h-5 w-5 shrink-0 items-center justify-center">
      {status === "recording" && (
        <>
          <div className="absolute h-5 w-5 animate-ping rounded-full bg-red-500/20" />
          <div className="h-2 w-2 rounded-full bg-red-500" />
        </>
      )}
      {status === "recognizing" && (
        <div className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-orange-500 border-t-transparent" />
      )}
      {status === "polishing" && (
        <div className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-blue-500 border-t-transparent" />
      )}
      {status === "done" && (
        <svg
          className="h-3.5 w-3.5 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
      {(status === "error" || status === "polish_error") && (
        <svg
          className="h-3.5 w-3.5 text-yellow-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01" />
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
