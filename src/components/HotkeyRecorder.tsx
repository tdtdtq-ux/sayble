import { useState, useCallback, useRef } from "react";
import { X } from "lucide-react";

interface HotkeyRecorderProps {
  value: string;
  onChange: (value: string) => void;
}

export function HotkeyRecorder({ value, onChange }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const getModifierLabel = (e: KeyboardEvent): string | null => {
    if (e.code === "ControlLeft") return "左Ctrl";
    if (e.code === "ControlRight") return "右Ctrl";
    if (e.code === "AltLeft") return "左Alt";
    if (e.code === "AltRight") return "右Alt";
    if (e.code === "ShiftLeft") return "左Shift";
    if (e.code === "ShiftRight") return "右Shift";
    return null;
  };

  const getKeyLabel = (e: KeyboardEvent): string => {
    const modifier = getModifierLabel(e);
    if (modifier) return modifier;

    const keyMap: Record<string, string> = {
      Space: "Space",
      Enter: "Enter",
      Escape: "Esc",
      Backspace: "Backspace",
      Tab: "Tab",
      Delete: "Delete",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
    };

    if (keyMap[e.code]) return keyMap[e.code];
    if (e.code.startsWith("Key")) return e.code.slice(3);
    if (e.code.startsWith("Digit")) return e.code.slice(5);
    if (e.code.startsWith("F") && e.code.length <= 3) return e.code;

    return e.key.toUpperCase();
  };

  const handleStartRecording = useCallback(() => {
    if (recording) return;
    setRecording(true);
    setPressedKeys([]);

    const keys = new Set<string>();

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === "Escape") {
        cleanup();
        return;
      }

      const label = getKeyLabel(e);
      keys.add(label);
      setPressedKeys(Array.from(keys));
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (keys.size > 0) {
        const result = Array.from(keys).join(" + ");
        onChange(result);
        cleanup();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        cleanup();
      }
    };

    const cleanup = () => {
      setRecording(false);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handleKeyUp, true);
      document.removeEventListener("mousedown", handleClickOutside, true);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);
    document.addEventListener("mousedown", handleClickOutside, true);
  }, [onChange, recording]);

  return (
    <div
      ref={containerRef}
      className={`relative flex items-center rounded-md border px-3 py-2 text-sm cursor-pointer select-none ${
        recording
          ? "border-primary bg-primary/5 text-primary"
          : "border-input bg-background text-foreground hover:border-muted-foreground/50"
      }`}
      onClick={handleStartRecording}
    >
      <span className="flex-1">
        {recording ? (
          pressedKeys.length > 0 ? (
            pressedKeys.join(" + ")
          ) : (
            <span className="text-muted-foreground">按下快捷键...</span>
          )
        ) : value ? (
          value
        ) : (
          <span className="text-muted-foreground">点击设置快捷键</span>
        )}
      </span>
      {value && !recording && (
        <button
          type="button"
          className="ml-2 text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
          }}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
