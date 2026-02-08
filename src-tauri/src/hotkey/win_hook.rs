use crate::config::{HotkeyBinding, HotkeyConfig, HotkeyMode, Modifier};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

#[cfg(windows)]
use std::sync::atomic::{AtomicPtr, Ordering};

#[cfg(windows)]
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_RCONTROL, VK_RMENU, VK_RSHIFT,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
    UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_QUIT,
    WM_SYSKEYDOWN, WM_SYSKEYUP,
};
#[cfg(windows)]
use windows::Win32::System::Threading::GetThreadId;

/// 快捷键事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HotkeyEvent {
    /// 开始录音
    StartRecording,
    /// 停止录音
    StopRecording,
    /// 切换录音状态
    ToggleRecording,
    /// 取消录音
    CancelRecording,
}

/// 按键状态追踪
#[derive(Debug, Default)]
struct KeyState {
    pressed_modifiers: HashSet<u32>,
    pressed_keys: HashSet<u32>,
}

impl KeyState {
    fn modifier_from_vk(vk: u32) -> Option<Modifier> {
        match vk {
            vk if vk == VK_LCONTROL.0 as u32 => Some(Modifier::LeftCtrl),
            vk if vk == VK_RCONTROL.0 as u32 => Some(Modifier::RightCtrl),
            vk if vk == VK_LMENU.0 as u32 => Some(Modifier::LeftAlt),
            vk if vk == VK_RMENU.0 as u32 => Some(Modifier::RightAlt),
            vk if vk == VK_LSHIFT.0 as u32 => Some(Modifier::LeftShift),
            vk if vk == VK_RSHIFT.0 as u32 => Some(Modifier::RightShift),
            _ => None,
        }
    }

    #[allow(dead_code)]
    pub fn vk_from_modifier(modifier: &Modifier) -> u32 {
        match modifier {
            Modifier::LeftCtrl => VK_LCONTROL.0 as u32,
            Modifier::RightCtrl => VK_RCONTROL.0 as u32,
            Modifier::LeftAlt => VK_LMENU.0 as u32,
            Modifier::RightAlt => VK_RMENU.0 as u32,
            Modifier::LeftShift => VK_LSHIFT.0 as u32,
            Modifier::RightShift => VK_RSHIFT.0 as u32,
        }
    }

    fn is_modifier(vk: u32) -> bool {
        Self::modifier_from_vk(vk).is_some()
    }

    fn active_modifiers(&self) -> HashSet<Modifier> {
        self.pressed_modifiers
            .iter()
            .filter_map(|&vk| Self::modifier_from_vk(vk))
            .collect()
    }

    fn matches_binding(&self, binding: &HotkeyBinding) -> bool {
        let active = self.active_modifiers();
        let required: HashSet<Modifier> = binding.modifiers.iter().cloned().collect();

        if active != required {
            return false;
        }

        if binding.key == 0 {
            // 仅修饰键模式：不能有其他普通键同时按下
            self.pressed_keys.is_empty()
        } else {
            self.pressed_keys.contains(&binding.key)
        }
    }
}

pub struct HotkeyManager {
    event_rx: Option<mpsc::Receiver<HotkeyEvent>>,
    configs: Arc<Mutex<Vec<HotkeyConfig>>>,
    running: Arc<Mutex<bool>>,
    #[cfg(windows)]
    hook_thread_id: Arc<Mutex<Option<u32>>>,
}

#[cfg(windows)]
struct HookCallbackData {
    sender: mpsc::Sender<RawKeyEvent>,
}

#[cfg(windows)]
static GLOBAL_HOOK_DATA: AtomicPtr<HookCallbackData> = AtomicPtr::new(std::ptr::null_mut());

#[cfg(windows)]
#[derive(Debug)]
enum RawKeyEvent {
    KeyDown(u32),
    KeyUp(u32),
}

impl HotkeyManager {
    pub fn new(configs: Vec<HotkeyConfig>) -> Self {
        Self {
            event_rx: None,
            configs: Arc::new(Mutex::new(configs)),
            running: Arc::new(Mutex::new(false)),
            #[cfg(windows)]
            hook_thread_id: Arc::new(Mutex::new(None)),
        }
    }

    pub fn update_configs(&self, configs: Vec<HotkeyConfig>) {
        if let Ok(mut c) = self.configs.lock() {
            *c = configs;
        }
    }

    #[cfg(windows)]
    pub fn start(&mut self) -> Result<(), String> {
        if *self.running.lock().map_err(|e| e.to_string())? {
            return Err("Hotkey manager already running".to_string());
        }

        let (event_tx, event_rx) = mpsc::channel();
        self.event_rx = Some(event_rx);

        let configs = self.configs.clone();
        let running = self.running.clone();
        let hook_thread_id = self.hook_thread_id.clone();

        *running.lock().map_err(|e| e.to_string())? = true;

        thread::spawn(move || {
            let (raw_tx, raw_rx) = mpsc::channel::<RawKeyEvent>();

            let hook_thread_id_inner = hook_thread_id.clone();

            // 安装底层键盘钩子的线程
            let hook_thread = thread::spawn(move || {
                // 使用 AtomicPtr 替代 static mut，消除数据竞争
                let hook_data = Box::new(HookCallbackData { sender: raw_tx });
                let ptr = Box::into_raw(hook_data);
                GLOBAL_HOOK_DATA.store(ptr, Ordering::SeqCst);

                unsafe {
                    // 保存当前线程 ID，以便 stop() 可以发送 WM_QUIT
                    let current_thread = windows::Win32::System::Threading::GetCurrentThread();
                    let tid = GetThreadId(current_thread);
                    if tid != 0 {
                        if let Ok(mut id) = hook_thread_id_inner.lock() {
                            *id = Some(tid);
                        }
                    }

                    let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), None, 0);

                    match hook {
                        Ok(hook) => {
                            log::info!("[hotkey] keyboard hook installed");
                            // 消息循环（保持钩子活跃）
                            let mut msg = MSG::default();
                            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                                let _ = DispatchMessageW(&msg);
                            }
                            let _ = UnhookWindowsHookEx(hook);
                            log::info!("[hotkey] keyboard hook uninstalled");
                        }
                        Err(e) => {
                            log::error!("[hotkey] failed to install keyboard hook: {:?}", e);
                        }
                    }
                }

                // 清理 AtomicPtr 中的数据
                let old_ptr = GLOBAL_HOOK_DATA.swap(std::ptr::null_mut(), Ordering::SeqCst);
                if !old_ptr.is_null() {
                    unsafe { drop(Box::from_raw(old_ptr)); }
                }
            });

            // 状态处理线程
            let mut key_state = KeyState::default();
            let mut hold_active = false;

            log::info!("[hotkey] state processing loop started, configs count: {}", configs.lock().map(|c| c.len()).unwrap_or(0));

            while *running.lock().unwrap_or_else(|e| e.into_inner()) {
                match raw_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(raw_event) => {
                        let configs = configs.lock().unwrap_or_else(|e| e.into_inner()).clone();

                        match raw_event {
                            RawKeyEvent::KeyDown(vk) => {
                                // 去重：忽略 Windows 按键重复（键已在 pressed 集合中）
                                let is_repeat = if KeyState::is_modifier(vk) {
                                    !key_state.pressed_modifiers.insert(vk)
                                } else {
                                    !key_state.pressed_keys.insert(vk)
                                };
                                if is_repeat {
                                    continue;
                                }

                                log::debug!("[hotkey] KeyDown vk=0x{:X}, is_modifier={}, active_modifiers={:?}, pressed_keys={:?}",
                                    vk, KeyState::is_modifier(vk), key_state.active_modifiers(), key_state.pressed_keys);

                                // 检查 ESC 键取消（始终发送，由前端判断是否在录音）
                                if vk == 0x1B {
                                    // VK_ESCAPE
                                    log::info!("[hotkey] ESC cancel, hold_active={}", hold_active);
                                    let _ = event_tx.send(HotkeyEvent::CancelRecording);
                                    hold_active = false;
                                    continue;
                                }

                                for config in &configs {
                                    let matched = key_state.matches_binding(&config.binding);
                                    if matched {
                                        match config.mode {
                                            HotkeyMode::Toggle => {
                                                log::info!("[hotkey] Toggle => sending ToggleRecording");
                                                let _ = event_tx.send(HotkeyEvent::ToggleRecording);
                                            }
                                            HotkeyMode::HoldToRecord => {
                                                if !hold_active {
                                                    hold_active = true;
                                                    log::info!("[hotkey] HoldToRecord => sending StartRecording");
                                                    let _ = event_tx
                                                        .send(HotkeyEvent::StartRecording);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            RawKeyEvent::KeyUp(vk) => {
                                if KeyState::is_modifier(vk) {
                                    key_state.pressed_modifiers.remove(&vk);
                                } else {
                                    key_state.pressed_keys.remove(&vk);
                                }

                                // 长按模式松开检测
                                if hold_active {
                                    let hold_configs: Vec<_> = configs
                                        .iter()
                                        .filter(|c| c.mode == HotkeyMode::HoldToRecord)
                                        .collect();
                                    for config in &hold_configs {
                                        if !key_state.matches_binding(&config.binding) {
                                            hold_active = false;
                                            let _ = event_tx.send(HotkeyEvent::StopRecording);
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }

            // 优雅退出：向钩子线程发送 WM_QUIT 使 GetMessageW 返回 false
            if let Ok(id) = hook_thread_id.lock() {
                if let Some(tid) = *id {
                    unsafe {
                        let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
                    }
                }
            }
            let _ = hook_thread.join();
        });

        Ok(())
    }

    #[cfg(not(windows))]
    pub fn start(&mut self) -> Result<(), String> {
        Err("Hotkey manager is only supported on Windows".to_string())
    }

    pub fn stop(&self) {
        if let Ok(mut running) = self.running.lock() {
            *running = false;
        }
        // 向钩子线程发送 WM_QUIT，终止消息循环
        #[cfg(windows)]
        if let Ok(id) = self.hook_thread_id.lock() {
            if let Some(tid) = *id {
                unsafe {
                    let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
                }
            }
        }
    }

    pub fn try_recv(&self) -> Option<HotkeyEvent> {
        self.event_rx.as_ref()?.try_recv().ok()
    }

    pub fn is_running(&self) -> bool {
        self.running
            .lock()
            .map(|r| *r)
            .unwrap_or(false)
    }
}

#[cfg(windows)]
unsafe extern "system" fn keyboard_hook_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code >= 0 {
        let kb_struct = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let vk = kb_struct.vkCode;

        // 通过 AtomicPtr 安全读取全局钩子数据（无数据竞争）
        let ptr = GLOBAL_HOOK_DATA.load(Ordering::SeqCst);
        if !ptr.is_null() {
            let hook_data = unsafe { &*ptr };
            let event = match wparam.0 as u32 {
                WM_KEYDOWN | WM_SYSKEYDOWN => Some(RawKeyEvent::KeyDown(vk)),
                WM_KEYUP | WM_SYSKEYUP => Some(RawKeyEvent::KeyUp(vk)),
                _ => None,
            };

            if let Some(event) = event {
                let _ = hook_data.sender.send(event);
            }
        }
    }

    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_modifier_from_vk() {
        assert_eq!(
            KeyState::modifier_from_vk(VK_LCONTROL.0 as u32),
            Some(Modifier::LeftCtrl)
        );
        assert_eq!(
            KeyState::modifier_from_vk(VK_RCONTROL.0 as u32),
            Some(Modifier::RightCtrl)
        );
        assert_eq!(
            KeyState::modifier_from_vk(VK_LMENU.0 as u32),
            Some(Modifier::LeftAlt)
        );
        assert_eq!(
            KeyState::modifier_from_vk(VK_RMENU.0 as u32),
            Some(Modifier::RightAlt)
        );
        assert_eq!(
            KeyState::modifier_from_vk(VK_LSHIFT.0 as u32),
            Some(Modifier::LeftShift)
        );
        assert_eq!(
            KeyState::modifier_from_vk(VK_RSHIFT.0 as u32),
            Some(Modifier::RightShift)
        );
        // 非修饰键
        assert_eq!(KeyState::modifier_from_vk(0x41), None); // 'A'
    }

    #[test]
    fn test_vk_from_modifier() {
        assert_eq!(
            KeyState::vk_from_modifier(&Modifier::LeftCtrl),
            VK_LCONTROL.0 as u32
        );
        assert_eq!(
            KeyState::vk_from_modifier(&Modifier::RightCtrl),
            VK_RCONTROL.0 as u32
        );
    }

    #[test]
    fn test_is_modifier() {
        assert!(KeyState::is_modifier(VK_LCONTROL.0 as u32));
        assert!(KeyState::is_modifier(VK_RSHIFT.0 as u32));
        assert!(!KeyState::is_modifier(0x41)); // 'A'
        assert!(!KeyState::is_modifier(0x20)); // Space
    }

    #[test]
    fn test_key_state_default() {
        let state = KeyState::default();
        assert!(state.pressed_modifiers.is_empty());
        assert!(state.pressed_keys.is_empty());
    }

    #[test]
    fn test_active_modifiers() {
        let mut state = KeyState::default();
        state.pressed_modifiers.insert(VK_LCONTROL.0 as u32);
        state.pressed_modifiers.insert(VK_LSHIFT.0 as u32);

        let active = state.active_modifiers();
        assert!(active.contains(&Modifier::LeftCtrl));
        assert!(active.contains(&Modifier::LeftShift));
        assert!(!active.contains(&Modifier::RightCtrl));
        assert_eq!(active.len(), 2);
    }

    #[test]
    fn test_matches_binding_modifier_only() {
        let mut state = KeyState::default();
        state.pressed_modifiers.insert(VK_RCONTROL.0 as u32);

        // 仅右Ctrl
        let binding = HotkeyBinding {
            modifiers: vec![Modifier::RightCtrl],
            key: 0,
        };
        assert!(state.matches_binding(&binding));

        // 左Ctrl 不匹配
        let binding_left = HotkeyBinding {
            modifiers: vec![Modifier::LeftCtrl],
            key: 0,
        };
        assert!(!state.matches_binding(&binding_left));
    }

    #[test]
    fn test_matches_binding_modifier_plus_key() {
        let mut state = KeyState::default();
        state.pressed_modifiers.insert(VK_LCONTROL.0 as u32);
        state.pressed_keys.insert(0x20); // Space

        let binding = HotkeyBinding {
            modifiers: vec![Modifier::LeftCtrl],
            key: 0x20,
        };
        assert!(state.matches_binding(&binding));

        // 缺少 Space 键
        let mut state_no_key = KeyState::default();
        state_no_key.pressed_modifiers.insert(VK_LCONTROL.0 as u32);
        assert!(!state_no_key.matches_binding(&binding));
    }

    #[test]
    fn test_matches_binding_extra_modifiers_fail() {
        let mut state = KeyState::default();
        state.pressed_modifiers.insert(VK_LCONTROL.0 as u32);
        state.pressed_modifiers.insert(VK_LSHIFT.0 as u32);

        // 只要求左Ctrl，但按了左Ctrl+左Shift，不应匹配
        let binding = HotkeyBinding {
            modifiers: vec![Modifier::LeftCtrl],
            key: 0,
        };
        assert!(!state.matches_binding(&binding));
    }

    #[test]
    fn test_hotkey_manager_new() {
        let configs = vec![HotkeyConfig {
            mode: HotkeyMode::Toggle,
            binding: HotkeyBinding {
                modifiers: vec![Modifier::RightCtrl],
                key: 0,
            },
        }];
        let manager = HotkeyManager::new(configs);
        assert!(!manager.is_running());
    }

    #[test]
    fn test_hotkey_manager_update_configs() {
        let manager = HotkeyManager::new(vec![]);
        let new_configs = vec![HotkeyConfig {
            mode: HotkeyMode::HoldToRecord,
            binding: HotkeyBinding {
                modifiers: vec![Modifier::LeftCtrl],
                key: 0x20,
            },
        }];
        manager.update_configs(new_configs.clone());
        let configs = manager.configs.lock().unwrap();
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].mode, HotkeyMode::HoldToRecord);
    }

    #[test]
    fn test_hotkey_manager_try_recv_none() {
        let manager = HotkeyManager::new(vec![]);
        assert!(manager.try_recv().is_none());
    }

    #[test]
    fn test_hotkey_event_serialization() {
        let event = HotkeyEvent::StartRecording;
        let json = serde_json::to_string(&event).unwrap();
        let deserialized: HotkeyEvent = serde_json::from_str(&json).unwrap();
        assert!(matches!(deserialized, HotkeyEvent::StartRecording));
    }
}
