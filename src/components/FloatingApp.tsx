import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { FloatingWindow, type FloatingStatus } from "@/components/FloatingWindow";

const appWindow = getCurrentWindow();

export function FloatingApp() {
  const [floatingStatus, setFloatingStatus] = useState<FloatingStatus>("idle");
  const [partialText, setPartialText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputModeRef = useRef<"Clipboard" | "SimulateKeyboard">("Clipboard");
  const autoOutputRef = useRef(true);
  const cancelledRef = useRef(false);
  const outputDoneRef = useRef(false);
  const partialTextRef = useRef("");

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
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
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

  const hideWindowDelayed = useCallback((ms: number) => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => {
      hideWindow();
      hideTimerRef.current = null;
    }, ms);
  }, [hideWindow]);

  const resetState = useCallback(() => {
    setPartialText("");
    setFinalText("");
    setDuration(0);
    cancelledRef.current = false;
    outputDoneRef.current = false;
    partialTextRef.current = "";
  }, []);

  // 从持久化设置加载输出配置（快捷键触发时用）
  const loadOutputConfig = useCallback(async () => {
    try {
      const settings = await invoke<Record<string, unknown> | null>("cmd_load_settings");
      if (settings) {
        if (settings.outputMode === "Clipboard" || settings.outputMode === "SimulateKeyboard") {
          outputModeRef.current = settings.outputMode;
        }
        if (typeof settings.autoOutput === "boolean") {
          autoOutputRef.current = settings.autoOutput;
        }
      }
    } catch {
      // 加载失败用默认值
    }
  }, []);

  const outputText = useCallback(async (text: string) => {
    // 已取消或已输出过，不再输出
    if (cancelledRef.current || outputDoneRef.current) return;
    if (!autoOutputRef.current || !text) return;
    outputDoneRef.current = true;
    try {
      await invoke("cmd_output_text", { text, mode: outputModeRef.current });
    } catch (e) {
      console.error("Failed to output text:", e);
    }
  }, []);

  useEffect(() => {
    // 监听 ASR 事件
    const setupAsrListener = async () => {
      const unlisten = await listen<
        | string
        | {
            PartialResult?: string;
            FinalResult?: string;
            Error?: string;
            Connected?: null;
            Disconnected?: null;
          }
      >("asr-event", (event) => {
        // 统一提取事件类型和数据，后端可能发字符串或对象两种格式
        const payload = event.payload;
        let type = "";
        let data = "";
        if (typeof payload === "string") {
          type = payload;
        } else if (payload && typeof payload === "object") {
          if ("PartialResult" in payload && payload.PartialResult) {
            type = "PartialResult";
            data = payload.PartialResult;
          } else if ("FinalResult" in payload && payload.FinalResult) {
            type = "FinalResult";
            data = payload.FinalResult;
          } else if ("Error" in payload) {
            type = "Error";
          } else if ("Connected" in payload) {
            type = "Connected";
          } else if ("Disconnected" in payload) {
            type = "Disconnected";
          }
        }

        if (type === "Connected") {
          setFloatingStatus("recording");
          showWindow();
        } else if (type === "Disconnected") {
          // FinalResult 未到达时，用最后的 PartialResult 作为 fallback 输出
          if (!outputDoneRef.current && !cancelledRef.current && partialTextRef.current) {
            setFinalText(partialTextRef.current);
            setFloatingStatus("done");
            clearTimer();
            outputText(partialTextRef.current);
            hideWindowDelayed(1000);
          } else {
            setFloatingStatus("idle");
            clearTimer();
            hideWindow();
          }
        } else if (type === "PartialResult") {
          if (!cancelledRef.current) {
            partialTextRef.current = data;
            setPartialText(data);
          }
        } else if (type === "FinalResult") {
          if (!cancelledRef.current) {
            setFinalText(data);
            setFloatingStatus("done");
            clearTimer();
            outputText(data);
            hideWindowDelayed(1000);
          }
        } else if (type === "Error") {
          setFloatingStatus("idle");
          clearTimer();
          hideWindow();
        }
      });
      return unlisten;
    };

    // 监听快捷键事件
    const setupHotkeyListener = async () => {
      const unlisten = await listen<string>("hotkey-event", (event) => {
        const hotkeyEvent = event.payload;
        if (hotkeyEvent === "StartRecording" || hotkeyEvent === "ToggleRecording") {
          resetState();
          loadOutputConfig();
          setFloatingStatus("recording");
          startTimer();
          showWindow();
        } else if (hotkeyEvent === "StopRecording") {
          setFloatingStatus("recognizing");
          clearTimer();
        } else if (hotkeyEvent === "CancelRecording") {
          cancelledRef.current = true;
          setFloatingStatus("idle");
          clearTimer();
          hideWindow();
        }
      });
      return unlisten;
    };

    let unlistenAsr: UnlistenFn | null = null;
    let unlistenHotkey: UnlistenFn | null = null;
    setupAsrListener().then((fn) => { unlistenAsr = fn; });
    setupHotkeyListener().then((fn) => { unlistenHotkey = fn; });

    return () => {
      unlistenAsr?.();
      unlistenHotkey?.();
      clearTimer();
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [clearTimer, startTimer, showWindow, hideWindow, hideWindowDelayed, resetState, outputText, loadOutputConfig]);

  // 监听主窗口发来的控制事件
  useEffect(() => {
    const setup = async () => {
      const unlisten = await listen<{
        action: string;
        outputMode?: string;
        autoOutput?: boolean;
      }>("floating-control", (event) => {
        const { action, outputMode, autoOutput } = event.payload;
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
          cancelledRef.current = true;
          setFloatingStatus("idle");
          clearTimer();
          hideWindow();
        }
      });
      return unlisten;
    };

    let unlisten: UnlistenFn | null = null;
    setup().then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [clearTimer, startTimer, showWindow, hideWindow, resetState]);

  return (
    <FloatingWindow
      status={floatingStatus}
      partialText={partialText}
      finalText={finalText}
      duration={duration}
      onCancel={() => {
        cancelledRef.current = true;
        setFloatingStatus("idle");
        clearTimer();
        hideWindow();
      }}
    />
  );
}
