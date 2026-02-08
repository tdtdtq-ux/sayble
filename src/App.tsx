import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { info, warn, error as logError } from "@tauri-apps/plugin-log";
import { Settings, type SettingsHandle } from "@/components/Settings";

function App() {
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const settingsRef = useRef<SettingsHandle>(null);
  const recordingStartTimeRef = useRef(0);
  const MIN_RECORDING_MS = 800;

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  const startRecording = useCallback(
    async (settings: {
      appId: string;
      accessKey: string;
      microphoneDevice: string;
      outputMode?: string;
      autoOutput?: boolean;
    }) => {
      if (!settings.appId || !settings.accessKey) {
        return;
      }

      try {
        // 通知 floating 窗口开始，并传递输出配置
        await emit("floating-control", {
          action: "start",
          outputMode: settings.outputMode,
          autoOutput: settings.autoOutput,
        });

        // 注册 ASR 事件监听（主窗口只关心录音状态的结束）
        unlistenRef.current?.();
        const unlisten = await listen<{
          sessionId: number;
          event: string | { FinalResult?: string; Error?: string };
        }>("asr-event", (ev) => {
          const { event } = ev.payload;
          // 主窗口只关心录音结束事件
          let type = "";
          if (typeof event === "string") {
            type = event;
          } else if (event && typeof event === "object") {
            if ("FinalResult" in event) type = "FinalResult";
            else if ("Error" in event) type = "Error";
          }
          if (type === "FinalResult" || type === "Error" || type === "Finished") {
            unlistenRef.current?.();
            unlistenRef.current = null;
          }
        });
        unlistenRef.current = unlisten;

        await invoke("cmd_start_recording", {
          appId: settings.appId,
          accessKey: settings.accessKey,
          deviceName: settings.microphoneDevice,
        });
        recordingStartTimeRef.current = Date.now();
      } catch (e) {
        logError("[recording] startRecording failed: " + e);
      }
    },
    []
  );

  const stopRecording = useCallback(async () => {
    // 最短录音保护：确保 ASR 收到足够音频数据
    const elapsed = Date.now() - recordingStartTimeRef.current;
    if (elapsed < MIN_RECORDING_MS) {
      await new Promise((r) => setTimeout(r, MIN_RECORDING_MS - elapsed));
    }
    try {
      await invoke("cmd_stop_recording");
    } catch (e) {
      warn("[recording] cmd_stop_recording failed (may already stopped): " + e);
    }
    await emit("floating-control", { action: "stop" });
  }, []);

  const cancelRecording = useCallback(async () => {
    // 先注销 ASR 监听器，防止旧 session 的后续事件干扰状态
    unlistenRef.current?.();
    unlistenRef.current = null;
    try {
      await invoke("cmd_stop_recording");
    } catch {
      // ignore
    }
    await emit("floating-control", { action: "cancel" });
  }, []);

  // 监听托盘"关于"事件
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen("show-about", () => {
      if (cancelled) return;
      settingsRef.current?.showAbout();
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

  // 监听后端快捷键事件
  // 后端已根据 RecordingFlag 判断好了 start/stop，前端直接执行
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<string>("hotkey-event", (event) => {
      if (cancelled) return;
      const hotkeyEvent = event.payload;
      info("[hotkey] received: " + hotkeyEvent);
      if (hotkeyEvent === "StartRecording") {
        const params = settingsRef.current?.getRecordingParams();
        if (params) {
          startRecording(params);
        } else {
          warn("[hotkey] StartRecording ignored: no recording params available");
        }
      } else if (hotkeyEvent === "StopRecording") {
        stopRecording();
      } else if (hotkeyEvent === "CancelRecording") {
        cancelRecording();
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
  }, [startRecording, stopRecording, cancelRecording]);

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0">
        <Settings
          ref={settingsRef}
        />
      </div>
    </div>
  );
}

export default App;
