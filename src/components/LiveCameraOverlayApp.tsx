import { useEffect, useMemo, useRef, useState } from "react";

type CameraState = "loading" | "ready" | "error";

export function LiveCameraOverlayApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const deviceId = params.get("deviceId")?.trim();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>("loading");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    const openCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("mediaDevices.getUserMedia is unavailable");
        }

        const videoConstraints: MediaTrackConstraints = deviceId
          ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            };

        const nextStream = await withTimeout(
          navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: false,
          }),
          12000,
        );

        if (cancelled) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = nextStream;
        if (videoRef.current) {
          videoRef.current.srcObject = nextStream;
          await videoRef.current.play();
        }
        setState("ready");
      } catch (error) {
        console.error("[live-camera] failed to open camera:", error);
        if (!cancelled) setState("error");
      }
    };

    openCamera();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId]);

  return (
    <div className="h-screen w-screen bg-transparent p-[96px] select-none">
      <div className="relative h-full w-full rounded-full bg-neutral-950 shadow-[0_30px_90px_rgba(0,0,0,0.32),0_10px_26px_rgba(0,0,0,0.2)]">
        <div
          className="absolute inset-0 overflow-hidden rounded-full bg-neutral-950"
          style={{
            clipPath: "circle(50% at 50% 50%)",
            WebkitClipPath: "circle(50% at 50% 50%)",
            WebkitMaskImage: "radial-gradient(circle, #000 98.5%, transparent 100%)",
            maskImage: "radial-gradient(circle, #000 98.5%, transparent 100%)",
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="h-full w-full object-cover scale-x-[-1]"
          />
          {state !== "ready" && (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-950 text-center text-[11px] font-medium text-white/75">
              {state === "loading" ? "打开摄像头" : "摄像头不可用"}
            </div>
          )}
        </div>
        <div
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/95 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
