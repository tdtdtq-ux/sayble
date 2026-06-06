use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelConfig {
    pub id: String,
    pub name: String,
    pub ssh_host: String,
    #[serde(default)]
    pub direction: TunnelDirection,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub auto_start: bool,
    pub auto_reconnect: bool,
    pub compression: bool,
    pub tcp_keep_alive: bool,
    pub server_alive_interval: u64,
    pub server_alive_count_max: u64,
    pub exit_on_forward_failure: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TunnelDirection {
    Local,
    Remote,
}

impl Default for TunnelDirection {
    fn default() -> Self {
        Self::Local
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TunnelRunState {
    Stopped,
    Starting,
    Running,
    Reconnecting,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatus {
    pub id: String,
    pub state: TunnelRunState,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
    pub last_error: Option<String>,
    pub reconnect_attempt: u32,
}

impl TunnelStatus {
    pub fn stopped(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            state: TunnelRunState::Stopped,
            pid: None,
            started_at: None,
            last_error: None,
            reconnect_attempt: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TunnelLogLevel {
    Info,
    Warn,
    Error,
    Success,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelLogEntry {
    pub id: String,
    pub tunnel_id: String,
    pub tunnel_name: String,
    pub level: TunnelLogLevel,
    pub message: String,
    pub timestamp: String,
}

#[cfg(test)]
mod tests {
    use super::{TunnelConfig, TunnelDirection};

    #[test]
    fn tunnel_direction_defaults_to_local_for_existing_configs() {
        let json = r#"{
            "id": "demo",
            "name": "Demo",
            "sshHost": "prod2",
            "localHost": "127.0.0.1",
            "localPort": 15900,
            "remoteHost": "127.0.0.1",
            "remotePort": 15900,
            "autoStart": false,
            "autoReconnect": true,
            "compression": false,
            "tcpKeepAlive": true,
            "serverAliveInterval": 60,
            "serverAliveCountMax": 3,
            "exitOnForwardFailure": true
        }"#;

        let config: TunnelConfig = serde_json::from_str(json).unwrap();

        assert_eq!(config.direction, TunnelDirection::Local);
    }
}
