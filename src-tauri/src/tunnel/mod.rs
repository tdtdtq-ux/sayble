mod config;
mod manager;
mod process;

pub use config::{TunnelConfig, TunnelLogEntry, TunnelLogLevel, TunnelRunState, TunnelStatus};
pub use manager::TunnelManager;

#[tauri::command]
pub fn cmd_list_tunnels(
    manager: tauri::State<'_, std::sync::Arc<TunnelManager>>,
) -> Result<Vec<TunnelConfig>, String> {
    Ok(manager.list_tunnels())
}

#[tauri::command]
pub fn cmd_save_tunnel(
    manager: tauri::State<'_, std::sync::Arc<TunnelManager>>,
    config: TunnelConfig,
) -> Result<TunnelConfig, String> {
    manager.save_tunnel(config)
}

#[tauri::command]
pub fn cmd_delete_tunnel(
    manager: tauri::State<'_, std::sync::Arc<TunnelManager>>,
    id: String,
) -> Result<(), String> {
    manager.delete_tunnel(&id)
}

#[tauri::command]
pub fn cmd_start_tunnel(
    manager: tauri::State<'_, std::sync::Arc<TunnelManager>>,
    id: String,
) -> Result<(), String> {
    manager.start_tunnel(&id)
}

#[tauri::command]
pub fn cmd_stop_tunnel(
    manager: tauri::State<'_, std::sync::Arc<TunnelManager>>,
    id: String,
) -> Result<(), String> {
    manager.stop_tunnel(&id)
}

#[tauri::command]
pub fn cmd_restart_tunnel(
    manager: tauri::State<'_, std::sync::Arc<TunnelManager>>,
    id: String,
) -> Result<(), String> {
    manager.restart_tunnel(&id)
}

#[tauri::command]
pub fn cmd_get_tunnel_statuses(
    manager: tauri::State<'_, std::sync::Arc<TunnelManager>>,
) -> Result<Vec<TunnelStatus>, String> {
    Ok(manager.list_statuses())
}

#[tauri::command]
pub fn cmd_load_tunnel_logs(
    manager: tauri::State<'_, std::sync::Arc<TunnelManager>>,
    tunnel_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<TunnelLogEntry>, String> {
    manager.load_logs(tunnel_id.as_deref(), limit.unwrap_or(200))
}

#[tauri::command]
pub fn cmd_clear_tunnel_logs(
    manager: tauri::State<'_, std::sync::Arc<TunnelManager>>,
    tunnel_id: Option<String>,
) -> Result<(), String> {
    manager.clear_logs(tunnel_id.as_deref())
}
