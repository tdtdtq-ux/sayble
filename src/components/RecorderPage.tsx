import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Mic, Play, RotateCcw, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";

type RecorderState = "idle" | "recording" | "ready" | "playing" | "error";

const mimeTypeCandidates = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function getSupportedMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return mimeTypeCandidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function getAudioExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function getAudioFilterName(extension: string) {
  return extension.toUpperCase();
}

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  levels: number[],
  isRecording: boolean,
  progress = isRecording ? 1 : 0,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const styles = getComputedStyle(document.documentElement);
  const primaryColor = styles.getPropertyValue("--color-primary").trim() || "#18181b";
  const mutedColor = styles.getPropertyValue("--color-muted-foreground").trim() || "#71717a";
  const borderColor = styles.getPropertyValue("--color-border").trim() || "#e4e4e7";
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const centerY = height / 2;
  const barCount = 96;
  const gap = 3;
  const barWidth = Math.max(2, (width - gap * (barCount - 1)) / barCount);
  const start = Math.max(0, levels.length - barCount);
  const visibleLevels = levels.slice(start);

  for (let i = 0; i < barCount; i += 1) {
    const level = visibleLevels[i - (barCount - visibleLevels.length)] ?? 0.02;
    const normalized = Math.min(1, Math.max(0.02, level));
    const barHeight = Math.max(4, normalized * (height - 20));
    const x = i * (barWidth + gap);
    const alpha = isRecording ? 0.35 + (i / barCount) * 0.65 : 0.28;
    const isPlayed = progress > 0 && i / Math.max(1, barCount - 1) <= progress;

    ctx.globalAlpha = isRecording ? alpha : isPlayed ? 0.8 : 0.28;
    ctx.fillStyle = isRecording || isPlayed ? primaryColor : mutedColor;
    ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight);
  }

  ctx.globalAlpha = 1;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();
}

export function RecorderPage() {
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordedMs, setRecordedMs] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioMimeType, setAudioMimeType] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const playbackFrameRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const playbackStartedAtRef = useRef(0);
  const levelsRef = useRef<number[]>([]);

  const displayDuration = recorderState === "recording" || recorderState === "playing" ? elapsedMs : recordedMs;
  const downloadName = useMemo(() => {
    const now = new Date();
    const timestamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");
    return `sayble-recording-${timestamp}.${getAudioExtension(audioMimeType)}`;
  }, [audioMimeType]);
  const audioExtension = useMemo(() => getAudioExtension(audioMimeType), [audioMimeType]);

  const stopVisualization = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    if (playbackFrameRef.current !== null) {
      cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    }
    const source = playbackSourceRef.current;
    playbackSourceRef.current = null;
    if (source) {
      try {
        source.stop();
      } catch {
        // Source may already be stopped by natural playback end.
      }
    }
    const context = playbackContextRef.current;
    playbackContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close();
    }
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const resetAudioContext = useCallback(async () => {
    const context = audioContextRef.current;
    audioContextRef.current = null;
    analyserRef.current = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => {});
    }
  }, []);

  const renderWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const centered = (data[i] - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / data.length);
      levelsRef.current = [...levelsRef.current.slice(-140), Math.min(1, rms * 5)];
      drawWaveform(canvas, levelsRef.current, true);
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    tick();
  }, []);

  const clearRecording = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioBlob(null);
    setAudioMimeType("");
    setRecordedMs(0);
    setElapsedMs(0);
    levelsRef.current = [];
    if (canvasRef.current) drawWaveform(canvasRef.current, levelsRef.current, false);
  }, [audioUrl]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecorderState("error");
      setErrorMessage("当前环境不支持浏览器录音，请升级 WebView2 或浏览器运行时。");
      return;
    }

    clearRecording();
    stopPlayback();
    setErrorMessage("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);

      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      recorderRef.current = recorder;
      chunksRef.current = [];
      levelsRef.current = [];
      startedAtRef.current = Date.now();
      setAudioMimeType(mimeType);
      setRecordedMs(0);
      setElapsedMs(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stopVisualization();
        const stoppedAt = Date.now();
        const duration = stoppedAt - startedAtRef.current;
        const blobType = mimeType || chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        const nextUrl = URL.createObjectURL(blob);

        setRecordedMs(duration);
        setElapsedMs(duration);
        setAudioMimeType(blobType);
        setAudioBlob(blob);
        setAudioUrl(nextUrl);
        setRecorderState("ready");
        stopTracks();
        await resetAudioContext();
        if (canvasRef.current) drawWaveform(canvasRef.current, levelsRef.current, false);
      };

      recorder.onerror = () => {
        setRecorderState("error");
        setErrorMessage("录音过程中出现异常，请重新尝试。");
        stopVisualization();
        stopTracks();
        void resetAudioContext();
      };

      recorder.start();
      setRecorderState("recording");
      renderWaveform();
    } catch (error) {
      console.error("Failed to start recording:", error);
      setRecorderState("error");
      setErrorMessage("无法访问麦克风，请检查系统权限或设备占用状态。");
      stopVisualization();
      stopTracks();
      await resetAudioContext();
    }
  }, [clearRecording, renderWaveform, resetAudioContext, stopPlayback, stopTracks, stopVisualization]);

  const handlePrimaryAction = () => {
    if (recorderState === "recording") {
      stopRecording();
      return;
    }
    void startRecording();
  };

  const saveRecording = async () => {
    if (!audioBlob || isSaving) return;

    setIsSaving(true);
    try {
      const selectedPath = await save({
        defaultPath: downloadName,
        filters: [
          {
            name: getAudioFilterName(audioExtension),
            extensions: [audioExtension],
          },
        ],
      });

      if (!selectedPath) return;

      const buffer = await audioBlob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      const path = await invoke<string>("cmd_save_recording_file", {
        fileName: downloadName,
        path: selectedPath,
        bytes,
      });
      toast.success("已保存", { description: path });
    } catch (error) {
      console.error("Failed to save recording:", error);
      toast.error("保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const playRecording = async () => {
    if (!audioBlob || recorderState === "playing") return;

    stopPlayback();
    try {
      const context = new AudioContext();
      const buffer = await audioBlob.arrayBuffer();
      const decoded = await context.decodeAudioData(buffer.slice(0));
      const source = context.createBufferSource();
      source.buffer = decoded;
      source.connect(context.destination);

      playbackContextRef.current = context;
      playbackSourceRef.current = source;
      playbackStartedAtRef.current = Date.now();
      setElapsedMs(0);
      setRecorderState("playing");

      const tick = () => {
        const elapsed = Date.now() - playbackStartedAtRef.current;
        const progress = Math.min(1, elapsed / Math.max(1, recordedMs));
        setElapsedMs(Math.min(recordedMs, elapsed));
        if (canvasRef.current) drawWaveform(canvasRef.current, levelsRef.current, false, progress);
        if (progress < 1) {
          playbackFrameRef.current = requestAnimationFrame(tick);
        }
      };

      source.onended = () => {
        if (playbackSourceRef.current !== source) return;
        if (playbackFrameRef.current !== null) {
          cancelAnimationFrame(playbackFrameRef.current);
          playbackFrameRef.current = null;
        }
        playbackSourceRef.current = null;
        playbackContextRef.current = null;
        void context.close();
        setElapsedMs(recordedMs);
        setRecorderState("ready");
        if (canvasRef.current) drawWaveform(canvasRef.current, levelsRef.current, false, 1);
      };

      source.start();
      tick();
    } catch (error) {
      console.error("Failed to play recording:", error);
      stopPlayback();
      setRecorderState("ready");
      toast.error("试听失败");
    }
  };

  useEffect(() => {
    if (recorderState !== "recording") return;
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 50);
    return () => window.clearInterval(timer);
  }, [recorderState]);

  useEffect(() => {
    if (canvasRef.current) drawWaveform(canvasRef.current, levelsRef.current, false);

    return () => {
      stopVisualization();
      stopPlayback();
      stopTracks();
      void resetAudioContext();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl, resetAudioContext, stopPlayback, stopTracks, stopVisualization]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6">
      <Card className="mx-auto max-w-3xl">
        <CardContent className="flex flex-col gap-5">
          <div className="pt-2 text-center font-display-num text-4xl font-bold tabular-nums">
            {formatDuration(displayDuration)}
          </div>

          <div className="rounded-lg border bg-muted/20 p-4">
            <canvas
              ref={canvasRef}
              className="h-44 w-full"
              aria-label="录音波形"
            />
          </div>

          {errorMessage && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handlePrimaryAction} size="lg">
              {recorderState === "recording" ? (
                <Square data-icon="inline-start" />
              ) : (
                <Mic data-icon="inline-start" />
              )}
              {recorderState === "recording" ? "结束录音" : "开始录音"}
            </Button>

            <Button
              variant="outline"
              size="lg"
              onClick={clearRecording}
              disabled={recorderState === "recording" || recorderState === "playing" || (!audioUrl && recorderState !== "error")}
            >
              <RotateCcw data-icon="inline-start" />
              重新录制
            </Button>

            <div className="ml-auto flex items-center gap-3">
              <Button
                variant="outline"
                size="lg"
                onClick={playRecording}
                disabled={!audioBlob || recorderState === "recording" || recorderState === "playing"}
              >
                {recorderState === "playing" ? (
                  <Volume2 data-icon="inline-start" />
                ) : (
                  <Play data-icon="inline-start" />
                )}
                试听
              </Button>
              <Button onClick={saveRecording} disabled={!audioBlob || isSaving || recorderState === "recording"}>
                <Download data-icon="inline-start" />
                {isSaving ? "下载中" : "下载"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
