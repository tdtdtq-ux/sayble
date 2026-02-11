use sayble_lib::config::*;
use sayble_lib::asr::protocol::*;
use sayble_lib::audio::AudioCapture;
use sayble_lib::asr::VolcEngineAsr;
use sayble_lib::asr::volcengine::{AsrEvent, run_asr_session};

/// 集成测试：完整配置 → ASR 验证 → 状态流转
#[test]
fn test_config_to_asr_validation_flow() {
    // 1. 创建默认配置
    let config = AppConfig::default();

    // 2. ASR 配置应为空，验证应失败
    assert!(VolcEngineAsr::validate_config(&config.asr).is_err());

    // 3. 填充配置后验证应通过
    let valid_config = AsrConfig {
        app_id: "test_app_id".to_string(),
        access_key: "test_key".to_string(),
        language: "zh".to_string(),
        auto_punctuation: true,
    };
    assert!(VolcEngineAsr::validate_config(&valid_config).is_ok());
}

/// 集成测试：协议构建 → 解析往返
#[test]
fn test_protocol_build_and_parse_roundtrip() {
    // 1. 构建 full client request
    let request = AsrRequest::new(true);
    let frame = build_full_client_request(&request).unwrap();

    // 2. 验证帧结构完整性
    assert!(frame.len() > 8); // header(4) + size(4) + payload

    // 3. 构建 audio request
    let audio_data = vec![0u8; 3200]; // 100ms of 16kHz 16bit mono
    let audio_frame = build_audio_request(&audio_data, false).unwrap();
    let (header, _) = parse_server_response(&audio_frame).unwrap_or_else(|_| {
        // audio frame 不是 server response，这里只验证 header 解析
        let h = ProtocolHeader::decode(&audio_frame).unwrap();
        (h, None)
    });
    assert!(!header.is_last_package());

    // 4. 构建 last audio request
    let last_frame = build_audio_request(&[], true).unwrap();
    let last_header = ProtocolHeader::decode(&last_frame).unwrap();
    assert!(last_header.is_last_package());
}

/// 集成测试：音频设备枚举
#[test]
fn test_audio_device_enumeration() {
    let result = AudioCapture::list_devices();
    // 不论环境是否有音频设备，都不应 panic
    match result {
        Ok(devices) => {
            // 设备列表可序列化
            let json = serde_json::to_string(&devices).unwrap();
            let deserialized: Vec<sayble_lib::audio::AudioDevice> =
                serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized.len(), devices.len());
        }
        Err(e) => {
            // CI 环境无音频设备，错误信息应有意义
            assert!(!e.is_empty());
        }
    }
}

/// 集成测试：配置序列化/反序列化完整性
#[test]
fn test_full_config_persistence_flow() {
    // 1. 创建完整配置
    let config = AppConfig {
        toggle_hotkey: HotkeyConfig {
            binding: HotkeyBinding {
                modifiers: vec![Modifier::RightCtrl],
                key: 0,
            },
        },
        asr: AsrConfig {
            app_id: "my_app".to_string(),
            access_key: "my_key".to_string(),
            language: "zh".to_string(),
            auto_punctuation: true,
        },
        output_mode: OutputMode::Clipboard,
        microphone_device: "Default Mic".to_string(),
        auto_start: true,
        auto_output: true,
    };

    // 2. 序列化为 JSON
    let json = serde_json::to_string_pretty(&config).unwrap();

    // 3. 反序列化回来
    let restored: AppConfig = serde_json::from_str(&json).unwrap();

    // 4. 验证所有字段
    assert_eq!(restored.toggle_hotkey.binding.modifiers, vec![Modifier::RightCtrl]);
    assert_eq!(restored.toggle_hotkey.binding.key, 0);
    assert_eq!(restored.asr.app_id, "my_app");
    assert_eq!(restored.output_mode, OutputMode::Clipboard);
    assert_eq!(restored.microphone_device, "Default Mic");
    assert!(restored.auto_start);
}

/// 集成测试：ASR 会话生命周期（无网络，验证状态管理）
#[test]
fn test_asr_session_lifecycle() {
    let config = AsrConfig::default();
    let mut asr = VolcEngineAsr::new(config);

    // 初始状态：未运行
    assert!(!asr.is_running());

    // 无有效配置，启动应失败
    let result = asr.start_session();
    assert!(result.is_err());
    assert!(!asr.is_running());

    // 停止应安全
    asr.stop_session();
    assert!(!asr.is_running());
}

/// 集成测试：状态枚举序列化
#[test]
fn test_app_state_transitions() {
    let states = vec![AppState::Idle, AppState::Recording, AppState::Recognizing];

    for state in &states {
        let json = serde_json::to_string(state).unwrap();
        let restored: AppState = serde_json::from_str(&json).unwrap();
        assert_eq!(*state, restored);
    }
}

/// 从 MP3 文件解码出 16kHz mono i16 PCM 数据
fn decode_mp3_to_pcm(path: &std::path::Path) -> Vec<i16> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(path).expect("Failed to open MP3 file");
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    hint.with_extension("mp3");

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .expect("Failed to probe MP3");

    let mut format = probed.format;
    let track = format.default_track().expect("No default track").clone();
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .expect("Failed to create decoder");

    let source_sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let source_channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(1);

    println!(
        "MP3 decode: sample_rate={}, channels={}",
        source_sample_rate, source_channels
    );

    let mut all_samples: Vec<i16> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if packet.track_id() != track.id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let spec = *decoded.spec();
        let num_frames = decoded.frames();
        let mut sample_buf = SampleBuffer::<i16>::new(num_frames as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        all_samples.extend_from_slice(sample_buf.samples());
    }

    // Downmix to mono
    let mono: Vec<i16> = if source_channels > 1 {
        all_samples
            .chunks(source_channels)
            .map(|frame| {
                let sum: i32 = frame.iter().map(|&s| s as i32).sum();
                (sum / frame.len() as i32) as i16
            })
            .collect()
    } else {
        all_samples
    };

    // Resample to 16kHz
    if source_sample_rate == 16000 {
        return mono;
    }
    let ratio = 16000.0 / source_sample_rate as f64;
    let output_len = (mono.len() as f64 * ratio) as usize;
    let mut resampled = Vec::with_capacity(output_len);
    for i in 0..output_len {
        let src_pos = i as f64 / ratio;
        let idx = src_pos as usize;
        let frac = src_pos - idx as f64;
        if idx + 1 < mono.len() {
            let s = mono[idx] as f64 * (1.0 - frac) + mono[idx + 1] as f64 * frac;
            resampled.push(s as i16);
        } else if idx < mono.len() {
            resampled.push(mono[idx]);
        }
    }
    resampled
}

/// 集成测试：MP3 文件 → ASR 完整流程
/// 验证识别结果包含 "豆包" 或 "流式" 或 "语音识别"
#[tokio::test]
#[ignore] // 需要 .env.local 中配置有效密钥，手动运行: cargo test -- --ignored
async fn test_asr_with_mp3_file() {
    let _ = log::set_max_level(log::LevelFilter::Debug);

    // 1. 加载 .env.local 配置
    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".env.local");
    dotenvy::from_path(&env_path).expect("Failed to load .env.local");

    let config = AsrConfig {
        app_id: std::env::var("ASR_APP_ID").expect("ASR_APP_ID not set"),
        access_key: std::env::var("ASR_ACCESS_KEY").expect("ASR_ACCESS_KEY not set"),
        ..Default::default()
    };

    // 2. 解码 MP3 为 16kHz mono PCM
    let mp3_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("audio_1770502696039.mp3");
    assert!(mp3_path.exists(), "MP3 file not found: {:?}", mp3_path);

    let pcm_samples = decode_mp3_to_pcm(&mp3_path);
    println!("Decoded {} PCM samples from MP3", pcm_samples.len());
    assert!(!pcm_samples.is_empty(), "Decoded PCM is empty");

    // 3. 构建 channel 并启动 ASR 会话
    let (event_tx, event_rx) = std::sync::mpsc::channel::<AsrEvent>();
    let (audio_tx, audio_rx) = tokio::sync::mpsc::channel::<Vec<i16>>(100);
    let is_running = std::sync::Arc::new(std::sync::Mutex::new(true));

    let event_tx_clone = event_tx.clone();
    let is_running_clone = is_running.clone();
    let asr_handle = tokio::spawn(async move {
        if let Err(e) = run_asr_session(config, event_tx_clone.clone(), audio_rx, is_running_clone).await {
            let _ = event_tx_clone.send(AsrEvent::Error(e));
        }
    });

    // 4. 分块发送音频数据（模拟实时流，每块 3200 samples = 200ms @16kHz）
    let chunk_size = 3200;
    for chunk in pcm_samples.chunks(chunk_size) {
        audio_tx.send(chunk.to_vec()).await.expect("Failed to send audio chunk");
        // 按实际音频时长节奏发送，3200 samples @16kHz = 200ms
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    // 关闭 audio channel，触发发送 last frame
    drop(audio_tx);

    // 5. 收集 ASR 事件，等待最终结果（最多 15 秒超时）
    let mut final_text = String::new();
    let mut got_connected = false;
    let mut all_events: Vec<String> = Vec::new();

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    loop {
        if std::time::Instant::now() > deadline {
            panic!("ASR timeout! Events received: {:?}", all_events);
        }
        match event_rx.try_recv() {
            Ok(event) => {
                let event_str = format!("{:?}", event);
                println!("ASR event: {}", event_str);
                all_events.push(event_str);
                match event {
                    AsrEvent::Connected => got_connected = true,
                    AsrEvent::PartialResult(text) => {
                        println!("  Partial: {}", text);
                    }
                    AsrEvent::FinalResult(text) => {
                        println!("  Final: {}", text);
                        final_text = text;
                        break;
                    }
                    AsrEvent::Error(e) => {
                        panic!("ASR error: {}", e);
                    }
                    AsrEvent::Disconnected => {
                        break;
                    }
                }
            }
            Err(std::sync::mpsc::TryRecvError::Empty) => {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
        }
    }

    let _ = asr_handle.await;

    // 6. 验证结果
    assert!(got_connected, "Never received Connected event");
    assert!(!final_text.is_empty(), "Final result is empty. Events: {:?}", all_events);
    println!("=== Final recognition result: {} ===", final_text);

    // 预期内容: "豆包流式语音识别模型"
    let contains_keyword = final_text.contains("豆包")
        || final_text.contains("流式")
        || final_text.contains("语音识别")
        || final_text.contains("模型");
    assert!(
        contains_keyword,
        "Recognition result '{}' does not contain expected keywords (豆包/流式/语音识别/模型)",
        final_text
    );
}
