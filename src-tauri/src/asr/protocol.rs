use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Write};

// 协议常量
const PROTOCOL_VERSION: u8 = 0b0001;
const DEFAULT_HEADER_SIZE: u8 = 0b0001; // 1 * 4 = 4 bytes

// 消息类型
const MSG_FULL_CLIENT_REQUEST: u8 = 0b0001;
const MSG_AUDIO_ONLY_REQUEST: u8 = 0b0010;
const MSG_FULL_SERVER_RESPONSE: u8 = 0b1001;
const MSG_SERVER_ACK: u8 = 0b1011;
const MSG_SERVER_ERROR: u8 = 0b1111;

// 消息类型特定标志
const FLAG_NO_SEQUENCE: u8 = 0b0000;
const FLAG_POS_SEQUENCE: u8 = 0b0001;
const FLAG_NEG_SEQUENCE: u8 = 0b0010;
const FLAG_NEG_WITH_SEQUENCE: u8 = 0b0011;

// 序列化方法
const SERIAL_NONE: u8 = 0b0000;
const SERIAL_JSON: u8 = 0b0001;

// 压缩方法
const COMPRESS_NONE: u8 = 0b0000;

/// 协议头
#[derive(Debug, Clone)]
pub struct ProtocolHeader {
    pub version: u8,
    pub header_size: u8,
    pub msg_type: u8,
    pub msg_flags: u8,
    pub serial_method: u8,
    pub compression: u8,
}

impl Default for ProtocolHeader {
    fn default() -> Self {
        Self {
            version: PROTOCOL_VERSION,
            header_size: DEFAULT_HEADER_SIZE,
            msg_type: MSG_FULL_CLIENT_REQUEST,
            msg_flags: FLAG_NO_SEQUENCE,
            serial_method: SERIAL_JSON,
            compression: COMPRESS_NONE,
        }
    }
}

impl ProtocolHeader {
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(4);
        // Byte 0: version(4) + header_size(4)
        buf.push((self.version << 4) | self.header_size);
        // Byte 1: msg_type(4) + msg_flags(4)
        buf.push((self.msg_type << 4) | self.msg_flags);
        // Byte 2: serial_method(4) + compression(4)
        buf.push((self.serial_method << 4) | self.compression);
        // Byte 3: reserved
        buf.push(0x00);
        buf
    }

    pub fn decode(data: &[u8]) -> Result<Self, String> {
        if data.len() < 4 {
            return Err("Header too short".to_string());
        }
        Ok(Self {
            version: (data[0] >> 4) & 0x0F,
            header_size: data[0] & 0x0F,
            msg_type: (data[1] >> 4) & 0x0F,
            msg_flags: data[1] & 0x0F,
            serial_method: (data[2] >> 4) & 0x0F,
            compression: data[2] & 0x0F,
            // data[3] is reserved
        })
    }

    pub fn is_server_response(&self) -> bool {
        self.msg_type == MSG_FULL_SERVER_RESPONSE
    }

    pub fn is_server_error(&self) -> bool {
        self.msg_type == MSG_SERVER_ERROR
    }

    pub fn is_server_ack(&self) -> bool {
        self.msg_type == MSG_SERVER_ACK
    }

    pub fn is_last_package(&self) -> bool {
        self.msg_flags == FLAG_NEG_SEQUENCE || self.msg_flags == FLAG_NEG_WITH_SEQUENCE
    }

    /// header 后面是否有 4 字节的 sequence number
    pub fn has_sequence(&self) -> bool {
        self.msg_flags == FLAG_POS_SEQUENCE || self.msg_flags == FLAG_NEG_WITH_SEQUENCE
    }
}

/// ASR 请求参数（v3 大模型流式语音识别）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrRequest {
    pub user: AsrUserInfo,
    pub audio: AsrAudioInfo,
    pub request: AsrRequestInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrUserInfo {
    pub uid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrAudioInfo {
    pub format: String,
    pub rate: u32,
    pub bits: u32,
    pub channel: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrRequestInfo {
    pub model_name: String,
    pub enable_itn: bool,
    pub enable_punc: bool,
    pub result_type: String,
}

/// ASR 识别结果（v3）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrResponse {
    pub code: Option<i32>,
    pub message: Option<String>,
    pub result: Option<AsrResult>,
    pub audio_info: Option<AsrAudioInfoResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrResult {
    pub text: Option<String>,
    pub utterances: Option<Vec<AsrUtterance>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrUtterance {
    pub text: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub definite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrAudioInfoResponse {
    pub duration: Option<i64>,
}

impl AsrRequest {
    pub fn new(enable_punc: bool) -> Self {
        Self {
            user: AsrUserInfo {
                uid: "voice_keyboard_user".to_string(),
            },
            audio: AsrAudioInfo {
                format: "pcm".to_string(),
                rate: 16000,
                bits: 16,
                channel: 1,
            },
            request: AsrRequestInfo {
                model_name: "bigmodel".to_string(),
                enable_itn: true,
                enable_punc,
                result_type: "full".to_string(),
            },
        }
    }
}

/// 构建完整客户端请求帧（full client request with JSON payload）
pub fn build_full_client_request(request: &AsrRequest) -> Result<Vec<u8>, String> {
    let header = ProtocolHeader {
        msg_type: MSG_FULL_CLIENT_REQUEST,
        msg_flags: FLAG_NO_SEQUENCE,
        serial_method: SERIAL_JSON,
        compression: COMPRESS_NONE,
        ..Default::default()
    };

    let payload = serde_json::to_vec(request).map_err(|e| format!("JSON serialize error: {}", e))?;

    let mut frame = header.encode();
    frame
        .write_u32::<BigEndian>(payload.len() as u32)
        .map_err(|e| e.to_string())?;
    frame.write_all(&payload).map_err(|e| e.to_string())?;

    Ok(frame)
}

/// 构建音频数据帧（audio only request）
pub fn build_audio_request(audio_data: &[u8], is_last: bool) -> Result<Vec<u8>, String> {
    let header = ProtocolHeader {
        msg_type: MSG_AUDIO_ONLY_REQUEST,
        msg_flags: if is_last {
            FLAG_NEG_SEQUENCE
        } else {
            FLAG_NO_SEQUENCE
        },
        serial_method: SERIAL_NONE,
        compression: COMPRESS_NONE,
        ..Default::default()
    };

    let mut frame = header.encode();
    frame
        .write_u32::<BigEndian>(audio_data.len() as u32)
        .map_err(|e| e.to_string())?;
    frame.write_all(audio_data).map_err(|e| e.to_string())?;

    Ok(frame)
}

/// 解析服务端响应
pub fn parse_server_response(data: &[u8]) -> Result<(ProtocolHeader, Option<AsrResponse>), String> {
    if data.len() < 4 {
        return Err("Response too short".to_string());
    }

    let header = ProtocolHeader::decode(data)?;
    let header_bytes = (header.header_size as usize) * 4;

    // 根据 msg_flags 判断 header 后是否有 4 字节 sequence number
    let seq_bytes = if header.has_sequence() { 4 } else { 0 };
    let size_offset = header_bytes + seq_bytes;

    if data.len() < size_offset + 4 {
        return Ok((header, None));
    }

    let mut cursor = Cursor::new(&data[size_offset..]);
    let payload_size = cursor
        .read_u32::<BigEndian>()
        .map_err(|e| e.to_string())? as usize;

    if payload_size == 0 {
        return Ok((header, None));
    }

    let payload_start = size_offset + 4;
    let payload_end = payload_start + payload_size;

    if data.len() < payload_end {
        return Err(format!(
            "Payload truncated: expected {} bytes, got {}",
            payload_size,
            data.len() - payload_start
        ));
    }

    let payload_data = &data[payload_start..payload_end];

    if header.is_server_response() || header.is_server_error() {
        let response: AsrResponse = serde_json::from_slice(payload_data)
            .map_err(|e| format!("JSON parse error: {}", e))?;
        Ok((header, Some(response)))
    } else {
        Ok((header, None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_header_encode_decode_roundtrip() {
        let header = ProtocolHeader::default();
        let encoded = header.encode();
        assert_eq!(encoded.len(), 4);

        let decoded = ProtocolHeader::decode(&encoded).unwrap();
        assert_eq!(decoded.version, PROTOCOL_VERSION);
        assert_eq!(decoded.header_size, DEFAULT_HEADER_SIZE);
        assert_eq!(decoded.msg_type, MSG_FULL_CLIENT_REQUEST);
        assert_eq!(decoded.msg_flags, FLAG_NO_SEQUENCE);
        assert_eq!(decoded.serial_method, SERIAL_JSON);
        assert_eq!(decoded.compression, COMPRESS_NONE);
    }

    #[test]
    fn test_header_encode_byte_layout() {
        let header = ProtocolHeader {
            version: 0b0001,
            header_size: 0b0001,
            msg_type: 0b0010,
            msg_flags: 0b0010,
            serial_method: 0b0000,
            compression: 0b0000,
            // reserved: 0x00,
        };
        let encoded = header.encode();
        // Byte 0: (0001 << 4) | 0001 = 0x11
        assert_eq!(encoded[0], 0x11);
        // Byte 1: (0010 << 4) | 0010 = 0x22
        assert_eq!(encoded[1], 0x22);
        // Byte 2: (0000 << 4) | 0000 = 0x00
        assert_eq!(encoded[2], 0x00);
        // Byte 3: reserved = 0x00
        assert_eq!(encoded[3], 0x00);
    }

    #[test]
    fn test_header_decode_too_short() {
        let data = vec![0x11, 0x10];
        let result = ProtocolHeader::decode(&data);
        assert!(result.is_err());
    }

    #[test]
    fn test_header_is_server_response() {
        let header = ProtocolHeader {
            msg_type: MSG_FULL_SERVER_RESPONSE,
            ..Default::default()
        };
        assert!(header.is_server_response());
        assert!(!header.is_server_error());
    }

    #[test]
    fn test_header_is_server_error() {
        let header = ProtocolHeader {
            msg_type: MSG_SERVER_ERROR,
            ..Default::default()
        };
        assert!(header.is_server_error());
        assert!(!header.is_server_response());
    }

    #[test]
    fn test_header_is_last_package() {
        let header_neg = ProtocolHeader {
            msg_flags: FLAG_NEG_SEQUENCE,
            ..Default::default()
        };
        assert!(header_neg.is_last_package());

        let header_neg_seq = ProtocolHeader {
            msg_flags: FLAG_NEG_WITH_SEQUENCE,
            ..Default::default()
        };
        assert!(header_neg_seq.is_last_package());

        let header_normal = ProtocolHeader {
            msg_flags: FLAG_NO_SEQUENCE,
            ..Default::default()
        };
        assert!(!header_normal.is_last_package());
    }

    #[test]
    fn test_asr_request_new() {
        let req = AsrRequest::new(true);
        assert_eq!(req.audio.rate, 16000);
        assert_eq!(req.audio.bits, 16);
        assert_eq!(req.audio.channel, 1);
        assert_eq!(req.audio.format, "pcm");
        assert_eq!(req.request.model_name, "bigmodel");
        assert!(req.request.enable_itn);
        assert!(req.request.enable_punc);
        assert_eq!(req.request.result_type, "full");
    }

    #[test]
    fn test_asr_request_new_no_punc() {
        let req = AsrRequest::new(false);
        assert!(!req.request.enable_punc);
        assert!(req.request.enable_itn);
    }

    #[test]
    fn test_build_full_client_request() {
        let req = AsrRequest::new(true);
        let frame = build_full_client_request(&req).unwrap();

        // 至少应该有 header(4) + payload_size(4) + payload(>0)
        assert!(frame.len() > 8);

        // 验证 header
        let header = ProtocolHeader::decode(&frame).unwrap();
        assert_eq!(header.msg_type, MSG_FULL_CLIENT_REQUEST);
        assert_eq!(header.serial_method, SERIAL_JSON);

        // 验证 payload size
        let mut cursor = Cursor::new(&frame[4..8]);
        let payload_size = cursor.read_u32::<BigEndian>().unwrap() as usize;
        assert_eq!(frame.len(), 4 + 4 + payload_size);

        // 验证 payload 是有效 JSON
        let payload = &frame[8..];
        let parsed: AsrRequest = serde_json::from_slice(payload).unwrap();
        assert_eq!(parsed.request.model_name, "bigmodel");
    }

    #[test]
    fn test_build_audio_request_not_last() {
        let audio = vec![0u8; 3200]; // 100ms of 16kHz 16bit mono
        let frame = build_audio_request(&audio, false).unwrap();

        let header = ProtocolHeader::decode(&frame).unwrap();
        assert_eq!(header.msg_type, MSG_AUDIO_ONLY_REQUEST);
        assert_eq!(header.msg_flags, FLAG_NO_SEQUENCE);
        assert!(!header.is_last_package());

        let mut cursor = Cursor::new(&frame[4..8]);
        let payload_size = cursor.read_u32::<BigEndian>().unwrap() as usize;
        assert_eq!(payload_size, 3200);
    }

    #[test]
    fn test_build_audio_request_last() {
        let audio = vec![0u8; 1600];
        let frame = build_audio_request(&audio, true).unwrap();

        let header = ProtocolHeader::decode(&frame).unwrap();
        assert_eq!(header.msg_type, MSG_AUDIO_ONLY_REQUEST);
        assert_eq!(header.msg_flags, FLAG_NEG_SEQUENCE);
        assert!(header.is_last_package());
    }

    #[test]
    fn test_parse_server_response_valid() {
        // 构造一个模拟的 v3 服务端响应
        let response = AsrResponse {
            code: Some(1000),
            message: Some("success".to_string()),
            result: Some(AsrResult {
                text: Some("你好世界".to_string()),
                utterances: Some(vec![AsrUtterance {
                    text: Some("你好世界".to_string()),
                    start_time: Some(0),
                    end_time: Some(1500),
                    definite: Some(true),
                }]),
            }),
            audio_info: Some(AsrAudioInfoResponse {
                duration: Some(1500),
            }),
        };

        let payload = serde_json::to_vec(&response).unwrap();

        let header = ProtocolHeader {
            msg_type: MSG_FULL_SERVER_RESPONSE,
            msg_flags: FLAG_NO_SEQUENCE,
            serial_method: SERIAL_JSON,
            compression: COMPRESS_NONE,
            ..Default::default()
        };

        let mut frame = header.encode();
        frame.write_u32::<BigEndian>(payload.len() as u32).unwrap();
        frame.write_all(&payload).unwrap();

        let (parsed_header, parsed_response) = parse_server_response(&frame).unwrap();
        assert!(parsed_header.is_server_response());
        assert!(parsed_response.is_some());

        let resp = parsed_response.unwrap();
        assert_eq!(resp.code, Some(1000));
        let text = resp.result.unwrap().text.unwrap();
        assert_eq!(text, "你好世界");
    }

    #[test]
    fn test_parse_server_response_too_short() {
        let data = vec![0x11];
        let result = parse_server_response(&data);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_server_response_empty_payload() {
        let header = ProtocolHeader {
            msg_type: MSG_SERVER_ACK,
            ..Default::default()
        };
        let mut frame = header.encode();
        frame.write_u32::<BigEndian>(0).unwrap();

        let (parsed_header, parsed_response) = parse_server_response(&frame).unwrap();
        assert!(parsed_header.is_server_ack());
        assert!(parsed_response.is_none());
    }

    #[test]
    fn test_asr_response_deserialization() {
        let json = r#"{
            "code": 1000,
            "message": "ok",
            "result": {"text": "hello", "utterances": [{"text": "hello", "definite": true}]}
        }"#;
        let resp: AsrResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.code, Some(1000));
        assert_eq!(resp.result.unwrap().text, Some("hello".to_string()));
    }

    #[test]
    fn test_build_audio_request_empty() {
        let audio: Vec<u8> = vec![];
        let frame = build_audio_request(&audio, true).unwrap();
        let header = ProtocolHeader::decode(&frame).unwrap();
        assert_eq!(header.msg_type, MSG_AUDIO_ONLY_REQUEST);

        let mut cursor = Cursor::new(&frame[4..8]);
        let payload_size = cursor.read_u32::<BigEndian>().unwrap();
        assert_eq!(payload_size, 0);
    }
}
