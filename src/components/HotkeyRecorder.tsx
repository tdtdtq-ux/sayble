import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Circle, X } from "lucide-react";

interface HotkeyRecorderProps {
  value: string;
  onChange: (value: string) => void;
}

export function HotkeyRecorder({ value, onChange }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);

  const getModifierLabel = (e: KeyboardEvent): string | null => {
    // 区分左右修饰键
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

    // 常用键名映射
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

    const cleanup = () => {
      setRecording(false);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handleKeyUp, true);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);
  }, [onChange]);

  const handleClear = () => {
    onChange("");
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex-1 rounded-md border px-3 py-2 text-sm ${
          recording
            ? "border-primary bg-primary/5 text-primary"
            : "border-input bg-background text-foreground"
        }`}
      >
        {recording ? (
          pressedKeys.length > 0 ? (
            pressedKeys.join(" + ")
          ) : (
            <span className="text-muted-foreground">请按下快捷键组合...</span>
          )
        ) : value ? (
          value
        ) : (
          <span className="text-muted-foreground">未设置</span>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={recording ? undefined : handleStartRecording}
        disabled={recording}
      >
        {recording ? "录入中..." : <><Circle className="size-3 mr-1" />录入</>}
      </Button>
      <Button variant="ghost" size="sm" onClick={handleClear} disabled={!value || recording}>
        <X className="size-3 mr-1" />清除
      </Button>
    </div>
  );
}
