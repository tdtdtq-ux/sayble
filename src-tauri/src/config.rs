use serde::{Deserialize, Serialize};

/// 应用状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppState {
    Idle,
    Recording,
    Recognizing,
}

impl Default for AppState {
    fn default() -> Self {
        Self::Idle
    }
}

/// 修饰键（区分左右）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Modifier {
    LeftCtrl,
    RightCtrl,
    LeftAlt,
    RightAlt,
    LeftShift,
    RightShift,
}

impl std::fmt::Display for Modifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Modifier::LeftCtrl => write!(f, "左Ctrl"),
            Modifier::RightCtrl => write!(f, "右Ctrl"),
            Modifier::LeftAlt => write!(f, "左Alt"),
            Modifier::RightAlt => write!(f, "右Alt"),
            Modifier::LeftShift => write!(f, "左Shift"),
            Modifier::RightShift => write!(f, "右Shift"),
        }
    }
}

/// 快捷键组合
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HotkeyBinding {
    pub modifiers: Vec<Modifier>,
    /// 主键的虚拟键码（Windows VK code），0 表示仅修饰键触发
    pub key: u32,
}

impl Default for HotkeyBinding {
    fn default() -> Self {
        Self {
            modifiers: vec![],
            key: 0,
        }
    }
}

/// 快捷键触发模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HotkeyMode {
    /// 按一次开始，再按一次停止
    Toggle,
    /// 按住录音，松开停止
    HoldToRecord,
}

/// 快捷键配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotkeyConfig {
    pub mode: HotkeyMode,
    pub binding: HotkeyBinding,
}

/// 火山引擎 ASR 配置（v3 大模型流式语音识别）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrConfig {
    pub app_id: String,
    #[serde(alias = "access_token")]
    pub access_key: String,
    #[serde(alias = "cluster")]
    pub resource_id: String,
    /// 优先语言: "zh", "en", "auto"
    pub language: String,
    /// 是否自动添加标点
    pub auto_punctuation: bool,
}

impl Default for AsrConfig {
    fn default() -> Self {
        Self {
            app_id: String::new(),
            access_key: String::new(),
            resource_id: "volc.bigasr.sauc.duration".to_string(),
            language: "zh".to_string(),
            auto_punctuation: true,
        }
    }
}

/// 输出方式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OutputMode {
    /// 剪贴板粘贴
    Clipboard,
    /// 模拟键盘输入
    SimulateKeyboard,
}

impl Default for OutputMode {
    fn default() -> Self {
        Self::Clipboard
    }
}

/// 完整应用配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub toggle_hotkey: HotkeyConfig,
    pub hold_hotkey: HotkeyConfig,
    pub asr: AsrConfig,
    pub output_mode: OutputMode,
    /// 麦克风设备名（空字符串表示默认设备）
    pub microphone_device: String,
    /// 开机自启
    pub auto_start: bool,
    /// 识别完成后是否自动输出（false 则先预览确认）
    pub auto_output: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            toggle_hotkey: HotkeyConfig {
                mode: HotkeyMode::Toggle,
                binding: HotkeyBinding {
                    modifiers: vec![Modifier::RightCtrl],
                    key: 0,
                },
            },
            hold_hotkey: HotkeyConfig {
                mode: HotkeyMode::HoldToRecord,
                binding: HotkeyBinding {
                    modifiers: vec![Modifier::LeftCtrl],
                    key: 0x20, // VK_SPACE
                },
            },
            asr: AsrConfig::default(),
            output_mode: OutputMode::default(),
            microphone_device: String::new(),
            auto_start: false,
            auto_output: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert_eq!(config.toggle_hotkey.mode, HotkeyMode::Toggle);
        assert_eq!(config.hold_hotkey.mode, HotkeyMode::HoldToRecord);
        assert_eq!(config.asr.language, "zh");
        assert!(config.asr.auto_punctuation);
        assert_eq!(config.output_mode, OutputMode::Clipboard);
        assert!(config.auto_output);
    }

    #[test]
    fn test_config_serialization() {
        let config = AppConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.toggle_hotkey.mode, config.toggle_hotkey.mode);
        assert_eq!(deserialized.asr.language, config.asr.language);
    }

    #[test]
    fn test_modifier_display() {
        assert_eq!(format!("{}", Modifier::LeftCtrl), "左Ctrl");
        assert_eq!(format!("{}", Modifier::RightAlt), "右Alt");
    }

    #[test]
    fn test_app_state_default() {
        let state = AppState::default();
        assert_eq!(state, AppState::Idle);
    }

    #[test]
    fn test_hotkey_binding_default() {
        let binding = HotkeyBinding::default();
        assert!(binding.modifiers.is_empty());
        assert_eq!(binding.key, 0);
    }
}
