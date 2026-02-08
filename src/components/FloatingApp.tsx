import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { FloatingWindow, type FloatingStatus } from "@/components/FloatingWindow";

const appWindow = getCurrentWindow();

export function FloatingApp() {
  const [floatingStatus, setFloatingStatus] = useState<FloatingStatus>("idle");
  const [partialText, setPartialText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outputModeRef = useRef<"Clipboard" | "SimulateKeyboard">("Clipboard");
  const autoOutputRef = useRef(true);
  const maxSessionRef = useRef(0);
  const cancelledSessionRef = useRef(0);
  const outputDoneRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    setDuration(0);
    timerRef.current = setInterval(() => {
      setDuration((prev) => prev + 1000);
    }, 1000);
  }, [clearTimer]);

  const showWindow = useCallback(async () => {
    const monitor = await currentMonitor();
    if (monitor) {
      const screenWidth = monitor.size.width / monitor.scaleFactor;
      const screenHeight = monitor.size.height / monitor.scaleFactor;
      const winWidth = 300;
      const winHeight = 52;
      const x = Math.round((screenWidth - winWidth) / 2);
      const y = Math.round(screenHeight - winHeight - 60);
      await appWindow.setPosition(new LogicalPosition(x, y));
    }
    await appWindow.show();
  }, []);

  const hideWindow = useCallback(async () => {
    await appWindow.hide();
  }, []);

  const resetState = useCallback(() => {
    setPartialText("");
    setFinalText("");
    setDuration(0);
    outputDoneRef.current = false;
  }, []);

  const outputText = useCallback(async (text: string) => {
    if (outputDoneRef.current) return;
    if (!autoOutputRef.current || !text) return;
    outputDoneRef.current = true;
    try {
      await invoke("cmd_output_text", { text, mode: outputModeRef.current });
    } catch (e) {
      console.error("Failed to output text:", e);
    }
  }, []);

  // 监听 ASR 事件（后端驱动，每个事件携带 sessionId）
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<{
      sessionId: number;
      event: string | { PartialResult?: string; FinalResult?: string; Error?: string; Connected?: null };
    }>("asr-event", (ev) => {
      if (cancelled) return;
      const { sessionId, event } = ev.payload;

      // 旧 session 或已取消 session 的事件直接丢弃
      if (sessionId < maxSessionRef.current) {
        console.log("[asr-event] discarded old session:", sessionId, "current:", maxSessionRef.current);
        return;
      }
      if (sessionId === cancelledSessionRef.current) {
        console.log("[asr-event] discarded cancelled session:", sessionId);
        return;
      }

      // 新 session 到来，自动 reset
      if (sessionId > maxSessionRef.current) {
        maxSessionRef.current = sessionId;
        resetState();
      }

      // 解析事件类型
      let type = "";
      let data = "";
      if (typeof event === "string") {
        type = event;
      } else if (event && typeof event === "object") {
        if ("PartialResult" in event && event.PartialResult) {
          type = "PartialResult";
          data = event.PartialResult;
        } else if ("FinalResult" in event && event.FinalResult) {
          type = "FinalResult";
          data = event.FinalResult;
        } else if ("Error" in event) {
          type = "Error";
        } else if ("Connected" in event) {
          type = "Connected";
        }
      }

      if (type === "Connected") {
        console.log("[asr-event] session", sessionId, "Connected");
        setFloatingStatus("recording");
        showWindow();
      } else if (type === "PartialResult") {
        setPartialText(data);
      } else if (type === "FinalResult") {
        console.log("[asr-event] session", sessionId, "FinalResult, text_len=", data.length);
        setFinalText(data);
        setFloatingStatus("done");
        clearTimer();
        outputText(data);
      } else if (type === "Finished") {
        console.log("[asr-event] session", sessionId, "Finished");
        setFloatingStatus("idle");
        hideWindow();
      } else if (type === "Error") {
        console.error("[asr-event] session", sessionId, "Error:", event);
        setFloatingStatus("idle");
        clearTimer();
        hideWindow();
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
      clearTimer();
    };
  }, [clearTimer, showWindow, hideWindow, resetState, outputText]);

  // 监听主窗口发来的控制事件
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<{
      action: string;
      outputMode?: string;
      autoOutput?: boolean;
    }>("floating-control", (event) => {
      if (cancelled) return;
      const { action, outputMode, autoOutput } = event.payload;
      console.log("[floating-control] received action:", action, "outputMode:", outputMode, "autoOutput:", autoOutput);
      if (action === "start") {
        if (outputMode) {
          outputModeRef.current = outputMode as "Clipboard" | "SimulateKeyboard";
        }
        if (autoOutput !== undefined) {
          autoOutputRef.current = autoOutput;
        }
        resetState();
        setFloatingStatus("recording");
        startTimer();
        showWindow();
      } else if (action === "stop") {
        setFloatingStatus("recognizing");
        clearTimer();
      } else if (action === "cancel") {
        // 标记当前 session 为已取消，其后续事件会被丢弃
        cancelledSessionRef.current = maxSessionRef.current;
        setFloatingStatus("idle");
        clearTimer();
        hideWindow();
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
  }, [clearTimer, startTimer, showWindow, hideWindow, resetState]);

  return (
    <FloatingWindow
      status={floatingStatus}
      partialText={partialText}
      finalText={finalText}
      duration={duration}
      onCancel={() => {
        cancelledSessionRef.current = maxSessionRef.current;
        setFloatingStatus("idle");
        clearTimer();
        hideWindow();
      }}
    />
  );
}
