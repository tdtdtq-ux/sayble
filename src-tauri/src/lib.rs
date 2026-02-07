pub mod asr;
pub mod audio;
pub mod config;
pub mod hotkey;
pub mod input;
pub mod tray;

use asr::volcengine::{AsrEvent, VolcEngineAsr};
use audio::AudioCapture;
use config::{AppConfig, AsrConfig, OutputMode};
use hotkey::HotkeyManager;
use input::{ClipboardOutput, SimulateOutput};
use tray::TrayManager;

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;

/// 录音状态标志，用于 start/stop 之间通信
/// - bool: 是否正在录音
/// - Option<Sender>: drop 掉 audio_tx 来触发 ASR 发送 last frame
struct RecordingFlag {
    is_recording: bool,
    /// drop 此 sender 会使桥接线程中的 audio_tx 也被 drop，从而触发 ASR 结束
    stop_tx: Option<std::sync::mpsc::Sender<()>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            TrayManager::setup(&handle)?;

            // 使用默认配置初始化 HotkeyManager 并存入 Tauri State
            let default_config = AppConfig::default();
            let manager = HotkeyManager::new(vec![
                default_config.toggle_hotkey,
                default_config.hold_hotkey,
            ]);
            app.manage(Arc::new(Mutex::new(manager)));

            // 录音状态标志
            app.manage(Arc::new(Mutex::new(RecordingFlag {
                is_recording: false,
                stop_tx: None,
            })));

            log::info!("Voice Keyboard started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_list_audio_devices,
            cmd_output_text,
            cmd_save_settings,
            cmd_load_settings,
            cmd_test_asr_connection,
            cmd_start_recording,
            cmd_stop_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn cmd_list_audio_devices() -> Result<Vec<audio::AudioDevice>, String> {
    audio::AudioCapture::list_devices()
}

#[tauri::command]
fn cmd_output_text(text: String, mode: OutputMode) -> Result<(), String> {
    match mode {
        OutputMode::Clipboard => ClipboardOutput::paste(&text),
        OutputMode::SimulateKeyboard => {
            SimulateOutput::type_text(&text)?;
            Ok(())
        }
    }
}

#[tauri::command]
async fn cmd_test_asr_connection(
    app_id: String,
    access_key: String,
    resource_id: String,
) -> Result<String, String> {
    let config = AsrConfig {
        app_id,
        access_key,
        resource_id,
        ..Default::default()
    };
    asr::volcengine::test_connection(&config).await
}

#[tauri::command]
fn cmd_save_settings(app: tauri::AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let store = app
        .store("settings.json")
        .map_err(|e| format!("Failed to open store: {}", e))?;
    store.set("app_settings", settings);
    store.save().map_err(|e| format!("Failed to save store: {}", e))?;
    Ok(())
}

#[tauri::command]
fn cmd_load_settings(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let store = app
        .store("settings.json")
        .map_err(|e| format!("Failed to open store: {}", e))?;
    Ok(store.get("app_settings"))
}

#[tauri::command]
async fn cmd_start_recording(
    app: tauri::AppHandle,
    flag: tauri::State<'_, Arc<Mutex<RecordingFlag>>>,
    app_id: String,
    access_key: String,
    resource_id: String,
    device_name: String,
) -> Result<(), String> {
    // 检查是否已在录音
    {
        let f = flag.lock().map_err(|e| e.to_string())?;
        if f.is_recording {
            return Err("已在录音中".to_string());
        }
    }

    let asr_config = AsrConfig {
        app_id,
        access_key,
        resource_id,
        ..Default::default()
    };

    VolcEngineAsr::validate_config(&asr_config)?;

    // 1. 构建 channel，直接调用 run_asr_session（在 Tauri 的 tokio runtime 中）
    let (event_tx, event_rx) = std::sync::mpsc::channel::<AsrEvent>();
    let (audio_tx, audio_rx) = tokio::sync::mpsc::channel::<Vec<i16>>(100);
    let is_running = Arc::new(Mutex::new(true));

    // 2. 直接在 Tauri 的 tokio runtime 里 spawn ASR 会话
    let event_tx_clone = event_tx.clone();
    let is_running_clone = is_running.clone();
    tokio::spawn(async move {
        if let Err(e) =
            asr::volcengine::run_asr_session(asr_config, event_tx_clone.clone(), audio_rx, is_running_clone).await
        {
            let _ = event_tx_clone.send(AsrEvent::Error(e));
        }
    });

    // 3. 用一个 stop channel 来控制停止
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();

    // 4. 在独立线程中启动音频采集并桥接到 ASR
    let flag_clone = Arc::clone(&flag);
    let is_running_clone2 = is_running.clone();
    std::thread::spawn(move || {
        let mut audio_capture = AudioCapture::new();
        let capture_rx = match audio_capture.start(&device_name) {
            Ok(rx) => rx,
            Err(e) => {
                log::error!("Failed to start audio capture: {}", e);
                let _ = event_tx.send(AsrEvent::Error(format!("麦克风启动失败: {}", e)));
                if let Ok(mut f) = flag_clone.lock() {
                    f.is_recording = false;
                    f.stop_tx = None;
                }
                return;
            }
        };

        // 转发音频数据到 ASR
        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }
            match capture_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(samples) => {
                    if audio_tx.blocking_send(samples).is_err() {
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        // 停止采集，drop audio_tx 触发 ASR 发送 last frame
        audio_capture.stop();
        drop(audio_tx);

        if let Ok(mut running) = is_running_clone2.lock() {
            *running = false;
        }

        if let Ok(mut f) = flag_clone.lock() {
            f.is_recording = false;
            f.stop_tx = None;
        }
    });

    // 5. 后台 tokio task：轮询 ASR 事件并 emit 到前端
    tokio::spawn(async move {
        loop {
            match event_rx.try_recv() {
                Ok(event) => {
                    let _ = app.emit("asr-event", &event);
                    if matches!(event, AsrEvent::FinalResult(_) | AsrEvent::Disconnected) {
                        break;
                    }
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            }
        }
    });

    // 6. 更新状态标志
    {
        let mut f = flag.lock().map_err(|e| e.to_string())?;
        f.is_recording = true;
        f.stop_tx = Some(stop_tx);
    }

    Ok(())
}

#[tauri::command]
fn cmd_stop_recording(
    flag: tauri::State<'_, Arc<Mutex<RecordingFlag>>>,
) -> Result<(), String> {
    let mut f = flag.lock().map_err(|e| e.to_string())?;
    if !f.is_recording {
        return Err("当前没有在录音".to_string());
    }
    // 发送停止信号，桥接线程会收到后停止采集
    if let Some(tx) = f.stop_tx.take() {
        let _ = tx.send(());
    }
    f.is_recording = false;
    Ok(())
}
