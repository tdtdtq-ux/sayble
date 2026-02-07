use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, SampleRate, StreamConfig};
use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

/// 音频设备信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    pub name: String,
    pub is_default: bool,
}

/// 音频采集器
pub struct AudioCapture {
    stream: Option<cpal::Stream>,
    data_rx: Option<mpsc::Receiver<Vec<i16>>>,
    is_capturing: Arc<Mutex<bool>>,
}

/// 目标采集参数：PCM 16kHz mono 16bit（火山引擎要求）
const TARGET_SAMPLE_RATE: u32 = 16000;

impl AudioCapture {
    pub fn new() -> Self {
        Self {
            stream: None,
            data_rx: None,
            is_capturing: Arc::new(Mutex::new(false)),
        }
    }

    /// 列出可用的输入设备
    pub fn list_devices() -> Result<Vec<AudioDevice>, String> {
        let host = cpal::default_host();
        let default_device_name = host
            .default_input_device()
            .and_then(|d| d.name().ok())
            .unwrap_or_default();

        let devices: Vec<AudioDevice> = host
            .input_devices()
            .map_err(|e| format!("Failed to enumerate input devices: {}", e))?
            .filter_map(|device| {
                let name = device.name().ok()?;
                Some(AudioDevice {
                    is_default: name == default_device_name,
                    name,
                })
            })
            .collect();

        Ok(devices)
    }

    /// 获取指定名称的设备，空字符串返回默认设备
    fn get_device(device_name: &str) -> Result<Device, String> {
        let host = cpal::default_host();

        if device_name.is_empty() {
            return host
                .default_input_device()
                .ok_or_else(|| "No default input device found".to_string());
        }

        host.input_devices()
            .map_err(|e| format!("Failed to enumerate input devices: {}", e))?
            .find(|d| d.name().map(|n| n == device_name).unwrap_or(false))
            .ok_or_else(|| format!("Device '{}' not found", device_name))
    }

    /// 开始采集音频
    pub fn start(&mut self, device_name: &str) -> Result<mpsc::Receiver<Vec<i16>>, String> {
        if self.is_capturing() {
            return Err("Already capturing".to_string());
        }

        let device = Self::get_device(device_name)?;
        let supported_config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        log::info!(
            "Device input config: sample_rate={}, channels={}, format={:?}",
            supported_config.sample_rate().0,
            supported_config.channels(),
            supported_config.sample_format()
        );

        let (data_tx, data_rx) = mpsc::channel::<Vec<i16>>();
        let (public_tx, public_rx) = mpsc::channel::<Vec<i16>>();

        let device_sample_rate = supported_config.sample_rate().0;
        let device_channels = supported_config.channels();
        let sample_format = supported_config.sample_format();

        let config = StreamConfig {
            channels: device_channels,
            sample_rate: SampleRate(device_sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let stream = match sample_format {
            SampleFormat::I16 => {
                let data_tx = data_tx.clone();
                device
                    .build_input_stream(
                        &config,
                        move |data: &[i16], _: &cpal::InputCallbackInfo| {
                            let _ = data_tx.send(data.to_vec());
                        },
                        move |err| {
                            log::error!("Audio input error: {}", err);
                        },
                        None,
                    )
                    .map_err(|e| format!("Failed to build input stream: {}", e))?
            }
            SampleFormat::F32 => {
                let data_tx = data_tx.clone();
                device
                    .build_input_stream(
                        &config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            let converted: Vec<i16> = data
                                .iter()
                                .map(|&s| (s * i16::MAX as f32) as i16)
                                .collect();
                            let _ = data_tx.send(converted);
                        },
                        move |err| {
                            log::error!("Audio input error: {}", err);
                        },
                        None,
                    )
                    .map_err(|e| format!("Failed to build input stream: {}", e))?
            }
            format => {
                return Err(format!("Unsupported sample format: {:?}", format));
            }
        };

        stream
            .play()
            .map_err(|e| format!("Failed to start audio stream: {}", e))?;

        // 重采样线程：将设备采样率/通道数转换为 16kHz 单声道
        let is_capturing_resample = self.is_capturing.clone();
        std::thread::spawn(move || {
            while *is_capturing_resample.lock().unwrap_or_else(|e| e.into_inner()) {
                match data_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(samples) => {
                        let mono = if device_channels > 1 {
                            downmix_to_mono(&samples, device_channels as usize)
                        } else {
                            samples
                        };

                        let resampled = if device_sample_rate != TARGET_SAMPLE_RATE {
                            resample(&mono, device_sample_rate, TARGET_SAMPLE_RATE)
                        } else {
                            mono
                        };

                        if !resampled.is_empty() {
                            let _ = public_tx.send(resampled);
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        *self.is_capturing.lock().map_err(|e| e.to_string())? = true;
        self.stream = Some(stream);

        Ok(public_rx)
    }

    /// 停止采集
    pub fn stop(&mut self) {
        if let Ok(mut capturing) = self.is_capturing.lock() {
            *capturing = false;
        }
        self.stream = None;
        self.data_rx = None;
    }

    /// 是否正在采集
    pub fn is_capturing(&self) -> bool {
        self.is_capturing
            .lock()
            .map(|c| *c)
            .unwrap_or(false)
    }
}

/// 多声道混缩为单声道
fn downmix_to_mono(samples: &[i16], channels: usize) -> Vec<i16> {
    if channels <= 1 {
        return samples.to_vec();
    }
    samples
        .chunks(channels)
        .map(|frame| {
            let sum: i32 = frame.iter().map(|&s| s as i32).sum();
            (sum / channels as i32) as i16
        })
        .collect()
}

/// 简单线性重采样
fn resample(samples: &[i16], from_rate: u32, to_rate: u32) -> Vec<i16> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (samples.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_pos = i as f64 * ratio;
        let src_idx = src_pos as usize;
        let frac = src_pos - src_idx as f64;

        let sample = if src_idx + 1 < samples.len() {
            let a = samples[src_idx] as f64;
            let b = samples[src_idx + 1] as f64;
            (a + (b - a) * frac) as i16
        } else if src_idx < samples.len() {
            samples[src_idx]
        } else {
            0
        };

        output.push(sample);
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_downmix_to_mono_stereo() {
        let stereo = vec![100, 200, 300, 400, 500, 600];
        let mono = downmix_to_mono(&stereo, 2);
        assert_eq!(mono, vec![150, 350, 550]);
    }

    #[test]
    fn test_downmix_to_mono_already_mono() {
        let mono_input = vec![100, 200, 300];
        let result = downmix_to_mono(&mono_input, 1);
        assert_eq!(result, mono_input);
    }

    #[test]
    fn test_downmix_to_mono_empty() {
        let empty: Vec<i16> = vec![];
        let result = downmix_to_mono(&empty, 2);
        assert!(result.is_empty());
    }

    #[test]
    fn test_resample_same_rate() {
        let samples = vec![100, 200, 300, 400];
        let result = resample(&samples, 44100, 44100);
        assert_eq!(result, samples);
    }

    #[test]
    fn test_resample_downsample() {
        // 从 32000 降采样到 16000（2:1）
        let samples: Vec<i16> = (0..100).map(|i| (i * 100) as i16).collect();
        let result = resample(&samples, 32000, 16000);
        // 输出长度应约为输入的一半
        assert_eq!(result.len(), 50);
    }

    #[test]
    fn test_resample_upsample() {
        // 从 8000 上采样到 16000（1:2）
        let samples = vec![0i16, 1000, 2000, 3000];
        let result = resample(&samples, 8000, 16000);
        assert_eq!(result.len(), 8);
        // 第一个采样点保持不变
        assert_eq!(result[0], 0);
    }

    #[test]
    fn test_resample_empty() {
        let empty: Vec<i16> = vec![];
        let result = resample(&empty, 44100, 16000);
        assert!(result.is_empty());
    }

    #[test]
    fn test_resample_interpolation() {
        // 验证线性插值正确性
        let samples = vec![0i16, 1000];
        let result = resample(&samples, 16000, 32000);
        // 应产生 4 个样本：0, ~500, 1000, ...
        assert_eq!(result.len(), 4);
        assert_eq!(result[0], 0);
        // 中间值应在 0 和 1000 之间
        assert!(result[1] > 0 && result[1] < 1000);
    }

    #[test]
    fn test_audio_capture_new() {
        let capture = AudioCapture::new();
        assert!(!capture.is_capturing());
        assert!(capture.stream.is_none());
    }

    #[test]
    fn test_list_devices() {
        // 这个测试依赖系统有音频设备，但不应 panic
        let result = AudioCapture::list_devices();
        // 无论成功失败都不应 panic
        match result {
            Ok(devices) => {
                // 如果有设备，至少有一个应该是默认设备
                if !devices.is_empty() {
                    assert!(devices.iter().any(|d| d.is_default));
                }
            }
            Err(_) => {
                // 在 CI 或无音频设备环境下可能失败，这是预期行为
            }
        }
    }

    #[test]
    fn test_audio_device_serialization() {
        let device = AudioDevice {
            name: "Test Microphone".to_string(),
            is_default: true,
        };
        let json = serde_json::to_string(&device).unwrap();
        let deserialized: AudioDevice = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "Test Microphone");
        assert!(deserialized.is_default);
    }

    #[test]
    fn test_capture_stop_when_not_started() {
        let mut capture = AudioCapture::new();
        // 停止未启动的采集不应 panic
        capture.stop();
        assert!(!capture.is_capturing());
    }

    #[test]
    fn test_downmix_four_channels() {
        let samples = vec![100, 200, 300, 400]; // 1 frame of 4-channel
        let mono = downmix_to_mono(&samples, 4);
        assert_eq!(mono, vec![250]); // (100+200+300+400)/4 = 250
    }
}
