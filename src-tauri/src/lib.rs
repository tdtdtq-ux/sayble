pub mod asr;
pub mod audio;
pub mod config;
pub mod hotkey;
pub mod input;
pub mod tray;

use asr::volcengine::{AsrEvent, VolcEngineAsr};
use audio::AudioCapture;
use config::{AppConfig, AsrConfig, HotkeyBinding, HotkeyConfig, HotkeyMode, OutputMode};
use hotkey::HotkeyManager;
use input::{ClipboardOutput, SimulateOutput};
use tray::TrayManager;

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;
use tauri_plugin_autostart::ManagerExt;

/// 录音状态标志，用于 start/stop 之间通信
/// session_id 用于防止旧线程清理时覆盖新录音的状态
struct RecordingFlag {
    is_recording: bool,
    session_id: u64,
    /// drop 此 sender 会使桥接线程中的 audio_tx 也被 drop，从而触发 ASR 结束
    stop_tx: Option<std::sync::mpsc::Sender<()>>,
}

/// 从前端快捷键标签字符串解析为 HotkeyConfig 列表
fn parse_hotkey_configs(toggle_label: &str, hold_label: &str) -> Vec<HotkeyConfig> {
    let mut configs = Vec::new();
    if let Some(binding) = HotkeyBinding::parse_from_label(toggle_label) {
        log::info!("[hotkey] parsed toggle binding: {:?} from \"{}\"", binding, toggle_label);
        configs.push(HotkeyConfig {
            mode: HotkeyMode::Toggle,
            binding,
        });
    }
    if let Some(binding) = HotkeyBinding::parse_from_label(hold_label) {
        log::info!("[hotkey] parsed hold binding: {:?} from \"{}\"", binding, hold_label);
        configs.push(HotkeyConfig {
            mode: HotkeyMode::HoldToRecord,
            binding,
        });
    }
    configs
}

/// 从持久化 store 中读取快捷键标签，解析为 HotkeyConfig 列表
fn load_hotkey_configs_from_store(app: &tauri::AppHandle) -> Option<Vec<HotkeyConfig>> {
    let store = app.store("settings.json").ok()?;
    let settings = store.get("app_settings")?;
    let toggle = settings.get("toggleHotkey")?.as_str()?;
    let hold = settings.get("holdHotkey")?.as_str()?;
    let configs = parse_hotkey_configs(toggle, hold);
    if configs.is_empty() {
        None
    } else {
        Some(configs)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("sayble".into()),
                    }),
                ])
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .max_file_size(5_000_000)
                .level(log::LevelFilter::Info)
                .level_for("sayble_lib", log::LevelFilter::Debug)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 重复启动时，聚焦已有窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let handle = app.handle().clone();
            TrayManager::setup(&handle)?;

            // 同步自启动状态：从 store 读取 autoStart，与系统实际状态对比
            {
                let autolaunch = app.autolaunch();
                let want_enabled = app.store("settings.json")
                    .ok()
                    .and_then(|store| store.get("app_settings"))
                    .and_then(|settings| settings.get("autoStart").and_then(|v| v.as_bool()))
                    .unwrap_or(false);
                let currently_enabled = autolaunch.is_enabled().unwrap_or(false);
                if want_enabled && !currently_enabled {
                    if let Err(e) = autolaunch.enable() {
                        log::error!("[autostart] failed to enable on setup: {}", e);
                    } else {
                        log::info!("[autostart] enabled on setup (was disabled)");
                    }
                } else if !want_enabled && currently_enabled {
                    if let Err(e) = autolaunch.disable() {
                        log::error!("[autostart] failed to disable on setup: {}", e);
                    } else {
                        log::info!("[autostart] disabled on setup (was enabled)");
                    }
                }
            }

            // 初始化 HotkeyManager：优先从持久化设置加载，否则用默认配置
            let hotkey_configs = load_hotkey_configs_from_store(&handle)
                .unwrap_or_else(|| {
                    let default_config = AppConfig::default();
                    vec![default_config.toggle_hotkey, default_config.hold_hotkey]
                });
            log::info!("[hotkey] initial configs: {:?}", hotkey_configs);
            let mut manager = HotkeyManager::new(hotkey_configs);
            if let Err(e) = manager.start() {
                log::error!("[hotkey] failed to start manager: {}", e);
            }
            let manager = Arc::new(Mutex::new(manager));
            app.manage(manager.clone());

            // 录音状态标志（在 hotkey 转发线程之前创建，以便线程能引用）
            let recording_flag = Arc::new(Mutex::new(RecordingFlag {
                is_recording: false,
                session_id: 0,
                stop_tx: None,
            }));
            app.manage(recording_flag.clone());

            // 后台线程：轮询 HotkeyManager 事件并 emit 到前端
            // ToggleRecording 在此处读 RecordingFlag 转换为 StartRecording/StopRecording
            let hotkey_handle = handle.clone();
            let hotkey_flag = recording_flag.clone();
            log::info!("[hotkey] manager running: {}", manager.lock().map(|m| m.is_running()).unwrap_or(false));
            std::thread::spawn(move || {
                log::info!("[hotkey-forward] thread started");
                loop {
                    let event = {
                        let mgr = manager.lock().unwrap_or_else(|e| e.into_inner());
                        if !mgr.is_running() {
                            log::warn!("[hotkey-forward] manager not running, exiting thread");
                            break;
                        }
                        mgr.try_recv()
                    };
                    if let Some(event) = event {
                        use hotkey::HotkeyEvent;
                        // Toggle 时读后端真实录音状态，转换为具体指令
                        let event = match event {
                            HotkeyEvent::ToggleRecording => {
                                let is_rec = hotkey_flag.lock()
                                    .map(|f| f.is_recording)
                                    .unwrap_or(false);
                                if is_rec {
                                    HotkeyEvent::StopRecording
                                } else {
                                    HotkeyEvent::StartRecording
                                }
                            }
                            other => other,
                        };
                        log::debug!("[hotkey-forward] emitting to frontend: {:?}", event);
                        let _ = hotkey_handle.emit("hotkey-event", &event);
                    } else {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                }
                log::info!("[hotkey-forward] thread exiting");
            });

            log::info!("[app] Sayble v{} started", env!("CARGO_PKG_VERSION"));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            cmd_list_audio_devices,
            cmd_output_text,
            cmd_save_settings,
            cmd_load_settings,
            cmd_test_asr_connection,
            cmd_start_recording,
            cmd_stop_recording,
            cmd_load_stats,
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
    log::info!("[cmd] output_text called, mode={:?}, text_len={}", mode, text.len());
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
) -> Result<String, String> {
    let config = AsrConfig {
        app_id,
        access_key,
        ..Default::default()
    };
    asr::volcengine::test_connection(&config).await
}

#[tauri::command]
fn cmd_save_settings(
    app: tauri::AppHandle,
    hotkey_mgr: tauri::State<'_, Arc<Mutex<HotkeyManager>>>,
    settings: serde_json::Value,
) -> Result<(), String> {
    let store = app
        .store("settings.json")
        .map_err(|e| format!("Failed to open store: {}", e))?;
    store.set("app_settings", settings.clone());
    store.save().map_err(|e| format!("Failed to save store: {}", e))?;

    // 同步快捷键配置到 HotkeyManager
    let toggle = settings.get("toggleHotkey").and_then(|v| v.as_str()).unwrap_or("");
    let hold = settings.get("holdHotkey").and_then(|v| v.as_str()).unwrap_or("");
    let configs = parse_hotkey_configs(toggle, hold);
    if !configs.is_empty() {
        if let Ok(mgr) = hotkey_mgr.lock() {
            log::info!("[hotkey] updating configs on save: {:?}", configs);
            mgr.update_configs(configs);
        }
    }

    // 同步自启动状态
    let auto_start = settings.get("autoStart").and_then(|v| v.as_bool()).unwrap_or(false);
    let autolaunch = app.autolaunch();
    if auto_start {
        if let Err(e) = autolaunch.enable() {
            log::error!("[autostart] failed to enable: {}", e);
        } else {
            log::info!("[autostart] enabled");
        }
    } else {
        let currently_enabled = autolaunch.is_enabled().unwrap_or(false);
        if currently_enabled {
            if let Err(e) = autolaunch.disable() {
                log::error!("[autostart] failed to disable: {}", e);
            } else {
                log::info!("[autostart] disabled");
            }
        }
    }

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
    device_name: String,
) -> Result<(), String> {
    log::info!("[cmd] start_recording called, device={}", device_name);
    log::debug!("[recording] cmd_start_recording called, device={}", device_name);
    // 如果上一次录音还没结束，先强制停掉旧会话
    {
        let mut f = flag.lock().map_err(|e| e.to_string())?;
        log::debug!("[recording] current flag: is_recording={}, session_id={}", f.is_recording, f.session_id);
        if f.is_recording {
            log::warn!("[recording] force stopping previous session {}", f.session_id);
            if let Some(tx) = f.stop_tx.take() {
                let _ = tx.send(());
            }
            f.is_recording = false;
        }
    }

    let asr_config = AsrConfig {
        app_id,
        access_key,
        ..Default::default()
    };

    VolcEngineAsr::validate_config(&asr_config)?;

    // 分配新 session_id（在 spawn 线程之前，一次锁内完成递增和写入）
    let session_id = {
        let mut f = flag.lock().map_err(|e| e.to_string())?;
        let new_id = f.session_id.wrapping_add(1);
        f.session_id = new_id;
        log::debug!("[recording] allocated session_id={}", new_id);
        new_id
    };

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
    let my_session_id = session_id;
    std::thread::spawn(move || {
        let mut audio_capture = AudioCapture::new();
        let capture_rx = match audio_capture.start(&device_name) {
            Ok(rx) => rx,
            Err(e) => {
                log::error!("[audio] failed to start capture: {}", e);
                let _ = event_tx.send(AsrEvent::Error(format!("麦克风启动失败: {}", e)));
                if let Ok(mut f) = flag_clone.lock() {
                    // 只有 session_id 匹配时才清理，防止覆盖新录音的状态
                    if f.session_id == my_session_id {
                        f.is_recording = false;
                        f.stop_tx = None;
                    }
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
            // 只有 session_id 匹配时才清理，防止覆盖新录音的状态
            if f.session_id == my_session_id {
                f.is_recording = false;
                f.stop_tx = None;
            }
        }
    });

    // 5. 后台 tokio task：轮询 ASR 事件并 emit 到前端
    //    每个事件包装为 { sessionId, event }，Disconnected 内部消化，新增 Finished
    tokio::spawn(async move {
        log::debug!("[asr-forward] session {} forward task started", session_id);
        let mut last_partial_text = String::new();
        let mut had_final = false;
        let mut terminated = false;
        loop {
            match event_rx.try_recv() {
                Ok(event) => {
                    log::debug!("[asr-forward] session {} received: {:?}", session_id, event);
                    match &event {
                        AsrEvent::Connected => {
                            let _ = app.emit("asr-event", serde_json::json!({
                                "sessionId": session_id,
                                "event": serde_json::to_value(&event).unwrap_or_default()
                            }));
                        }
                        AsrEvent::PartialResult(text) => {
                            last_partial_text = text.clone();
                            let _ = app.emit("asr-event", serde_json::json!({
                                "sessionId": session_id,
                                "event": serde_json::to_value(&event).unwrap_or_default()
                            }));
                        }
                        AsrEvent::FinalResult(text, duration_ms) => {
                            had_final = true;
                            // 累加统计到 stats.json
                            log::info!("[asr-forward] FinalResult received, text_len={}, duration_ms={:?}", text.len(), duration_ms);
                            match app.store("stats.json") {
                                Ok(store) => {
                                    let prev_dur: i64 = store.get("total_duration_ms")
                                        .and_then(|v| v.as_i64()).unwrap_or(0);
                                    let prev_chars: i64 = store.get("total_chars")
                                        .and_then(|v| v.as_i64()).unwrap_or(0);
                                    let count: i64 = store.get("total_count")
                                        .and_then(|v| v.as_i64()).unwrap_or(0);
                                    store.set("total_duration_ms", serde_json::json!(prev_dur + duration_ms.unwrap_or(0)));
                                    store.set("total_chars", serde_json::json!(prev_chars + text.chars().count() as i64));
                                    store.set("total_count", serde_json::json!(count + 1));
                                    log::info!("[asr-forward] stats updated: dur={}, chars={}, count={}", prev_dur + duration_ms.unwrap_or(0), prev_chars + text.chars().count() as i64, count + 1);
                                    if let Err(e) = store.save() {
                                        log::error!("[asr-forward] stats save failed: {}", e);
                                    }
                                }
                                Err(e) => {
                                    log::error!("[asr-forward] failed to open stats store: {}", e);
                                }
                            }
                            // emit 给前端（保持原格式）
                            let _ = app.emit("asr-event", serde_json::json!({
                                "sessionId": session_id,
                                "event": {"FinalResult": text}
                            }));
                            // FinalResult 后等 1 秒再发 Finished，让前端展示"完成"状态
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            let _ = app.emit("asr-event", serde_json::json!({
                                "sessionId": session_id,
                                "event": "Finished"
                            }));
                            terminated = true;
                            break;
                        }
                        AsrEvent::Error(_) => {
                            let _ = app.emit("asr-event", serde_json::json!({
                                "sessionId": session_id,
                                "event": serde_json::to_value(&event).unwrap_or_default()
                            }));
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                            let _ = app.emit("asr-event", serde_json::json!({
                                "sessionId": session_id,
                                "event": "Finished"
                            }));
                            terminated = true;
                            break;
                        }
                        AsrEvent::Disconnected => {
                            // 内部消化：不暴露给前端
                            if !had_final {
                                // 没有 FinalResult，用最后的 PartialResult 作为 fallback
                                if !last_partial_text.is_empty() {
                                    // 累加统计（fallback 场景，时长为 0）
                                    if let Ok(store) = app.store("stats.json") {
                                        let prev_chars: i64 = store.get("total_chars")
                                            .and_then(|v| v.as_i64()).unwrap_or(0);
                                        let count: i64 = store.get("total_count")
                                            .and_then(|v| v.as_i64()).unwrap_or(0);
                                        store.set("total_chars", serde_json::json!(prev_chars + last_partial_text.chars().count() as i64));
                                        store.set("total_count", serde_json::json!(count + 1));
                                        let _ = store.save();
                                    }
                                    let _ = app.emit("asr-event", serde_json::json!({
                                        "sessionId": session_id,
                                        "event": {"FinalResult": last_partial_text}
                                    }));
                                }
                            }
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            let _ = app.emit("asr-event", serde_json::json!({
                                "sessionId": session_id,
                                "event": "Finished"
                            }));
                            terminated = true;
                            break;
                        }
                    }
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    log::debug!("[asr-forward] session {} channel disconnected", session_id);
                    break;
                }
            }
        }
        // channel 断开且没收到过终止事件时，补发 Finished 确保前端不会卡住
        if !terminated {
            log::warn!("[asr-forward] session {} channel ended without terminal event, sending Finished", session_id);
            let _ = app.emit("asr-event", serde_json::json!({
                "sessionId": session_id,
                "event": "Finished"
            }));
        }
    });

    // 6. 更新状态标志
    {
        let mut f = flag.lock().map_err(|e| e.to_string())?;
        f.is_recording = true;
        f.stop_tx = Some(stop_tx);
        log::debug!("[recording] session {} flag set: is_recording=true", session_id);
    }

    Ok(())
}

#[tauri::command]
fn cmd_stop_recording(
    flag: tauri::State<'_, Arc<Mutex<RecordingFlag>>>,
) -> Result<(), String> {
    let mut f = flag.lock().map_err(|e| e.to_string())?;
    log::info!("[cmd] stop_recording called, is_recording={}, session_id={}", f.is_recording, f.session_id);
    if !f.is_recording {
        return Err("当前没有在录音".to_string());
    }
    // 发送停止信号，桥接线程会收到后停止采集
    if let Some(tx) = f.stop_tx.take() {
        let _ = tx.send(());
    }
    f.is_recording = false;
    log::debug!("[recording] session {} stopped, is_recording=false", f.session_id);
    Ok(())
}

#[tauri::command]
fn cmd_load_stats(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let store = app.store("stats.json")
        .map_err(|e| format!("Failed to open stats store: {}", e))?;
    Ok(serde_json::json!({
        "totalDurationMs": store.get("total_duration_ms").and_then(|v| v.as_i64()).unwrap_or(0),
        "totalChars": store.get("total_chars").and_then(|v| v.as_i64()).unwrap_or(0),
        "totalCount": store.get("total_count").and_then(|v| v.as_i64()).unwrap_or(0),
    }))
}
