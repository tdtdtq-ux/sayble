use super::AsrEvent;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use windows::core::Interface;
use windows::Win32::Media::Speech::*;
use windows::Win32::System::Com::*;

/// 在独立 OS 线程运行 SAPI 识别会话（COM STA 要求）
///
/// - `event_tx`: 发送 AsrEvent 到调用方
/// - `is_running`: 外部控制停止的标志
pub fn run_sapi_session(
    event_tx: mpsc::Sender<AsrEvent>,
    is_running: Arc<Mutex<bool>>,
) {
    unsafe {
        // 1. 初始化 COM（STA 模式）
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_err() {
            let _ = event_tx.send(AsrEvent::Error(format!("COM 初始化失败: {:?}", hr)));
            return;
        }

        let result = run_sapi_session_inner(&event_tx, &is_running);
        if let Err(e) = result {
            let _ = event_tx.send(AsrEvent::Error(e));
        }

        let _ = event_tx.send(AsrEvent::Disconnected);
        CoUninitialize();
    }
}

unsafe fn run_sapi_session_inner(
    event_tx: &mpsc::Sender<AsrEvent>,
    is_running: &Arc<Mutex<bool>>,
) -> std::result::Result<(), String> {
    // 2. 创建进程内识别器（不弹系统引导向导）
    let reco: ISpRecognizer = CoCreateInstance(
        &SpInprocRecognizer,
        None,
        CLSCTX_ALL,
    ).map_err(|e| format!("创建语音识别器失败: {:?}", e))?;

    // 2.1 设置音频输入为系统默认麦克风
    let cat: ISpObjectTokenCategory = CoCreateInstance(
        &SpObjectTokenCategory,
        None,
        CLSCTX_ALL,
    ).map_err(|e| format!("创建音频输入类别失败: {:?}", e))?;

    cat.SetId(SPCAT_AUDIOIN, false)
        .map_err(|e| format!("设置音频输入类别失败: {:?}", e))?;

    let token_id = cat.GetDefaultTokenId()
        .map_err(|e| format!("获取默认音频输入失败: {:?}", e))?;

    let audio_token: ISpObjectToken = CoCreateInstance(
        &SpObjectToken,
        None,
        CLSCTX_ALL,
    ).map_err(|e| format!("创建音频 Token 失败: {:?}", e))?;

    audio_token.SetId(None, windows::core::PCWSTR(token_id.as_ptr()), false)
        .map_err(|e| format!("设置音频 Token ID 失败: {:?}", e))?;

    CoTaskMemFree(Some(token_id.as_ptr() as *const _));

    reco.SetInput(&audio_token, true)
        .map_err(|e| format!("设置音频输入失败: {:?}", e))?;

    // 3. 创建识别上下文
    let context: ISpRecoContext = reco.CreateRecoContext()
        .map_err(|e| format!("创建识别上下文失败: {:?}", e))?;

    // 4. 设置关注的事件：HYPOTHESIS（中间结果）+ RECOGNITION（最终结果）
    let interest = spfei(SPEI_HYPOTHESIS.0 as u64) | spfei(SPEI_RECOGNITION.0 as u64);
    context.SetInterest(interest, interest)
        .map_err(|e| format!("设置事件兴趣失败: {:?}", e))?;

    // 5. 创建并加载听写语法
    let grammar: ISpRecoGrammar = context.CreateGrammar(0)
        .map_err(|e| format!("创建语法失败: {:?}", e))?;

    grammar.LoadDictation(None, SPLOADOPTIONS(0))
        .map_err(|e| format!("加载听写语法失败: {:?}", e))?;

    grammar.SetDictationState(SPRS_ACTIVE)
        .map_err(|e| format!("激活听写失败: {:?}", e))?;

    let _ = event_tx.send(AsrEvent::Connected);
    log::info!("[asr-sapi] SAPI session started, dictation active");

    // 6. 获取事件通知句柄
    let notify: ISpNotifySource = context.cast()
        .map_err(|e| format!("获取通知源失败: {:?}", e))?;
    let wait_handle = notify.GetNotifyEventHandle();
    if wait_handle.0.is_null() {
        return Err("获取事件句柄失败".to_string());
    }

    // 7. 事件循环
    loop {
        // 检查是否需要停止
        if let Ok(running) = is_running.lock() {
            if !*running {
                log::info!("[asr-sapi] is_running=false, stopping");
                break;
            }
        }

        // 等待事件，100ms 超时后重新检查 is_running
        let wait_result = windows::Win32::System::Threading::WaitForSingleObject(
            wait_handle,
            100,
        );

        if wait_result == windows::Win32::Foundation::WAIT_OBJECT_0 {
            // 有事件，逐个处理
            loop {
                let mut event = SPEVENT::default();
                let mut fetched = 0u32;
                let hr = context.GetEvents(1, &mut event, &mut fetched);
                if hr.is_err() || fetched == 0 {
                    break;
                }

                // eEventId 在 _bitfield 的低 16 位
                let event_id = SPEVENTENUM(event._bitfield & 0xFFFF);

                match event_id {
                    SPEI_HYPOTHESIS => {
                        if let Some(text) = extract_reco_text(event.lParam) {
                            log::debug!("[asr-sapi] hypothesis: {}", text);
                            let _ = event_tx.send(AsrEvent::PartialResult(text));
                        }
                    }
                    SPEI_RECOGNITION => {
                        if let Some(text) = extract_reco_text(event.lParam) {
                            log::info!("[asr-sapi] recognition: {}", text);
                            let _ = event_tx.send(AsrEvent::FinalResult(text, None));
                        }
                    }
                    _ => {}
                }
            }
        }
        // WAIT_TIMEOUT: 继续循环检查 is_running
    }

    // 8. 停止听写
    let _ = grammar.SetDictationState(SPRS_INACTIVE);
    log::info!("[asr-sapi] SAPI session stopped");

    Ok(())
}

/// 从 SPEVENT.lParam（ISpRecoResult 指针）中提取识别文本
unsafe fn extract_reco_text(lparam: windows::Win32::Foundation::LPARAM) -> Option<String> {
    if lparam.0 == 0 {
        return None;
    }

    // lParam 是 ISpRecoResult COM 指针
    let raw_ptr = lparam.0 as *mut std::ffi::c_void;
    // transmute_copy 创建了一个新的智能指针但不增加引用计数
    // SPEVENT 拥有这个引用，用 ManuallyDrop 避免 double-free
    // 然后通过 clone() 获取一个有独立引用计数的副本来安全使用
    let borrowed: std::mem::ManuallyDrop<ISpRecoResult> = std::mem::transmute_copy(&raw_ptr);
    let reco_result: ISpRecoResult = (*borrowed).clone();

    let phrase_ptr = reco_result.GetPhrase().ok()?;

    if phrase_ptr.is_null() {
        return None;
    }

    let phrase = &*phrase_ptr;
    let elements_count = phrase.Base.Rule.ulCountOfElements as usize;

    if elements_count == 0 {
        CoTaskMemFree(Some(phrase_ptr as *const _));
        return None;
    }

    let mut texts = Vec::new();
    let elements_ptr = phrase.Base.pElements;

    for i in 0..elements_count {
        let element = &*elements_ptr.add(i);
        let display = element.pszDisplayText;
        if !display.0.is_null() {
            let text = pcwstr_to_string(display);
            if !text.is_empty() {
                texts.push(text);
            }
        }
    }

    CoTaskMemFree(Some(phrase_ptr as *const _));

    let result = texts.join("");
    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

/// PCWSTR 转 String
unsafe fn pcwstr_to_string(ptr: windows::core::PCWSTR) -> String {
    if ptr.0.is_null() {
        return String::new();
    }
    let len = (0..).take_while(|&i| *ptr.0.offset(i) != 0).count();
    let slice = std::slice::from_raw_parts(ptr.0, len);
    String::from_utf16_lossy(slice)
}

/// SPFEI 宏的 Rust 等价实现
/// C 原型: #define SPFEI(x) ((1ui64 << x) | (1ui64 << SPEI_RESERVED1) | (1ui64 << SPEI_RESERVED2))
const fn spfei(event: u64) -> u64 {
    (1u64 << event) | (1u64 << 30) | (1u64 << 33)
}

/// 测试 SAPI 是否可用：尝试创建 SpInprocRecognizer 实例
pub fn test_sapi_available() -> std::result::Result<String, String> {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_err() {
            return Err(format!("COM 初始化失败: {:?}", hr));
        }

        let result: windows::core::Result<ISpRecognizer> = CoCreateInstance(
            &SpInprocRecognizer,
            None,
            CLSCTX_ALL,
        );

        CoUninitialize();

        match result {
            Ok(_) => Ok("Windows 语音识别可用".to_string()),
            Err(e) => Err(format!("Windows 语音识别不可用: {:?}", e)),
        }
    }
}
