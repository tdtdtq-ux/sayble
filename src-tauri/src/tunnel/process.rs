use std::process::{Child, Command, Stdio};

use super::config::TunnelConfig;

pub fn spawn_ssh_tunnel(config: &TunnelConfig) -> Result<Child, String> {
    let local_spec = if config.local_host.trim().is_empty() {
        format!(
            "{}:{}:{}",
            config.local_port, config.remote_host, config.remote_port
        )
    } else {
        format!(
            "{}:{}:{}:{}",
            config.local_host, config.local_port, config.remote_host, config.remote_port
        )
    };

    let mut command = Command::new("ssh");
    command
        .arg("-L")
        .arg(local_spec)
        .arg(&config.ssh_host)
        .arg("-N")
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
            if config.exit_on_forward_failure { "yes" } else { "no" }
        ))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    if config.compression {
        command.arg("-C");
    }

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
