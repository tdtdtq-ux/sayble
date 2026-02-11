pub mod asr;
pub mod audio;
pub mod config;
pub mod hotkey;
pub mod input;
pub mod polish;
pub mod store;
pub mod tray;

use asr::AsrEvent;
use asr::volcengine::VolcEngineAsr;
use audio::AudioCapture;
use config::{AppConfig, AsrConfig, HotkeyBinding, HotkeyConfig, OutputMode};
use hotkey::HotkeyManager;
use input::{ClipboardOutput, SimulateOutput};
use store::AppStore;
use tray::TrayManager;

use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

/// 检查自启动注册表项是否被第三方软件（如 QQ、360 等）禁用
/// 返回禁用该项的子键名称（如 "QQDisabled"），未被禁用则返回 None
#[cfg(target_os = "windows")]
fn check_autostart_hijacked() -> Option<String> {
    use windows::Win32::System::Registry::*;
    use windows::core::*;

    // 常见的第三方软件禁用自启动时使用的子键名
    let disabled_subkeys = [
        "QQDisabled",
        "360Disabled",
        "KingsoftDisabled",
        "TencentDisabled",
    ];

    let run_path = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");

    for subkey_name in &disabled_subkeys {
        let subkey_path = format!(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run\\{}",
            subkey_name
        );
        let wide: Vec<u16> = subkey_path.encode_utf16().chain(std::iter::once(0)).collect();
        let subkey_pcwstr = PCWSTR(wide.as_ptr());

        let mut hkey = HKEY::default();
        let result = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                subkey_pcwstr,
                0,
                KEY_READ,
                &mut hkey,
            )
        };

        if result.is_ok() {
            // 子键存在，检查是否有 Sayble 值
            let value_name = w!("Sayble");
            let query_result = unsafe {
                RegQueryValueExW(
                    hkey,
                    value_name,
                    None,
                    None,
                    None,
                    None,
                )
            };
            unsafe { let _ = RegCloseKey(hkey); }

            if query_result.is_ok() {
                log::warn!(
                    "[autostart] Sayble found in Run\\{} — autostart was hijacked by third-party software",
                    subkey_name
                );
                return Some(subkey_name.to_string());
            }
        }
    }

    // 兜底：检查 Run 下所有子键是否包含 Sayble（应对未知软件）
    let mut run_hkey = HKEY::default();
    let open_result = unsafe {
        RegOpenKeyExW(HKEY_CURRENT_USER, run_path, 0, KEY_READ, &mut run_hkey)
    };
    if open_result.is_ok() {
        let mut index = 0u32;
        loop {
            let mut name_buf = [0u16; 256];
            let mut name_len = name_buf.len() as u32;
            let enum_result = unsafe {
                RegEnumKeyExW(
                    run_hkey,
                    index,
                    PWSTR(name_buf.as_mut_ptr()),
                    &mut name_len,
                    None,
                    PWSTR::null(),
                    None,
                    None,
                )
            };
            if enum_result.is_err() {
                break;
            }
            let child_name = String::from_utf16_lossy(&name_buf[..name_len as usize]);

            // 已经在上面检查过的跳过
            if disabled_subkeys.contains(&child_name.as_str()) {
                index += 1;
                continue;
            }

            let child_path = format!(
                "Software\\Microsoft\\Windows\\CurrentVersion\\Run\\{}",
                child_name
            );
            let wide2: Vec<u16> = child_path.encode_utf16().chain(std::iter::once(0)).collect();
            let child_pcwstr = PCWSTR(wide2.as_ptr());
            let mut child_hkey = HKEY::default();
            let child_open = unsafe {
                RegOpenKeyExW(HKEY_CURRENT_USER, child_pcwstr, 0, KEY_READ, &mut child_hkey)
            };
            if child_open.is_ok() {
                let value_name = w!("Sayble");
                let q = unsafe {
                    RegQueryValueExW(child_hkey, value_name, None, None, None, None)
                };
                unsafe { let _ = RegCloseKey(child_hkey); }
                if q.is_ok() {
                    log::warn!(
                        "[autostart] Sayble found in Run\\{} — autostart was hijacked by unknown software",
                        child_name
                    );
                    unsafe { let _ = RegCloseKey(run_hkey); }
                    return Some(child_name);
                }
            }
            index += 1;
        }
        unsafe { let _ = RegCloseKey(run_hkey); }
    }

    None
}

/// 读取 Windows MachineGuid 作为设备唯一标识
#[cfg(target_os = "windows")]
fn get_machine_guid() -> Option<String> {
    use windows::Win32::System::Registry::*;
    use windows::core::*;

    let path: Vec<u16> = "SOFTWARE\\Microsoft\\Cryptography"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut hkey = HKEY::default();
    let result = unsafe {
        RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(path.as_ptr()),
            0,
            KEY_READ,
            &mut hkey,
        )
    };
    if result.is_err() {
        log::warn!("[app] failed to open Cryptography registry key");
        return None;
    }

    let value_name = w!("MachineGuid");
    let mut buf_size: u32 = 0;
    let query = unsafe {
        RegQueryValueExW(hkey, value_name, None, None, None, Some(&mut buf_size))
    };
    if query.is_err() || buf_size == 0 {
        unsafe { let _ = RegCloseKey(hkey); }
        log::warn!("[app] MachineGuid value not found or empty");
        return None;
    }

    let mut buf = vec![0u8; buf_size as usize];
    let query2 = unsafe {
        RegQueryValueExW(
            hkey,
            value_name,
            None,
            None,
            Some(buf.as_mut_ptr()),
            Some(&mut buf_size),
        )
    };
    unsafe { let _ = RegCloseKey(hkey); }

    if query2.is_err() {
        log::warn!("[app] failed to read MachineGuid value");
        return None;
    }

    // REG_SZ: UTF-16LE with null terminator
    let wide: Vec<u16> = buf
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let s = String::from_utf16_lossy(&wide);
    let s = s.trim_end_matches('\0').to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// 录音状态标志，用于 start/stop 之间通信
/// session_id 用于防止旧线程清理时覆盖新录音的状态
struct RecordingFlag {
    is_recording: bool,
    session_id: u64,
    /// drop 此 sender 会使桥接线程中的 audio_tx 也被 drop，从而触发 ASR 结束
    stop_tx: Option<std::sync::mpsc::Sender<()>>,
    /// 当前 session 的取消标志，ESC 取消时设为 true，ASR 转发 task 据此跳过输出
    cancelled: Arc<AtomicBool>,
}

/// 录音配置枚举，区分不同 ASR 引擎
enum RecordingConfig {
    Volcengine { asr_config: AsrConfig, device_name: String },
    #[cfg(target_os = "windows")]
    Sapi,
}

/// 从前端快捷键标签字符串解析为 HotkeyConfig 列表
fn parse_hotkey_configs(toggle_label: &str) -> Vec<HotkeyConfig> {
    let mut configs = Vec::new();
    if let Some(binding) = HotkeyBinding::parse_from_label(toggle_label) {
        log::info!("[hotkey] parsed toggle binding: {:?} from \"{}\"", binding, toggle_label);
        configs.push(HotkeyConfig {
            binding,
        });
    }
    configs
}

/// 从持久化 store 中读取输出配置，直接执行文字输出
fn output_text_from_store(app: &tauri::AppHandle, text: &str) {
    let store = app.state::<AppStore>();
    let settings = store.settings().get("app_settings");

    let auto_output = settings.as_ref()
        .and_then(|s| s.get("autoOutput"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    if !auto_output {
        log::info!("[output] autoOutput is off, skipping");
        return;
    }

    let output_mode_str = settings.as_ref()
        .and_then(|s| s.get("outputMode"))
        .and_then(|v| v.as_str())
        .unwrap_or("Clipboard");

    let mode = match output_mode_str {
        "SimulateKeyboard" => OutputMode::SimulateKeyboard,
        _ => OutputMode::Clipboard,
    };

    log::info!("[output] output_text_from_store, mode={:?}, text_len={}", mode, text.len());
    let result = match mode {
        OutputMode::Clipboard => ClipboardOutput::paste(text),
        OutputMode::SimulateKeyboard => SimulateOutput::type_text(text).map(|_| ()),
    };
    if let Err(e) = result {
        log::error!("[output] output_text_from_store failed: {}", e);
    }
}

/// 从持久化 store 中读取录音相关设置
fn load_recording_settings_from_store(app: &tauri::AppHandle) -> Result<RecordingConfig, String> {
    let store = app.state::<AppStore>();

    // 从 asr_settings 读取 ASR 配置
    let asr_settings = store.settings().get("asr_settings")
        .ok_or("No asr_settings found in store")?;

    let selected_provider = asr_settings.get("selectedProvider")
        .and_then(|v| v.as_str())
        .unwrap_or("volcengine");

    // SAPI 引擎无需额外配置
    #[cfg(target_os = "windows")]
    if selected_provider == "sapi" {
        return Ok(RecordingConfig::Sapi);
    }

    // 从 app_settings 读取麦克风设备
    let app_settings = store.settings().get("app_settings");
    let device_name = app_settings.as_ref()
        .and_then(|s| s.get("microphoneDevice"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let providers = asr_settings.get("providers")
        .and_then(|v| v.as_object());

    let credentials = providers
        .and_then(|p| p.get(selected_provider))
        .and_then(|v| v.as_object())
        .ok_or("未找到所选 ASR 服务商的配置")?;

    let language = credentials.get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("zh")
        .to_string();

    let auto_punctuation = credentials.get("autoPunctuation")
        .and_then(|v| v.as_str())
        .map(|v| v == "true")
        .unwrap_or(true);

    let app_id = credentials.get("appId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let access_key = credentials.get("accessKey").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if app_id.is_empty() || access_key.is_empty() {
        return Err("API 配置不完整，请先在设置中填写认证信息".to_string());
    }

    let asr_config = AsrConfig {
        app_id,
        access_key,
        language,
        auto_punctuation,
    };

    Ok(RecordingConfig::Volcengine { asr_config, device_name })
}

/// 从持久化 store 中读取快捷键标签，解析为 HotkeyConfig 列表
fn load_hotkey_configs_from_store(app: &tauri::AppHandle) -> Option<Vec<HotkeyConfig>> {
    let store = app.state::<AppStore>();
    let settings = store.settings().get("app_settings")?;
    let toggle = settings.get("toggleHotkey")?.as_str()?;
    let configs = parse_hotkey_configs(toggle);
    if configs.is_empty() {
        None
    } else {
        Some(configs)
    }
}

/// 润色+输出+延迟的统一流程，供 FinalResult 和 Disconnected fallback 共用
/// 返回值：是否润色失败（决定 Finished 前的延迟时长）
async fn polish_and_output(app: &tauri::AppHandle, session_id: u64, text: &str) -> bool {
    let (final_text, polished_text, polish_failed) = match get_polish_config(app) {
        Some(config) => {
            // 润色开启：跳过 FinalResult，直接 emit Polishing 携带原文
            let _ = app.emit("asr-event", serde_json::json!({
                "sessionId": session_id,
                "event": {"Polishing": text}
            }));
            match polish::polish_text(&config, text).await {
                Ok(polished) => {
                    let _ = app.emit("asr-event", serde_json::json!({
                        "sessionId": session_id,
                        "event": {"PolishResult": &polished}
                    }));
                    (polished.clone(), Some(polished), false)
                }
                Err(e) => {
                    log::error!("[asr-forward] polish failed: {}", e);
                    let _ = app.emit("asr-event", serde_json::json!({
                        "sessionId": session_id,
                        "event": "PolishError"
                    }));
                    (text.to_string(), None, true)
                }
            }
        }
        None => {
            // 润色关闭：正常 emit FinalResult
            let _ = app.emit("asr-event", serde_json::json!({
                "sessionId": session_id,
                "event": {"FinalResult": text}
            }));
            (text.to_string(), None, false)
        }
    };
    output_text_from_store(app, &final_text);

    // 写入历史记录
    let store = app.state::<AppStore>();
    let timestamp = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    store.append_history(serde_json::json!({
        "timestamp": timestamp,
        "asrText": text,
        "polishedText": polished_text,
        "outputText": final_text,
    }));

    let delay = if polish_failed { 3 } else { 1 };
    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
    polish_failed
}

/// 从持久化 store 中读取润色配置，匹配 provider 和 prompt
fn get_polish_config(app: &tauri::AppHandle) -> Option<polish::PolishConfig> {
    let store = app.state::<AppStore>();
    let settings = store.settings().get("polish_settings")?;

    let enabled = settings.get("enabled")?.as_bool()?;
    if !enabled {
        return None;
    }

    let selected_provider_id = settings.get("selectedProviderId")?.as_str()?;
    let selected_prompt_id = settings.get("selectedPromptId")?.as_str()?;

    if selected_provider_id.is_empty() || selected_prompt_id.is_empty() {
        log::warn!("[polish] enabled but provider or prompt not selected");
        return None;
    }

    let providers = settings.get("providers")?.as_array()?;
    let provider = providers.iter().find(|p| {
        p.get("id").and_then(|v| v.as_str()) == Some(selected_provider_id)
    })?;

    let prompts = settings.get("prompts")?.as_array()?;
    let prompt = prompts.iter().find(|p| {
        p.get("id").and_then(|v| v.as_str()) == Some(selected_prompt_id)
    })?;

    let base_url = provider.get("baseUrl")?.as_str()?.to_string();
    let api_key = provider.get("apiKey")?.as_str()?.to_string();
    let model = provider.get("model")?.as_str()?.to_string();
    let temperature = provider.get("temperature").and_then(|v| v.as_f64()).unwrap_or(0.7);
    let prompt_content = prompt.get("content")?.as_str()?.to_string();

    if base_url.is_empty() || api_key.is_empty() || model.is_empty() {
        log::warn!("[polish] provider config incomplete");
        return None;
    }

    log::info!("[polish] config loaded: model={}, temperature={}, prompt_id={}", model, temperature, selected_prompt_id);
    Some(polish::PolishConfig {
        base_url,
        api_key,
        model,
        prompt: prompt_content,
        temperature,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: store::base_dir().join("logs"),
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
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let handle = app.handle().clone();
            TrayManager::setup(&handle)?;

            // 初始化 AppStore 并注册为 managed state
            let app_store = AppStore::init();
            app.manage(app_store);

            // 确保 deviceId 存在：首次启动时从 MachineGuid 生成
            {
                let store = app.state::<AppStore>();
                let has_device_id = store.settings().get("app_settings")
                    .and_then(|s| s.get("deviceId").cloned())
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);

                if !has_device_id {
                    #[cfg(target_os = "windows")]
                    let guid = get_machine_guid();
                    #[cfg(not(target_os = "windows"))]
                    let guid: Option<String> = None;

                    if let Some(id) = guid {
                        let mut app_settings = store.settings().get("app_settings")
                            .and_then(|v| v.as_object().cloned())
                            .unwrap_or_default();
                        app_settings.insert("deviceId".to_string(), serde_json::Value::String(id.clone()));
                        store.settings().set("app_settings", serde_json::Value::Object(app_settings));
                        let _ = store.settings().save();
                        log::info!("[app] device id: {}...", &id[..id.len().min(8)]);
                    } else {
                        log::warn!("[app] failed to obtain device id");
                    }
                } else {
                    let id = store.settings().get("app_settings")
                        .and_then(|s| s.get("deviceId").cloned())
                        .and_then(|v| v.as_str().map(|s| s.to_string()))
                        .unwrap_or_default();
                    log::info!("[app] device id: {}...", &id[..id.len().min(8)]);
                }
            }

            // 同步自启动状态：用户未开启但系统中启用了，则关闭
            // 用户开启但被第三方禁用的情况，由前端主动调用 cmd_check_autostart 检测并提示
            {
                let autolaunch = app.autolaunch();
                let want_enabled = app.state::<AppStore>()
                    .settings().get("app_settings")
                    .and_then(|settings| settings.get("autoStart").and_then(|v| v.as_bool()))
                    .unwrap_or(false);
                let currently_enabled = autolaunch.is_enabled().unwrap_or(false);
                if !want_enabled && currently_enabled {
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
                    vec![default_config.toggle_hotkey]
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
                cancelled: Arc::new(AtomicBool::new(false)),
            }));
            app.manage(recording_flag.clone());

            // 后台线程：轮询 HotkeyManager 事件，直接控制录音启停
            // 不再 emit hotkey-event 给前端，彻底绕过 WebView
            let hotkey_handle = handle.clone();
            let hotkey_flag = recording_flag.clone();
            log::info!("[hotkey] manager running: {}", manager.lock().map(|m| m.is_running()).unwrap_or(false));
            std::thread::spawn(move || {
                log::info!("[hotkey-forward] thread started (backend-driven mode)");
                let mut recording_start_time: Option<std::time::Instant> = None;
                const MIN_RECORDING_MS: u128 = 800;

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

                        match event {
                            HotkeyEvent::StartRecording => {
                                log::info!("[hotkey-forward] StartRecording: reading settings from store");
                                match load_recording_settings_from_store(&hotkey_handle) {
                                    Ok(recording_config) => {
                                        // 先通知浮窗开始（让浮窗立即显示）
                                        let _ = hotkey_handle.emit("floating-control", serde_json::json!({
                                            "action": "start",
                                        }));

                                        // 直接调用录音启动
                                        match start_recording_inner(&hotkey_handle, &hotkey_flag, recording_config) {
                                            Ok(session_id) => {
                                                recording_start_time = Some(std::time::Instant::now());
                                                log::info!("[hotkey-forward] recording started, session_id={}", session_id);
                                            }
                                            Err(e) => {
                                                log::error!("[hotkey-forward] start_recording failed: {}", e);
                                                let _ = hotkey_handle.emit("floating-control", serde_json::json!({
                                                    "action": "cancel",
                                                }));
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        log::warn!("[hotkey-forward] cannot start recording: {}", e);
                                    }
                                }
                            }

                            HotkeyEvent::StopRecording => {
                                // 最短录音保护
                                if let Some(start) = recording_start_time.take() {
                                    let elapsed = start.elapsed().as_millis();
                                    if elapsed < MIN_RECORDING_MS {
                                        let remaining = MIN_RECORDING_MS - elapsed;
                                        log::debug!("[hotkey-forward] min recording guard: sleeping {}ms", remaining);
                                        std::thread::sleep(std::time::Duration::from_millis(remaining as u64));
                                    }
                                }

                                match stop_recording_inner(&hotkey_flag) {
                                    Ok(()) => {
                                        let _ = hotkey_handle.emit("floating-control", serde_json::json!({
                                            "action": "stop",
                                        }));
                                        log::info!("[hotkey-forward] recording stopped");
                                    }
                                    Err(e) => {
                                        log::warn!("[hotkey-forward] stop_recording failed: {}", e);
                                    }
                                }
                            }

                            HotkeyEvent::CancelRecording => {
                                recording_start_time = None;
                                // 先设置 cancelled 标志，让 ASR 转发 task 跳过输出
                                if let Ok(f) = hotkey_flag.lock() {
                                    f.cancelled.store(true, Ordering::SeqCst);
                                }
                                let _ = stop_recording_inner(&hotkey_flag);
                                let _ = hotkey_handle.emit("floating-control", serde_json::json!({
                                    "action": "cancel",
                                }));
                                log::info!("[hotkey-forward] recording cancelled");
                            }

                            HotkeyEvent::ToggleRecording => {
                                unreachable!("ToggleRecording should have been converted above");
                            }
                        }
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
            cmd_save_settings,
            cmd_load_settings,
            cmd_test_asr_connection,
            cmd_test_polish_provider,
            cmd_start_recording,
            cmd_stop_recording,
            cmd_load_stats,
            cmd_restore_autostart,
            cmd_check_autostart,
            cmd_get_data_dir,
            cmd_load_history,
            cmd_clear_history,
            cmd_remove_history,
            cmd_check_update,
            cmd_inject_key_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn cmd_restore_autostart(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("[cmd] restore_autostart called");
    let autolaunch = app.autolaunch();
    autolaunch.enable().map_err(|e| {
        log::error!("[autostart] failed to restore: {}", e);
        format!("恢复自启动失败: {}", e)
    })?;
    log::info!("[autostart] restored by user request");
    Ok(())
}

/// 手动检测自启动状态，返回 Ok(None) 表示正常，Ok(Some(source)) 表示被禁用
#[tauri::command]
fn cmd_check_autostart(app: tauri::AppHandle) -> Result<Option<String>, String> {
    log::info!("[cmd] check_autostart called");
    let autolaunch = app.autolaunch();
    let want_enabled = app.state::<AppStore>()
        .settings().get("app_settings")
        .and_then(|settings| settings.get("autoStart").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    let currently_enabled = autolaunch.is_enabled().unwrap_or(false);
    log::info!("[autostart] check: want_enabled={}, currently_enabled={}", want_enabled, currently_enabled);

    if want_enabled && !currently_enabled {
        #[cfg(target_os = "windows")]
        {
            let source = check_autostart_hijacked()
                .unwrap_or_else(|| "未知来源".to_string());
            log::warn!("[autostart] check: disabled by {}", source);
            Ok(Some(source))
        }
        #[cfg(not(target_os = "windows"))]
        {
            log::warn!("[autostart] check: disabled externally");
            Ok(Some("未知来源".to_string()))
        }
    } else if !want_enabled {
        log::info!("[autostart] check: user has not enabled autostart");
        Ok(None)
    } else {
        log::info!("[autostart] check: autostart is normal");
        Ok(None)
    }
}

#[tauri::command]
fn cmd_list_audio_devices() -> Result<Vec<audio::AudioDevice>, String> {
    audio::AudioCapture::list_devices()
}

#[tauri::command]
async fn cmd_test_asr_connection(
    provider_type: String,
    credentials: serde_json::Value,
) -> Result<String, String> {
    match provider_type.as_str() {
        #[cfg(target_os = "windows")]
        "sapi" => {
            tokio::task::spawn_blocking(|| {
                asr::sapi::test_sapi_available()
            })
            .await
            .map_err(|e| format!("任务执行失败: {}", e))?
        }
        "volcengine" => {
            let app_id = credentials.get("appId").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let access_key = credentials.get("accessKey").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if app_id.is_empty() || access_key.is_empty() {
                return Err("请填写完整的认证信息".to_string());
            }
            let config = AsrConfig {
                app_id,
                access_key,
                ..Default::default()
            };
            asr::volcengine::test_connection(&config).await
        }
        _ => Err(format!("不支持的 ASR 服务商: {}", provider_type)),
    }
}

#[tauri::command]
async fn cmd_test_polish_provider(
    base_url: String,
    api_key: String,
) -> Result<String, String> {
    log::info!("[cmd] test_polish_provider called, base_url={}", base_url);
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    log::info!("[cmd] test_polish_provider GET {}", url);
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| {
            log::error!("[cmd] test_polish_provider request error: {}", e);
            format!("请求失败: {}", e)
        })?;
    let status = resp.status();
    if status.is_success() {
        log::info!("[cmd] test_polish_provider success, status={}", status);
        Ok("连接成功".to_string())
    } else {
        let body = resp.text().await.unwrap_or_default();
        log::warn!("[cmd] test_polish_provider failed, status={}, body={}", status, body);
        Err(format!("连接失败，状态码: {}", status))
    }
}

#[tauri::command]
fn cmd_save_settings(
    app: tauri::AppHandle,
    hotkey_mgr: tauri::State<'_, Arc<Mutex<HotkeyManager>>>,
    settings: serde_json::Value,
) -> Result<(), String> {
    let store = app.state::<AppStore>();
    let settings_store = store.settings();

    // 按 key 写入 store
    if let Some(obj) = settings.as_object() {
        for (k, v) in obj {
            settings_store.set(k, v.clone());
        }
    }
    settings_store.save().map_err(|e| format!("Failed to save store: {}", e))?;

    // 从 app_settings 提取副作用字段
    let app_settings = settings.get("app_settings").unwrap_or(&serde_json::Value::Null);

    // 同步快捷键配置到 HotkeyManager
    let toggle = app_settings.get("toggleHotkey").and_then(|v| v.as_str()).unwrap_or("");
    let configs = parse_hotkey_configs(toggle);
    if !configs.is_empty() {
        if let Ok(mgr) = hotkey_mgr.lock() {
            log::info!("[hotkey] updating configs on save: {:?}", configs);
            mgr.update_configs(configs);
        }
    }

    // 同步自启动状态
    let auto_start = app_settings.get("autoStart").and_then(|v| v.as_bool()).unwrap_or(false);
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
fn cmd_load_settings(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let store = app.state::<AppStore>();
    let mut map = serde_json::Map::new();
    for (k, v) in store.settings().entries() {
        map.insert(k, v);
    }

    // 确保内建零配置引擎（如 sapi）在 providers 中有条目
    if let Some(asr) = map.get_mut("asr_settings").and_then(|v| v.as_object_mut()) {
        if let Some(providers) = asr.get_mut("providers").and_then(|v| v.as_object_mut()) {
            providers.entry("sapi").or_insert_with(|| serde_json::json!({}));
        }
    }

    Ok(serde_json::Value::Object(map))
}

/// 内部录音启动逻辑，可从任意线程调用（非 async）
fn start_recording_inner(
    app: &tauri::AppHandle,
    flag: &Arc<Mutex<RecordingFlag>>,
    config: RecordingConfig,
) -> Result<u64, String> {
    log::info!("[recording] start_recording_inner called");
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

    // 分配新 session_id，并重置 cancelled 标志
    let (session_id, cancelled) = {
        let mut f = flag.lock().map_err(|e| e.to_string())?;
        let new_id = f.session_id.wrapping_add(1);
        f.session_id = new_id;
        f.cancelled = Arc::new(AtomicBool::new(false));
        log::debug!("[recording] allocated session_id={}", new_id);
        (new_id, Arc::clone(&f.cancelled))
    };

    // 构建事件 channel（所有引擎共用）
    let (event_tx, event_rx) = std::sync::mpsc::channel::<AsrEvent>();

    // 用一个 stop channel 来控制停止
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();

    // 判断是否为流式多句引擎（如 SAPI），影响 asr-forward 的 FinalResult 处理
    #[cfg(target_os = "windows")]
    let is_streaming_engine = matches!(&config, RecordingConfig::Sapi);
    #[cfg(not(target_os = "windows"))]
    let is_streaming_engine = false;

    match config {
        RecordingConfig::Volcengine { asr_config, device_name } => {
            log::info!("[recording] using Volcengine engine, device={}", device_name);
            VolcEngineAsr::validate_config(&asr_config)?;

            let (audio_tx, audio_rx) = tokio::sync::mpsc::channel::<Vec<i16>>(100);
            let is_running = Arc::new(Mutex::new(true));

            // 在 Tauri 的 tokio runtime 里 spawn ASR 会话
            let event_tx_clone = event_tx.clone();
            let is_running_clone = is_running.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) =
                    asr::volcengine::run_asr_session(asr_config, event_tx_clone.clone(), audio_rx, is_running_clone).await
                {
                    let _ = event_tx_clone.send(AsrEvent::Error(e));
                }
            });

            // 在独立线程中启动音频采集并桥接到 ASR
            let flag_clone = Arc::clone(flag);
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
                    if f.session_id == my_session_id {
                        f.is_recording = false;
                        f.stop_tx = None;
                    }
                }
            });
        }

        #[cfg(target_os = "windows")]
        RecordingConfig::Sapi => {
            log::info!("[recording] using SAPI engine");
            let flag_clone = Arc::clone(flag);
            let is_running = Arc::new(Mutex::new(true));
            let is_running_clone = is_running.clone();
            let my_session_id = session_id;

            // SAPI 在独立 OS 线程运行（COM STA 要求），不使用 cpal 采集
            std::thread::spawn(move || {
                // 等待 stop 信号的监控线程
                let is_running_stop = is_running.clone();
                std::thread::spawn(move || {
                    let _ = stop_rx.recv(); // 阻塞直到收到停止信号
                    if let Ok(mut running) = is_running_stop.lock() {
                        *running = false;
                    }
                });

                asr::sapi::run_sapi_session(event_tx, is_running_clone);

                if let Ok(mut f) = flag_clone.lock() {
                    if f.session_id == my_session_id {
                        f.is_recording = false;
                        f.stop_tx = None;
                    }
                }
            });
        }
    }

    // 后台 tokio task：轮询 ASR 事件并 emit 到前端
    //    每个事件包装为 { sessionId, event }，Disconnected 内部消化，新增 Finished
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        log::debug!("[asr-forward] session {} forward task started (streaming={})", session_id, is_streaming_engine);
        let mut last_partial_text = String::new();
        let mut had_final = false;
        let mut terminated = false;
        // 流式引擎（SAPI）累积已确认的句子文本，等 Disconnected 时统一输出
        let mut accumulated_text = String::new();
        loop {
            match event_rx.try_recv() {
                Ok(event) => {
                    log::debug!("[asr-forward] session {} received: {:?}", session_id, event);
                    match &event {
                        AsrEvent::Connected => {
                            let _ = app_clone.emit("asr-event", serde_json::json!({
                                "sessionId": session_id,
                                "event": serde_json::to_value(&event).unwrap_or_default()
                            }));
                        }
                        AsrEvent::PartialResult(text) => {
                            if is_streaming_engine {
                                // 流式引擎：浮窗显示 已累积文本 + 当前 partial
                                let display = if accumulated_text.is_empty() {
                                    text.clone()
                                } else {
                                    format!("{}{}", accumulated_text, text)
                                };
                                last_partial_text = display.clone();
                                let _ = app_clone.emit("asr-event", serde_json::json!({
                                    "sessionId": session_id,
                                    "event": {"PartialResult": display}
                                }));
                            } else {
                                last_partial_text = text.clone();
                                let _ = app_clone.emit("asr-event", serde_json::json!({
                                    "sessionId": session_id,
                                    "event": serde_json::to_value(&event).unwrap_or_default()
                                }));
                            }
                        }
                        #[allow(unused_assignments)]
                        AsrEvent::FinalResult(text, duration_ms) => {
                            had_final = true;
                            log::info!("[asr-forward] FinalResult received, text_len={}, duration_ms={:?}, streaming={}", text.len(), duration_ms, is_streaming_engine);

                            if is_streaming_engine {
                                // 流式引擎：累积文本，不 break，等 Disconnected
                                accumulated_text.push_str(text);
                                // 更新浮窗显示累积文本
                                let _ = app_clone.emit("asr-event", serde_json::json!({
                                    "sessionId": session_id,
                                    "event": {"PartialResult": &accumulated_text}
                                }));
                            } else {
                                // 单次引擎（火山引擎）：直接输出并结束
                                if cancelled.load(Ordering::SeqCst) {
                                    log::info!("[asr-forward] session {} cancelled, skipping output", session_id);
                                } else {
                                    app_clone.state::<AppStore>().accumulate_stats(text.chars().count(), *duration_ms);
                                    polish_and_output(&app_clone, session_id, text).await;
                                }
                                let _ = app_clone.emit("asr-event", serde_json::json!({
                                    "sessionId": session_id,
                                    "event": "Finished"
                                }));
                                terminated = true;
                                break;
                            }
                        }
                        AsrEvent::Error(_) => {
                            let _ = app_clone.emit("asr-event", serde_json::json!({
                                "sessionId": session_id,
                                "event": serde_json::to_value(&event).unwrap_or_default()
                            }));
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                            let _ = app_clone.emit("asr-event", serde_json::json!({
                                "sessionId": session_id,
                                "event": "Finished"
                            }));
                            terminated = true;
                            break;
                        }
                        AsrEvent::Disconnected => {
                            // 内部消化：不暴露给前端
                            if cancelled.load(Ordering::SeqCst) {
                                log::info!("[asr-forward] session {} cancelled, skipping output on disconnect", session_id);
                            } else if is_streaming_engine && !accumulated_text.is_empty() {
                                // 流式引擎：Disconnected 时统一输出累积文本
                                log::info!("[asr-forward] session {} streaming disconnect, outputting accumulated text len={}", session_id, accumulated_text.len());
                                app_clone.state::<AppStore>().accumulate_stats(accumulated_text.chars().count(), None);
                                polish_and_output(&app_clone, session_id, &accumulated_text).await;
                            } else if !had_final {
                                if !last_partial_text.is_empty() {
                                    app_clone.state::<AppStore>().accumulate_stats(last_partial_text.chars().count(), None);
                                    polish_and_output(&app_clone, session_id, &last_partial_text).await;
                                }
                            } else {
                                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            }
                            let _ = app_clone.emit("asr-event", serde_json::json!({
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
            // 流式引擎 channel 断开时也要输出累积文本
            if is_streaming_engine && !accumulated_text.is_empty() && !cancelled.load(Ordering::SeqCst) {
                log::info!("[asr-forward] session {} channel ended, outputting accumulated text len={}", session_id, accumulated_text.len());
                app_clone.state::<AppStore>().accumulate_stats(accumulated_text.chars().count(), None);
                polish_and_output(&app_clone, session_id, &accumulated_text).await;
            }
            log::warn!("[asr-forward] session {} channel ended without terminal event, sending Finished", session_id);
            let _ = app_clone.emit("asr-event", serde_json::json!({
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

    Ok(session_id)
}

#[tauri::command]
async fn cmd_start_recording(
    app: tauri::AppHandle,
    flag: tauri::State<'_, Arc<Mutex<RecordingFlag>>>,
) -> Result<(), String> {
    log::info!("[cmd] start_recording called");
    let recording_config = load_recording_settings_from_store(&app)?;
    start_recording_inner(&app, &flag, recording_config)?;
    Ok(())
}

/// 内部录音停止逻辑，可从任意线程调用
fn stop_recording_inner(flag: &Arc<Mutex<RecordingFlag>>) -> Result<(), String> {
    let mut f = flag.lock().map_err(|e| e.to_string())?;
    log::info!("[recording] stop_recording_inner, is_recording={}, session_id={}", f.is_recording, f.session_id);
    if !f.is_recording {
        return Err("当前没有在录音".to_string());
    }
    if let Some(tx) = f.stop_tx.take() {
        let _ = tx.send(());
    }
    f.is_recording = false;
    log::debug!("[recording] session {} stopped, is_recording=false", f.session_id);
    Ok(())
}

#[tauri::command]
fn cmd_stop_recording(
    flag: tauri::State<'_, Arc<Mutex<RecordingFlag>>>,
) -> Result<(), String> {
    log::info!("[cmd] stop_recording called");
    stop_recording_inner(&flag)
}

#[tauri::command]
fn cmd_load_stats(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let store = app.state::<AppStore>();
    let stats = store.stats();
    Ok(serde_json::json!({
        "totalDurationMs": stats.get("total_duration_ms").and_then(|v| v.as_i64()).unwrap_or(0),
        "totalChars": stats.get("total_chars").and_then(|v| v.as_i64()).unwrap_or(0),
        "totalCount": stats.get("total_count").and_then(|v| v.as_i64()).unwrap_or(0),
    }))
}

#[tauri::command]
fn cmd_get_data_dir() -> serde_json::Value {
    let base = store::base_dir();
    serde_json::json!({
        "settings": base.join("settings.json").to_string_lossy().into_owned(),
        "logs": base.join("logs").join("sayble.log").to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn cmd_load_history(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let store = app.state::<AppStore>();
    Ok(store.load_history())
}

#[tauri::command]
fn cmd_clear_history(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.state::<AppStore>();
    store.clear_history();
    Ok(())
}

#[tauri::command]
fn cmd_remove_history(app: tauri::AppHandle, timestamp: String) -> Result<(), String> {
    let store = app.state::<AppStore>();
    store.remove_history(&timestamp);
    Ok(())
}

/// 检查 GitHub Release 最新版本，如果有更新返回下载链接
#[tauri::command]
async fn cmd_check_update() -> Result<Option<String>, String> {
    log::info!("[cmd] check_update called");
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct GithubRelease {
        tag_name: String,
        html_url: String,
    }

    let client = reqwest::Client::new();
    let url = "https://api.github.com/repos/tdtdtq-ux/sayble/releases/latest";
    log::debug!("[cmd] check_update: requesting {}", url);

    let resp = client
        .get(url)
        .header("User-Agent", "Sayble")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| {
            log::error!("[cmd] check_update: request failed: {}", e);
            format!("网络请求失败: {}", e)
        })?;

    let status = resp.status();
    log::debug!("[cmd] check_update: response status: {}", status);

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        log::error!("[cmd] check_update: GitHub API error {}, body: {}", status, body);

        if status.as_u16() == 403 && body.contains("rate limit") {
            return Err("GitHub API 速率限制已超出，请稍后再试".to_string());
        }

        return Err(format!("GitHub API 返回错误: {}", status));
    }

    let release: GithubRelease = resp.json().await.map_err(|e| {
        log::error!("[cmd] check_update: parse response failed: {}", e);
        format!("解析响应失败: {}", e)
    })?;

    let current_version = env!("CARGO_PKG_VERSION");
    let latest_version = release.tag_name.strip_prefix('v').unwrap_or(&release.tag_name);

    log::info!("[cmd] check_update: current={}, latest={}", current_version, latest_version);

    if latest_version > current_version {
        log::info!("[cmd] check_update: new version available, url={}", release.html_url);
        Ok(Some(release.html_url))
    } else {
        log::info!("[cmd] check_update: already up to date");
        Ok(None)
    }
}

/// 从前端 JS 层注入按键事件，补偿 WebView2 焦点时键盘钩子失效的问题
#[tauri::command]
fn cmd_inject_key_event(
    hotkey_mgr: tauri::State<'_, Arc<Mutex<HotkeyManager>>>,
    vk_code: u32,
    is_down: bool,
) -> Result<(), String> {
    let mgr = hotkey_mgr.lock().map_err(|e| e.to_string())?;
    mgr.inject_key_event(vk_code, is_down);
    Ok(())
}
