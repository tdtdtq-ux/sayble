use serde::{Deserialize, Serialize};

pub mod protocol;
pub mod volcengine;
#[cfg(target_os = "windows")]
pub mod sapi;

pub use volcengine::VolcEngineAsr;

/// ASR 识别事件（所有引擎共用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AsrEvent {
    /// 中间识别结果（边说边出字）
    PartialResult(String),
    /// 最终识别结果 (文本, 音频时长毫秒)
    FinalResult(String, Option<i64>),
    /// 错误
    Error(String),
    /// 连接已建立
    Connected,
    /// 连接已关闭
    Disconnected,
}
