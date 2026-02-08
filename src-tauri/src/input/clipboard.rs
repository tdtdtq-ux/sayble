use arboard::Clipboard;
use std::sync::Mutex;

static CLIPBOARD_LOCK: Mutex<()> = Mutex::new(());

pub struct ClipboardOutput;

impl ClipboardOutput {
    /// 通过剪贴板粘贴文字到当前焦点应用
    /// 1. 备份原剪贴板内容
    /// 2. 写入识别结果
    /// 3. 模拟 Ctrl+V
    /// 4. 恢复原剪贴板内容
    pub fn paste(text: &str) -> Result<(), String> {
        log::info!("[output] clipboard paste start, text_len={}", text.len());
        let _lock = CLIPBOARD_LOCK.lock().map_err(|e| e.to_string())?;

        let mut clipboard =
            Clipboard::new().map_err(|e| {
                log::error!("[output] failed to access clipboard: {}", e);
                format!("Failed to access clipboard: {}", e)
            })?;

        // 备份原剪贴板内容
        let backup = clipboard.get_text().ok();

        // 写入识别结果
        clipboard
            .set_text(text)
            .map_err(|e| {
                log::error!("[output] failed to set clipboard text: {}", e);
                format!("Failed to set clipboard: {}", e)
            })?;

        // 短暂延迟确保剪贴板数据就绪
        std::thread::sleep(std::time::Duration::from_millis(50));

        // 模拟 Ctrl+V
        simulate_ctrl_v().map_err(|e| {
            log::error!("[output] simulate Ctrl+V failed: {}", e);
            e
        })?;

        // 等待粘贴完成
        std::thread::sleep(std::time::Duration::from_millis(100));

        // 恢复原剪贴板内容
        if let Some(original) = backup {
            let _ = clipboard.set_text(original);
        }

        log::info!("[output] clipboard paste done");
        Ok(())
    }

    /// 仅写入剪贴板，不粘贴
    pub fn copy_to_clipboard(text: &str) -> Result<(), String> {
        let _lock = CLIPBOARD_LOCK.lock().map_err(|e| e.to_string())?;
        let mut clipboard =
            Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
        clipboard
            .set_text(text)
            .map_err(|e| format!("Failed to set clipboard: {}", e))?;
        Ok(())
    }

    /// 读取剪贴板内容
    pub fn get_clipboard_text() -> Result<String, String> {
        let _lock = CLIPBOARD_LOCK.lock().map_err(|e| e.to_string())?;
        let mut clipboard =
            Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
        clipboard
            .get_text()
            .map_err(|e| format!("Failed to get clipboard: {}", e))
    }
}

#[cfg(windows)]
fn simulate_ctrl_v() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Failed to create Enigo: {}", e))?;

    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| format!("Failed to press Ctrl: {}", e))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| format!("Failed to press V: {}", e))?;
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| format!("Failed to release Ctrl: {}", e))?;

    Ok(())
}

#[cfg(not(windows))]
fn simulate_ctrl_v() -> Result<(), String> {
    Err("Clipboard paste simulation is only supported on Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_copy_to_clipboard_and_read() {
        let test_text = "voice_keyboard_test_123";
        let result = ClipboardOutput::copy_to_clipboard(test_text);
        // 在 CI 环境中剪贴板可能不可用
        match result {
            Ok(()) => {
                let read = ClipboardOutput::get_clipboard_text().unwrap();
                assert_eq!(read, test_text);
            }
            Err(_) => {
                // 无剪贴板环境（CI），跳过
            }
        }
    }

    #[test]
    fn test_clipboard_lock_concurrent() {
        // 测试锁不会死锁
        {
            let _lock = CLIPBOARD_LOCK.lock().unwrap();
        }
        {
            let _lock = CLIPBOARD_LOCK.lock().unwrap();
        }
    }
}
