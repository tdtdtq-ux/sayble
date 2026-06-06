use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::Child,
    sync::{Arc, Mutex},
    time::Duration,
};

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

use crate::store;

use super::{
    config::{TunnelConfig, TunnelLogEntry, TunnelLogLevel, TunnelRunState, TunnelStatus},
    process::spawn_ssh_tunnel,
};

const CONFIG_FILE: &str = "tunnels.json";
const LOG_FILE: &str = "tunnel_logs.json";
const MAX_LOGS: usize = 800;

type ChildHandle = Arc<Mutex<Child>>;

pub struct TunnelManager {
    app: AppHandle,
    config_path: PathBuf,
    log_path: PathBuf,
    configs: Mutex<Vec<TunnelConfig>>,
    statuses: Mutex<HashMap<String, TunnelStatus>>,
    children: Mutex<HashMap<String, ChildHandle>>,
    desired_running: Mutex<HashSet<String>>,
    log_lock: Mutex<()>,
}

impl TunnelManager {
    pub fn init(app: AppHandle) -> Result<Arc<Self>, String> {
        let base = store::base_dir();
        fs::create_dir_all(&base).map_err(|e| format!("创建隧道数据目录失败: {}", e))?;
        let config_path = base.join(CONFIG_FILE);
        let log_path = base.join(LOG_FILE);
        let configs = read_configs(&config_path)?;

        Ok(Arc::new(Self {
            app,
            config_path,
            log_path,
            configs: Mutex::new(configs),
            statuses: Mutex::new(HashMap::new()),
            children: Mutex::new(HashMap::new()),
            desired_running: Mutex::new(HashSet::new()),
            log_lock: Mutex::new(()),
        }))
    }

    pub fn start_autostart_tunnels(self: &Arc<Self>) {
        for config in self.list_tunnels().into_iter().filter(|c| c.auto_start) {
            if let Err(e) = self.start_tunnel(&config.id) {
                self.append_log(
                    &config.id,
                    &config.name,
                    TunnelLogLevel::Error,
                    format!("自动启动失败: {}", e),
                );
            }
        }
    }

    pub fn list_tunnels(&self) -> Vec<TunnelConfig> {
        self.configs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn save_tunnel(&self, mut config: TunnelConfig) -> Result<TunnelConfig, String> {
        normalize_config(&mut config);
        validate_config(&config)?;

        let mut configs = self.configs.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(existing) = configs.iter_mut().find(|item| item.id == config.id) {
            *existing = config.clone();
        } else {
            configs.insert(0, config.clone());
        }
        write_json(&self.config_path, &*configs)?;
        self.append_log(&config.id, &config.name, TunnelLogLevel::Info, "配置已保存");
        Ok(config)
    }

    pub fn delete_tunnel(&self, id: &str) -> Result<(), String> {
        let config = self.get_config(id);
        self.stop_tunnel(id)?;

        let mut configs = self.configs.lock().unwrap_or_else(|e| e.into_inner());
        configs.retain(|item| item.id != id);
        write_json(&self.config_path, &*configs)?;

        self.statuses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);

        if let Some(config) = config {
            self.append_log(&config.id, &config.name, TunnelLogLevel::Info, "配置已删除");
        }
        let _ = self.app.emit(
            "tunnel-event",
            serde_json::json!({
                "kind": "deleted",
                "tunnelId": id,
            }),
        );
        Ok(())
    }

    pub fn start_tunnel(self: &Arc<Self>, id: &str) -> Result<(), String> {
        self.start_tunnel_inner(id, false)
    }

    pub fn stop_tunnel(&self, id: &str) -> Result<(), String> {
        self.desired_running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);

        let child = self
            .children
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);

        if let Some(child) = child {
            let mut child = child.lock().unwrap_or_else(|e| e.into_inner());
            if let Err(e) = child.kill() {
                log::warn!("[tunnel] failed to kill {}: {}", id, e);
            }
            let _ = child.wait();
        }

        let config = self.get_config(id);
        let name = config
            .as_ref()
            .map(|c| c.name.as_str())
            .unwrap_or("SSH 隧道");
        self.set_status(TunnelStatus::stopped(id));
        self.append_log(id, name, TunnelLogLevel::Info, "已停止");
        Ok(())
    }

    pub fn restart_tunnel(self: &Arc<Self>, id: &str) -> Result<(), String> {
        self.stop_tunnel(id)?;
        std::thread::sleep(Duration::from_millis(350));
        self.start_tunnel(id)
    }

    pub fn stop_all(&self) {
        self.desired_running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        let children: Vec<(String, ChildHandle)> = self
            .children
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain()
            .collect();
        for (id, child) in children {
            if let Ok(mut child) = child.lock() {
                if let Err(e) = child.kill() {
                    log::warn!("[tunnel] stop_all failed to kill {}: {}", id, e);
                }
                let _ = child.wait();
            }
        }
    }

    pub fn list_statuses(&self) -> Vec<TunnelStatus> {
        let statuses = self.statuses.lock().unwrap_or_else(|e| e.into_inner());
        self.list_tunnels()
            .into_iter()
            .map(|config| {
                statuses
                    .get(&config.id)
                    .cloned()
                    .unwrap_or_else(|| TunnelStatus::stopped(config.id))
            })
            .collect()
    }

    pub fn load_logs(
        &self,
        tunnel_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<TunnelLogEntry>, String> {
        let _guard = self.log_lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut logs = read_logs(&self.log_path)?;
        if let Some(tunnel_id) = tunnel_id {
            logs.retain(|entry| entry.tunnel_id == tunnel_id);
        }
        logs.reverse();
        logs.truncate(limit.min(MAX_LOGS));
        Ok(logs)
    }

    pub fn clear_logs(&self, tunnel_id: Option<&str>) -> Result<(), String> {
        let _guard = self.log_lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut logs = read_logs(&self.log_path)?;
        if let Some(tunnel_id) = tunnel_id {
            logs.retain(|entry| entry.tunnel_id != tunnel_id);
        } else {
            logs.clear();
        }
        write_json(&self.log_path, &logs)?;
        let _ = self.app.emit(
            "tunnel-event",
            serde_json::json!({
                "kind": "logsCleared",
                "tunnelId": tunnel_id,
            }),
        );
        Ok(())
    }

    fn start_tunnel_inner(self: &Arc<Self>, id: &str, reconnecting: bool) -> Result<(), String> {
        let config = self
            .get_config(id)
            .ok_or_else(|| "隧道配置不存在".to_string())?;
        validate_config(&config)?;

        let mut children = self.children.lock().unwrap_or_else(|e| e.into_inner());
        if children.contains_key(id) {
            return Ok(());
        }

        self.desired_running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.to_string());

        let current_attempt = self
            .statuses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .map(|s| s.reconnect_attempt)
            .unwrap_or(0);

        self.set_status(TunnelStatus {
            id: id.to_string(),
            state: if reconnecting {
                TunnelRunState::Reconnecting
            } else {
                TunnelRunState::Starting
            },
            pid: None,
            started_at: None,
            last_error: None,
            reconnect_attempt: if reconnecting { current_attempt } else { 0 },
        });

        self.append_log(
            id,
            &config.name,
            TunnelLogLevel::Info,
            if reconnecting {
                "正在重连 SSH 隧道"
            } else {
                "正在启动 SSH 隧道"
            },
        );

        let mut child = match spawn_ssh_tunnel(&config) {
            Ok(child) => child,
            Err(e) => {
                self.set_failed(id, Some(e.clone()));
                self.append_log(id, &config.name, TunnelLogLevel::Error, e.clone());
                return Err(e);
            }
        };

        let stderr = child.stderr.take();
        let pid = child.id();
        let child = Arc::new(Mutex::new(child));
        children.insert(id.to_string(), child.clone());
        drop(children);

        if let Some(stderr) = stderr {
            self.spawn_stderr_reader(config.clone(), stderr);
        }
        self.spawn_watcher(config, child, pid, reconnecting);
        Ok(())
    }

    fn spawn_stderr_reader(
        self: &Arc<Self>,
        config: TunnelConfig,
        stderr: std::process::ChildStderr,
    ) {
        let manager = Arc::clone(self);
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let line = line.trim();
                if !line.is_empty() {
                    manager.append_log(
                        &config.id,
                        &config.name,
                        TunnelLogLevel::Warn,
                        format!("ssh: {}", line),
                    );
                }
            }
        });
    }

    fn spawn_watcher(
        self: &Arc<Self>,
        config: TunnelConfig,
        child: ChildHandle,
        pid: u32,
        reconnecting: bool,
    ) {
        let manager = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut marked_running = false;
            let started_at = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
            let started = std::time::Instant::now();

            loop {
                let exit_status = {
                    let mut child = child.lock().unwrap_or_else(|e| e.into_inner());
                    child.try_wait()
                };

                match exit_status {
                    Ok(Some(status)) => {
                        if !manager.remove_child_if_current(&config.id, &child) {
                            break;
                        }

                        let message = match status.code() {
                            Some(code) => format!("SSH 进程已退出，退出码 {}", code),
                            None => "SSH 进程已退出".to_string(),
                        };
                        manager.handle_process_exit(config.clone(), message).await;
                        break;
                    }
                    Ok(None) => {
                        if !marked_running && started.elapsed() >= Duration::from_secs(1) {
                            marked_running = true;
                            manager.set_status(TunnelStatus {
                                id: config.id.clone(),
                                state: TunnelRunState::Running,
                                pid: Some(pid),
                                started_at: Some(started_at.clone()),
                                last_error: None,
                                reconnect_attempt: 0,
                            });
                            manager.append_log(
                                &config.id,
                                &config.name,
                                TunnelLogLevel::Success,
                                if reconnecting {
                                    "重连成功"
                                } else {
                                    "隧道已连接"
                                },
                            );
                            if reconnecting {
                                manager.notify(
                                    "SSH 隧道重连成功",
                                    &format!("{} 已恢复连接", config.name),
                                    "success",
                                );
                            }
                        }
                    }
                    Err(e) => {
                        if !manager.remove_child_if_current(&config.id, &child) {
                            break;
                        }
                        manager
                            .handle_process_exit(
                                config.clone(),
                                format!("读取 SSH 状态失败: {}", e),
                            )
                            .await;
                        break;
                    }
                }

                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        });
    }

    async fn handle_process_exit(self: &Arc<Self>, config: TunnelConfig, message: String) {
        let desired = self
            .desired_running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains(&config.id);

        if !desired {
            self.set_status(TunnelStatus::stopped(&config.id));
            return;
        }

        if !config.auto_reconnect {
            self.set_failed(&config.id, Some(message.clone()));
            self.append_log(&config.id, &config.name, TunnelLogLevel::Error, message);
            self.notify(
                "SSH 隧道已断开",
                &format!("{} 已断开，自动重连未开启", config.name),
                "error",
            );
            return;
        }

        let mut attempt = self
            .statuses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&config.id)
            .map(|s| s.reconnect_attempt)
            .unwrap_or(0)
            + 1;

        self.notify(
            "SSH 隧道已断开",
            &format!("{} 已断开，正在自动重连", config.name),
            "warn",
        );

        loop {
            let delay_secs = (attempt as u64 * 2).clamp(2, 30);
            self.set_status(TunnelStatus {
                id: config.id.clone(),
                state: TunnelRunState::Reconnecting,
                pid: None,
                started_at: None,
                last_error: Some(message.clone()),
                reconnect_attempt: attempt,
            });
            self.append_log(
                &config.id,
                &config.name,
                TunnelLogLevel::Warn,
                format!("{}，{} 秒后第 {} 次重连", message, delay_secs, attempt),
            );

            tokio::time::sleep(Duration::from_secs(delay_secs)).await;

            let still_desired = self
                .desired_running
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .contains(&config.id);
            if !still_desired {
                self.set_status(TunnelStatus::stopped(&config.id));
                break;
            }

            match self.start_tunnel_inner(&config.id, true) {
                Ok(()) => break,
                Err(e) => {
                    attempt += 1;
                    self.set_status(TunnelStatus {
                        id: config.id.clone(),
                        state: TunnelRunState::Reconnecting,
                        pid: None,
                        started_at: None,
                        last_error: Some(e.clone()),
                        reconnect_attempt: attempt,
                    });
                    self.append_log(
                        &config.id,
                        &config.name,
                        TunnelLogLevel::Error,
                        format!("重连启动失败: {}", e),
                    );
                }
            }
        }
    }

    fn get_config(&self, id: &str) -> Option<TunnelConfig> {
        self.configs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|item| item.id == id)
            .cloned()
    }

    fn remove_child_if_current(&self, id: &str, child: &ChildHandle) -> bool {
        let mut children = self.children.lock().unwrap_or_else(|e| e.into_inner());
        let is_current = children
            .get(id)
            .map(|current| Arc::ptr_eq(current, child))
            .unwrap_or(false);
        if is_current {
            children.remove(id);
        }
        is_current
    }

    fn set_failed(&self, id: &str, error: Option<String>) {
        let reconnect_attempt = self
            .statuses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .map(|s| s.reconnect_attempt)
            .unwrap_or(0);
        self.set_status(TunnelStatus {
            id: id.to_string(),
            state: TunnelRunState::Failed,
            pid: None,
            started_at: None,
            last_error: error,
            reconnect_attempt,
        });
    }

    fn set_status(&self, status: TunnelStatus) {
        self.statuses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(status.id.clone(), status.clone());
        let _ = self.app.emit(
            "tunnel-event",
            serde_json::json!({
                "kind": "status",
                "tunnelId": status.id,
                "status": status,
            }),
        );
    }

    fn append_log(
        &self,
        tunnel_id: &str,
        tunnel_name: &str,
        level: TunnelLogLevel,
        message: impl Into<String>,
    ) {
        let entry = TunnelLogEntry {
            id: Uuid::new_v4().to_string(),
            tunnel_id: tunnel_id.to_string(),
            tunnel_name: tunnel_name.to_string(),
            level,
            message: message.into(),
            timestamp: chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
        };

        match entry.level {
            TunnelLogLevel::Info | TunnelLogLevel::Success => {
                log::info!("[tunnel] {}: {}", entry.tunnel_name, entry.message)
            }
            TunnelLogLevel::Warn => log::warn!("[tunnel] {}: {}", entry.tunnel_name, entry.message),
            TunnelLogLevel::Error => {
                log::error!("[tunnel] {}: {}", entry.tunnel_name, entry.message)
            }
        }

        let save_result = (|| -> Result<(), String> {
            let _guard = self.log_lock.lock().unwrap_or_else(|e| e.into_inner());
            let mut logs = read_logs(&self.log_path)?;
            logs.push(entry.clone());
            if logs.len() > MAX_LOGS {
                let drop_count = logs.len() - MAX_LOGS;
                logs.drain(0..drop_count);
            }
            write_json(&self.log_path, &logs)
        })();

        if let Err(e) = save_result {
            log::error!("[tunnel] failed to save log: {}", e);
        }

        let _ = self.app.emit(
            "tunnel-event",
            serde_json::json!({
                "kind": "log",
                "tunnelId": entry.tunnel_id,
                "log": entry,
            }),
        );
    }

    fn notify(&self, title: &str, body: &str, level: &str) {
        let _ = self.app.emit(
            "tunnel-notification",
            serde_json::json!({
                "title": title,
                "body": body,
                "level": level,
            }),
        );

        if let Err(e) = self
            .app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
        {
            log::warn!("[tunnel] failed to show notification: {}", e);
        }
    }
}

impl Drop for TunnelManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}

fn normalize_config(config: &mut TunnelConfig) {
    config.name = config.name.trim().to_string();
    config.ssh_host = config.ssh_host.trim().to_string();
    config.local_host = config.local_host.trim().to_string();
    config.remote_host = config.remote_host.trim().to_string();
    if config.local_host.is_empty() {
        config.local_host = "127.0.0.1".to_string();
    }
    if config.server_alive_interval == 0 {
        config.server_alive_interval = 60;
    }
    if config.server_alive_count_max == 0 {
        config.server_alive_count_max = 3;
    }
}

fn validate_config(config: &TunnelConfig) -> Result<(), String> {
    if config.id.trim().is_empty() {
        return Err("缺少隧道 ID".to_string());
    }
    if config.name.trim().is_empty() {
        return Err("请填写隧道名称".to_string());
    }
    if config.ssh_host.trim().is_empty() {
        return Err("请填写 SSH 主机".to_string());
    }
    if config.remote_host.trim().is_empty() {
        return Err("请填写远程主机".to_string());
    }
    if config.local_port == 0 || config.remote_port == 0 {
        return Err("端口必须在 1-65535 之间".to_string());
    }
    Ok(())
}

fn read_configs(path: &PathBuf) -> Result<Vec<TunnelConfig>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("读取隧道配置失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析隧道配置失败: {}", e))
}

fn read_logs(path: &PathBuf) -> Result<Vec<TunnelLogEntry>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("读取隧道日志失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析隧道日志失败: {}", e))
}

fn write_json<T: serde::Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(value).map_err(|e| format!("序列化隧道数据失败: {}", e))?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, json).map_err(|e| format!("写入 {} 失败: {}", tmp_path.display(), e))?;
    fs::rename(&tmp_path, path).map_err(|e| format!("保存 {} 失败: {}", path.display(), e))?;
    Ok(())
}
