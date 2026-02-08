use serde::{Deserialize, Serialize};

/// 模拟键盘输入模式（逐字符输入，适合英文场景）
pub struct SimulateOutput;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulateResult {
    pub chars_sent: usize,
    pub success: bool,
}

impl SimulateOutput {
    /// 通过模拟键盘逐字符输入文字
    #[cfg(windows)]
    pub fn type_text(text: &str) -> Result<SimulateResult, String> {
        use enigo::{Enigo, Keyboard, Settings};

        let char_count = text.chars().count();
        log::info!("[output] simulate keyboard start, chars={}", char_count);

        let mut enigo = Enigo::new(&Settings::default())
            .map_err(|e| {
                log::error!("[output] failed to create Enigo: {}", e);
                format!("Failed to create Enigo: {}", e)
            })?;

        // 短暂延迟让目标窗口获取焦点
        std::thread::sleep(std::time::Duration::from_millis(50));

        enigo
            .text(text)
            .map_err(|e| {
                log::error!("[output] failed to type text: {}", e);
                format!("Failed to type text: {}", e)
            })?;

        log::info!("[output] simulate keyboard done, chars_sent={}", char_count);
        Ok(SimulateResult {
            chars_sent: char_count,
            success: true,
        })
    }

    #[cfg(not(windows))]
    pub fn type_text(_text: &str) -> Result<SimulateResult, String> {
        Err("Keyboard simulation is only supported on Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simulate_result_serialization() {
        let result = SimulateResult {
            chars_sent: 5,
            success: true,
        };
        let json = serde_json::to_string(&result).unwrap();
        let deserialized: SimulateResult = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.chars_sent, 5);
        assert!(deserialized.success);
    }
}
