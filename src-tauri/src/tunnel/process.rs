use std::process::{Child, Command, Stdio};

use super::config::{TunnelConfig, TunnelDirection};

pub fn spawn_ssh_tunnel(config: &TunnelConfig) -> Result<Child, String> {
    let forward_spec = build_forward_spec(config);

    let mut command = Command::new("ssh");
    command
        .arg("-N")
        .arg(forward_flag(config.direction))
        .arg(forward_spec)
        .arg("-o")
        .arg(format!(
            "TCPKeepAlive={}",
            if config.tcp_keep_alive { "yes" } else { "no" }
        ))
        .arg("-o")
        .arg(format!(
            "ServerAliveInterval={}",
            config.server_alive_interval
        ))
        .arg("-o")
        .arg(format!(
            "ServerAliveCountMax={}",
            config.server_alive_count_max
        ))
        .arg("-o")
        .arg(format!(
            "ExitOnForwardFailure={}",
            if config.exit_on_forward_failure {
                "yes"
            } else {
                "no"
            }
        ))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    if config.compression {
        command.arg("-C");
    }

    command.arg(&config.ssh_host);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command.spawn().map_err(|e| {
        format!(
            "启动 ssh 失败，请确认本机已安装 OpenSSH，并且 SSH 主机 {} 可用：{}",
            config.ssh_host, e
        )
    })
}

fn build_forward_spec(config: &TunnelConfig) -> String {
    if config.local_host.trim().is_empty() {
        format!(
            "{}:{}:{}",
            config.local_port, config.remote_host, config.remote_port
        )
    } else {
        format!(
            "{}:{}:{}:{}",
            config.local_host, config.local_port, config.remote_host, config.remote_port
        )
    }
}

fn forward_flag(direction: TunnelDirection) -> &'static str {
    match direction {
        TunnelDirection::Local => "-L",
        TunnelDirection::Remote => "-R",
    }
}

#[cfg(test)]
mod tests {
    use super::{build_forward_spec, forward_flag};
    use crate::tunnel::config::{TunnelConfig, TunnelDirection};

    fn config(direction: TunnelDirection) -> TunnelConfig {
        TunnelConfig {
            id: "demo".to_string(),
            name: "Demo".to_string(),
            ssh_host: "prod2".to_string(),
            direction,
            local_host: "127.0.0.1".to_string(),
            local_port: 15900,
            remote_host: "127.0.0.1".to_string(),
            remote_port: 15900,
            auto_start: false,
            auto_reconnect: true,
            compression: false,
            tcp_keep_alive: true,
            server_alive_interval: 60,
            server_alive_count_max: 3,
            exit_on_forward_failure: true,
        }
    }

    #[test]
    fn remote_direction_uses_reverse_forward_flag() {
        assert_eq!(forward_flag(TunnelDirection::Remote), "-R");
    }

    #[test]
    fn local_direction_uses_local_forward_flag() {
        assert_eq!(forward_flag(TunnelDirection::Local), "-L");
    }

    #[test]
    fn builds_forward_spec_with_bind_host() {
        assert_eq!(
            build_forward_spec(&config(TunnelDirection::Remote)),
            "127.0.0.1:15900:127.0.0.1:15900"
        );
    }
}
