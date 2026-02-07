use crate::asr::protocol::{
    build_audio_request, build_full_client_request, parse_server_response, AsrRequest,
};
use crate::config::AsrConfig;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{self, Message},
};

const ASR_WSS_URL: &str = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";

/// ASR 识别事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AsrEvent {
    /// 中间识别结果（边说边出字）
    PartialResult(String),
    /// 最终识别结果
    FinalResult(String),
    /// 错误
    Error(String),
    /// 连接已建立
    Connected,
    /// 连接已关闭
    Disconnected,
}

/// 火山引擎 ASR 客户端
pub struct VolcEngineAsr {
    config: Arc<Mutex<AsrConfig>>,
    event_tx: Option<mpsc::Sender<AsrEvent>>,
    audio_tx: Option<tokio::sync::mpsc::Sender<Vec<i16>>>,
    is_running: Arc<Mutex<bool>>,
}

impl VolcEngineAsr {
    pub fn new(config: AsrConfig) -> Self {
        Self {
            config: Arc::new(Mutex::new(config)),
            event_tx: None,
            audio_tx: None,
            is_running: Arc::new(Mutex::new(false)),
        }
    }

    pub fn update_config(&self, config: AsrConfig) {
        if let Ok(mut c) = self.config.lock() {
            *c = config;
        }
    }

    /// 验证配置是否有效（非空检查）
    pub fn validate_config(config: &AsrConfig) -> Result<(), String> {
        if config.app_id.trim().is_empty() {
            return Err("App ID 不能为空".to_string());
        }
        if config.access_key.trim().is_empty() {
            return Err("Access Key 不能为空".to_string());
        }
        if config.resource_id.trim().is_empty() {
            return Err("Resource ID 不能为空".to_string());
        }
        Ok(())
    }

    /// 启动一次识别会话
    /// 返回 (event_rx, audio_tx)
    /// - event_rx: 接收识别事件
    /// - audio_tx: 发送 PCM 音频数据（i16 samples, 16kHz mono）
    pub fn start_session(
        &mut self,
    ) -> Result<
        (
            mpsc::Receiver<AsrEvent>,
            tokio::sync::mpsc::Sender<Vec<i16>>,
        ),
        String,
    > {
        let config = self
            .config
            .lock()
            .map_err(|e| e.to_string())?
            .clone();

        Self::validate_config(&config)?;

        let (event_tx, event_rx) = mpsc::channel();
        let (audio_tx, audio_rx) = tokio::sync::mpsc::channel::<Vec<i16>>(100);

        self.event_tx = Some(event_tx.clone());
        self.audio_tx = Some(audio_tx.clone());

        let is_running = self.is_running.clone();
        *is_running.lock().map_err(|e| e.to_string())? = true;

        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                if let Err(e) =
                    run_asr_session(config, event_tx.clone(), audio_rx, is_running).await
                {
                    let _ = event_tx.send(AsrEvent::Error(e));
                }
            });
        });

        Ok((event_rx, audio_tx))
    }

    /// 停止当前会话
    pub fn stop_session(&mut self) {
        if let Ok(mut running) = self.is_running.lock() {
            *running = false;
        }
        self.audio_tx = None;
        self.event_tx = None;
    }

    pub fn is_running(&self) -> bool {
        self.is_running
            .lock()
            .map(|r| *r)
            .unwrap_or(false)
    }
}

/// 构建 WebSocket 握手请求
fn build_ws_request(config: &AsrConfig, connect_id: &str) -> Result<tungstenite::http::Request<()>, String> {
    let url = url::Url::parse(ASR_WSS_URL).map_err(|e| format!("URL parse error: {}", e))?;
    tungstenite::http::Request::builder()
        .uri(ASR_WSS_URL)
        .header("Host", url.host_str().unwrap_or("openspeech.bytedance.com"))
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header(
            "Sec-WebSocket-Key",
            tungstenite::handshake::client::generate_key(),
        )
        .header("X-Api-App-Key", &config.app_id)
        .header("X-Api-Access-Key", &config.access_key)
        .header("X-Api-Resource-Id", &config.resource_id)
        .header("X-Api-Connect-Id", connect_id)
        .body(())
        .map_err(|e| format!("Request build error: {}", e))
}

/// 测试 ASR 连接：建立 WebSocket，发送初始化帧，等待服务端响应
pub async fn test_connection(config: &AsrConfig) -> Result<String, String> {
    VolcEngineAsr::validate_config(config)?;

    let connect_id = uuid::Uuid::new_v4().to_string();
    let request = build_ws_request(config, &connect_id)?;

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("WebSocket 连接失败: {}", e))?;

    let (mut write, mut read) = ws_stream.split();

    // 发送 full client request 初始化帧
    let asr_request = AsrRequest::new(config.auto_punctuation);
    let full_request = build_full_client_request(&asr_request)?;
    write
        .send(Message::Binary(full_request.into()))
        .await
        .map_err(|e| format!("发送初始化帧失败: {}", e))?;

    // 等待服务端首个响应，5 秒超时
    let response = tokio::time::timeout(std::time::Duration::from_secs(5), read.next())
        .await
        .map_err(|_| "等待服务端响应超时（5秒）".to_string())?;

    // 关闭连接
    let _ = write.send(Message::Close(None)).await;

    match response {
        Some(Ok(Message::Binary(data))) => match parse_server_response(&data) {
            Ok((header, Some(resp))) => {
                if header.is_server_error() {
                    let msg = resp
                        .message
                        .unwrap_or_else(|| "Unknown server error".to_string());
                    Err(format!("服务端返回错误: {}", msg))
                } else {
                    Ok("ASR 连接测试成功，服务端响应正常".to_string())
                }
            }
            Ok((header, None)) => {
                if header.is_server_ack() {
                    Ok("ASR 连接测试成功，收到服务端 ACK".to_string())
                } else {
                    Ok("ASR 连接测试成功，已建立连接".to_string())
                }
            }
            Err(e) => Err(format!("解析服务端响应失败: {}", e)),
        },
        Some(Ok(Message::Close(frame))) => {
            let reason = frame
                .map(|f| f.reason.to_string())
                .unwrap_or_else(|| "无原因".to_string());
            Err(format!("服务端关闭了连接: {}", reason))
        }
        Some(Err(e)) => Err(format!("WebSocket 错误: {}", e)),
        None => Err("服务端未返回任何响应".to_string()),
        _ => Ok("ASR 连接测试成功".to_string()),
    }
}

pub async fn run_asr_session(
    config: AsrConfig,
    event_tx: mpsc::Sender<AsrEvent>,
    mut audio_rx: tokio::sync::mpsc::Receiver<Vec<i16>>,
    is_running: Arc<Mutex<bool>>,
) -> Result<(), String> {
    // 建立 WebSocket 连接
    let connect_id = uuid::Uuid::new_v4().to_string();
    let request = build_ws_request(&config, &connect_id)?;

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connect error: {}", e))?;

    let _ = event_tx.send(AsrEvent::Connected);
    log::info!("ASR WebSocket connected, connect_id={}", connect_id);

    let (mut write, mut read) = ws_stream.split();

    // 发送 full client request
    let asr_request = AsrRequest::new(config.auto_punctuation);
    let full_request = build_full_client_request(&asr_request)?;
    write
        .send(Message::Binary(full_request.into()))
        .await
        .map_err(|e| format!("Send full request error: {}", e))?;

    log::info!("Full client request sent");

    // 启动接收任务
    let event_tx_recv = event_tx.clone();
    let is_running_recv = is_running.clone();
    let recv_task = tokio::spawn(async move {
        while *is_running_recv.lock().unwrap_or_else(|e| e.into_inner()) {
            match read.next().await {
                Some(Ok(Message::Binary(data))) => {
                    match parse_server_response(&data) {
                        Ok((header, Some(response))) => {
                            if header.is_server_error() {
                                let msg = response
                                    .message
                                    .unwrap_or_else(|| "Unknown error".to_string());
                                let _ = event_tx_recv.send(AsrEvent::Error(msg));
                                break;
                            }

                            if let Some(result) = &response.result {
                                if let Some(text) = &result.text {
                                    if !text.is_empty() {
                                        if header.is_last_package() {
                                            let _ = event_tx_recv
                                                .send(AsrEvent::FinalResult(text.clone()));
                                        } else {
                                            let _ = event_tx_recv
                                                .send(AsrEvent::PartialResult(text.clone()));
                                        }
                                    }
                                }
                            }
                        }
                        Ok((header, None)) => {
                            if header.is_server_ack() {
                                log::debug!("Server ACK received");
                            }
                        }
                        Err(e) => {
                            log::error!("Parse response error: {}", e);
                        }
                    }
                }
                Some(Ok(Message::Close(frame))) => {
                    let reason = frame
                        .as_ref()
                        .map(|f| format!("code={}, reason={}", f.code, f.reason))
                        .unwrap_or_else(|| "no frame".to_string());
                    log::info!("WebSocket closed by server: {}", reason);
                    break;
                }
                Some(Err(e)) => {
                    log::error!("WebSocket recv error: {}", e);
                    let _ = event_tx_recv.send(AsrEvent::Error(format!("WebSocket error: {}", e)));
                    break;
                }
                None => {
                    log::info!("WebSocket stream ended (None)");
                    break;
                }
                _ => {}
            }
        }
        let _ = event_tx_recv.send(AsrEvent::Disconnected);
    });

    // 发送音频数据
    while *is_running.lock().unwrap_or_else(|e| e.into_inner()) {
        match audio_rx.recv().await {
            Some(samples) => {
                // i16 samples → bytes (little endian)
                let bytes: Vec<u8> = samples
                    .iter()
                    .flat_map(|s| s.to_le_bytes())
                    .collect();

                let frame = build_audio_request(&bytes, false)?;
                if let Err(e) = write.send(Message::Binary(frame.into())).await {
                    log::error!("Send audio error: {}", e);
                    break;
                }
            }
            None => {
                // audio channel closed, send last frame
                let frame = build_audio_request(&[], true)?;
                let _ = write.send(Message::Binary(frame.into())).await;
                log::info!("Audio stream ended, last frame sent");
                break;
            }
        }
    }

    // 等待接收任务完成（服务端返回最终结果）
    let _ = tokio::time::timeout(std::time::Duration::from_secs(10), recv_task).await;

    if let Ok(mut running) = is_running.lock() {
        *running = false;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AsrConfig;

    #[test]
    fn test_volcengine_asr_new() {
        let config = AsrConfig::default();
        let asr = VolcEngineAsr::new(config);
        assert!(!asr.is_running());
    }

    #[test]
    fn test_volcengine_asr_update_config() {
        let config = AsrConfig::default();
        let asr = VolcEngineAsr::new(config);

        let new_config = AsrConfig {
            app_id: "new_app".to_string(),
            access_key: "new_key".to_string(),
            resource_id: "new_resource".to_string(),
            ..Default::default()
        };
        asr.update_config(new_config);

        let c = asr.config.lock().unwrap();
        assert_eq!(c.app_id, "new_app");
    }

    #[test]
    fn test_validate_config_empty_app_id() {
        let config = AsrConfig {
            app_id: "".to_string(),
            access_key: "key".to_string(),
            resource_id: "resource".to_string(),
            ..Default::default()
        };
        let result = VolcEngineAsr::validate_config(&config);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("App ID"));
    }

    #[test]
    fn test_validate_config_empty_access_key() {
        let config = AsrConfig {
            app_id: "app".to_string(),
            access_key: "".to_string(),
            resource_id: "resource".to_string(),
            ..Default::default()
        };
        let result = VolcEngineAsr::validate_config(&config);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Access Key"));
    }

    #[test]
    fn test_validate_config_empty_resource_id() {
        let config = AsrConfig {
            app_id: "app".to_string(),
            access_key: "key".to_string(),
            resource_id: "  ".to_string(),
            ..Default::default()
        };
        let result = VolcEngineAsr::validate_config(&config);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Resource ID"));
    }

    #[test]
    fn test_validate_config_valid() {
        let config = AsrConfig {
            app_id: "app".to_string(),
            access_key: "key".to_string(),
            resource_id: "resource".to_string(),
            ..Default::default()
        };
        assert!(VolcEngineAsr::validate_config(&config).is_ok());
    }

    #[test]
    fn test_start_session_without_config() {
        let config = AsrConfig::default(); // empty strings
        let mut asr = VolcEngineAsr::new(config);
        let result = asr.start_session();
        assert!(result.is_err());
    }

    #[test]
    fn test_asr_event_serialization() {
        let event = AsrEvent::FinalResult("你好".to_string());
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("你好"));

        let event_err = AsrEvent::Error("connection failed".to_string());
        let json_err = serde_json::to_string(&event_err).unwrap();
        assert!(json_err.contains("connection failed"));
    }

    #[test]
    fn test_stop_session() {
        let config = AsrConfig::default();
        let mut asr = VolcEngineAsr::new(config);
        asr.stop_session();
        assert!(!asr.is_running());
        assert!(asr.audio_tx.is_none());
        assert!(asr.event_tx.is_none());
    }

    #[tokio::test]
    #[ignore] // 需要 .env.local 中配置有效密钥，手动运行: cargo test -- --ignored
    async fn test_connection_with_real_config() {
        // 从项目根目录的 .env.local 读取配置
        let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".env.local");
        dotenvy::from_path(&env_path).expect("Failed to load .env.local");

        let config = AsrConfig {
            app_id: std::env::var("ASR_APP_ID").expect("ASR_APP_ID not set"),
            access_key: std::env::var("ASR_ACCESS_KEY").expect("ASR_ACCESS_KEY not set"),
            resource_id: std::env::var("ASR_RESOURCE_ID")
                .unwrap_or_else(|_| "volc.bigasr.sauc.duration".to_string()),
            ..Default::default()
        };

        let result = test_connection(&config).await;
        println!("Test connection result: {:?}", result);
        assert!(result.is_ok(), "Connection test failed: {:?}", result.err());
    }
}
