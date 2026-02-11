import { invoke } from "@tauri-apps/api/core";

/**
 * 暂停标志：HotkeyRecorder 录制快捷键时设为 true，避免录制操作误触发录音
 */
let suspended = false;

export function suspendKeyEventBridge() {
  suspended = true;
}

export function resumeKeyEventBridge() {
  suspended = false;
}

/**
 * 将 JS event.code 映射为 Windows 虚拟键码 (VK code)
 * 用于 WebView2 焦点时补偿键盘钩子失效的问题
 */
function codeToVk(code: string): number | null {
  // 修饰键（区分左右）
  const modifierMap: Record<string, number> = {
    ControlLeft: 0xa2, // VK_LCONTROL
    ControlRight: 0xa3, // VK_RCONTROL
    AltLeft: 0xa4, // VK_LMENU
    AltRight: 0xa5, // VK_RMENU
    ShiftLeft: 0xa0, // VK_LSHIFT
    ShiftRight: 0xa1, // VK_RSHIFT
  };
  if (code in modifierMap) return modifierMap[code];

  // 特殊键
  if (code === "Escape") return 0x1b;
  if (code === "Space") return 0x20;
  if (code === "Enter") return 0x0d;

  // 字母 KeyA-KeyZ → 0x41-0x5A
  const letterMatch = code.match(/^Key([A-Z])$/);
  if (letterMatch) return letterMatch[1].charCodeAt(0);

  // 数字 Digit0-Digit9 → 0x30-0x39
  const digitMatch = code.match(/^Digit(\d)$/);
  if (digitMatch) return 0x30 + parseInt(digitMatch[1]);

  // F1-F24 → 0x70-0x87
  const fMatch = code.match(/^F(\d+)$/);
  if (fMatch) {
    const n = parseInt(fMatch[1]);
    if (n >= 1 && n <= 24) return 0x6f + n;
  }

  return null; // 未映射的键不转发
}

/**
 * 注册 keydown/keyup 全局监听，将按键事件通过 IPC 注入后端钩子通道。
 * 当 WebView2 获得焦点时，WH_KEYBOARD_LL 钩子收不到按键，JS 层补偿。
 * 当焦点不在 WebView2 时，JS 不会触发，两者天然互斥不会重复。
 * @returns 清理函数
 */
export function setupKeyEventBridge(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (suspended || e.repeat) return;
    const vk = codeToVk(e.code);
    if (vk !== null) {
      invoke("cmd_inject_key_event", { vkCode: vk, isDown: true });
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (suspended) return;
    const vk = codeToVk(e.code);
    if (vk !== null) {
      invoke("cmd_inject_key_event", { vkCode: vk, isDown: false });
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}
