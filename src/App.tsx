import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { Settings, type SettingsHandle } from "@/components/Settings";
import { TitleBar } from "@/components/TitleBar";

function App() {
  const [recording, setRecording] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const settingsRef = useRef<SettingsHandle>(null);
  const recordingRef = useRef(false);
  const recordingStartTimeRef = useRef(0);
  const MIN_RECORDING_MS = 800;

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

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
          const payload = event.payload;
          // 主窗口只关心录音结束事件，统一处理字符串和对象两种格式
          let type = "";
          if (typeof payload === "string") {
            type = payload;
          } else if (payload && typeof payload === "object") {
            if ("FinalResult" in payload) type = "FinalResult";
            else if ("Error" in payload) type = "Error";
            else if ("Disconnected" in payload) type = "Disconnected";
          }
          if (type === "FinalResult" || type === "Error" || type === "Disconnected") {
            setRecording(false);
          }
        });
        unlistenRef.current = unlisten;

        await invoke("cmd_start_recording", {
          appId: settings.appId,
          accessKey: settings.accessKey,
          deviceName: settings.microphoneDevice,
        });
        setRecording(true);
        recordingStartTimeRef.current = Date.now();
      } catch {
        // 启动失败
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
      setRecording(false);
      await emit("floating-control", { action: "stop" });
    } catch {
      // ignore
    }
  }, []);

  const cancelRecording = useCallback(async () => {
    try {
      await invoke("cmd_stop_recording");
    } catch {
      // ignore
    }
    setRecording(false);
    await emit("floating-control", { action: "cancel" });
  }, []);

  // 监听后端快捷键事件
  useEffect(() => {
    const setupHotkeyListener = async () => {
      const unlisten = await listen<string>("hotkey-event", (event) => {
        const hotkeyEvent = event.payload;
        if (hotkeyEvent === "StartRecording" || hotkeyEvent === "ToggleRecording") {
          if (!recordingRef.current) {
            const params = settingsRef.current?.getRecordingParams();
            if (params) {
              startRecording(params);
            }
          } else if (hotkeyEvent === "ToggleRecording") {
            stopRecording();
          }
        } else if (hotkeyEvent === "StopRecording") {
          if (recordingRef.current) {
            stopRecording();
          }
        } else if (hotkeyEvent === "CancelRecording") {
          if (recordingRef.current) {
            cancelRecording();
          }
        }
      });
      return unlisten;
    };

    let unlisten: UnlistenFn | null = null;
    setupHotkeyListener().then((fn) => { unlisten = fn; });

    return () => {
      unlisten?.();
    };
  }, [startRecording, stopRecording, cancelRecording]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <TitleBar />
      <div className="flex-1 overflow-auto">
        <Settings
          ref={settingsRef}
          recording={recording}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
        />
      </div>
    </div>
  );
}

export default App;
