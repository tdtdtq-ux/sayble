use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, BufRead, BufReader, Write},
    net::{IpAddr, Ipv4Addr, TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use uuid::Uuid;

use crate::store;

const SHARE_FILE: &str = "share_files.json";
const SHARE_SETTINGS_FILE: &str = "share_settings.json";
const DEFAULT_PORT: u16 = 17321;
const MAX_FILES: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFile {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub size: u64,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareHostCandidate {
    pub name: String,
    pub address: String,
    pub url: String,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareServerState {
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub base_url: String,
    pub hosts: Vec<ShareHostCandidate>,
    pub last_error: Option<String>,
    pub files: Vec<SharedFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShareSettings {
    #[serde(default)]
    selected_host: Option<String>,
    #[serde(default = "default_share_port")]
    port: u16,
}

impl Default for ShareSettings {
    fn default() -> Self {
        Self {
            selected_host: None,
            port: DEFAULT_PORT,
        }
    }
}

fn default_share_port() -> u16 {
    DEFAULT_PORT
}

struct ShareServerHandle {
    port: u16,
    stop: Arc<AtomicBool>,
}

pub struct ShareManager {
    data_path: PathBuf,
    settings_path: PathBuf,
    configured_port: Mutex<u16>,
    selected_host: Mutex<String>,
    last_error: Mutex<Option<String>>,
    server: Mutex<Option<ShareServerHandle>>,
    files: Mutex<Vec<SharedFile>>,
}

impl ShareManager {
    pub fn init() -> Result<Arc<Self>, String> {
        let base = store::base_dir();
        fs::create_dir_all(&base).map_err(|e| format!("创建共享数据目录失败: {}", e))?;
        let data_path = base.join(SHARE_FILE);
        let settings_path = base.join(SHARE_SETTINGS_FILE);
        let files = read_files(&data_path)?;
        let settings = read_settings(&settings_path)?;
        let port = normalize_port(settings.port)?;
        let candidates = host_candidates(port, "");
        let selected_host = choose_host(settings.selected_host.as_deref(), &candidates);

        let manager = Arc::new(Self {
            data_path,
            settings_path,
            configured_port: Mutex::new(port),
            selected_host: Mutex::new(selected_host),
            last_error: Mutex::new(None),
            server: Mutex::new(None),
            files: Mutex::new(files),
        });

        log::info!("[share] server initialized, default stopped");
        Ok(manager)
    }

    pub fn state(&self) -> ShareServerState {
        let running_port = self
            .server
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|server| server.port);
        let running = running_port.is_some();
        let port = running_port.unwrap_or_else(|| {
            *self
                .configured_port
                .lock()
                .unwrap_or_else(|e| e.into_inner())
        });

        let mut candidates = host_candidates(port, "");
        let host = {
            let mut selected = self.selected_host.lock().unwrap_or_else(|e| e.into_inner());
            if !candidates.iter().any(|item| item.address == *selected) {
                *selected = choose_host(None, &candidates);
            }
            selected.clone()
        };
        candidates = host_candidates(port, &host);

        ShareServerState {
            running,
            host: host.clone(),
            port,
            base_url: if running {
                format!("http://{}:{}", host, port)
            } else {
                String::new()
            },
            hosts: candidates,
            last_error: self
                .last_error
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            files: self.files.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        }
    }

    pub fn start_server(self: &Arc<Self>, port: u16) -> Result<ShareServerState, String> {
        let port = normalize_port(port)?;

        {
            let server = self.server.lock().unwrap_or_else(|e| e.into_inner());
            if server.is_some() {
                return Err("共享服务已经在运行，请先停止后再修改端口".to_string());
            }
        }

        let listener = TcpListener::bind(("0.0.0.0", port)).map_err(|e| bind_error(port, e))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("设置共享服务监听模式失败: {}", e))?;

        let stop = Arc::new(AtomicBool::new(false));
        self.start_http_server(listener, Arc::clone(&stop));

        {
            let mut configured = self
                .configured_port
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *configured = port;
        }
        {
            let mut server = self.server.lock().unwrap_or_else(|e| e.into_inner());
            *server = Some(ShareServerHandle { port, stop });
        }
        {
            let mut last_error = self.last_error.lock().unwrap_or_else(|e| e.into_inner());
            *last_error = None;
        }
        self.save_settings()?;

        let state = self.state();
        log::info!("[share] server started at {}", state.base_url);
        Ok(state)
    }

    pub fn stop_server(&self) -> Result<ShareServerState, String> {
        let server = self.server.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(server) = server {
            server.stop.store(true, Ordering::SeqCst);
            log::info!("[share] server stopped");
        }
        Ok(self.state())
    }

    pub fn set_host(&self, address: String) -> Result<ShareServerState, String> {
        let address = address.trim().to_string();
        let port = self.state().port;
        let candidates = host_candidates(port, "");
        if !candidates.iter().any(|item| item.address == address) {
            return Err("这个 IP 当前不可用，请换一个本机网卡地址".to_string());
        }

        {
            let mut selected = self.selected_host.lock().unwrap_or_else(|e| e.into_inner());
            *selected = address;
        }
        self.save_settings()?;
        Ok(self.state())
    }

    pub fn add_file(&self, path: String) -> Result<ShareServerState, String> {
        let path = PathBuf::from(path);
        let path = path
            .canonicalize()
            .map_err(|e| format!("读取文件路径失败: {}", e))?;
        let path = normalize_path(path);
        let metadata = fs::metadata(&path).map_err(|e| format!("读取文件信息失败: {}", e))?;
        if !metadata.is_file() {
            return Err("只能共享文件，不能共享文件夹".to_string());
        }

        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("download")
            .to_string();

        let mut files = self.files.lock().unwrap_or_else(|e| e.into_inner());
        files.retain(|item| item.path != path);
        files.insert(
            0,
            SharedFile {
                id: Uuid::new_v4().to_string(),
                name,
                path,
                size: metadata.len(),
                added_at: chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
            },
        );
        if files.len() > MAX_FILES {
            files.truncate(MAX_FILES);
        }
        write_json(&self.data_path, &*files)?;
        drop(files);

        Ok(self.state())
    }

    pub fn remove_file(&self, id: String) -> Result<ShareServerState, String> {
        let mut files = self.files.lock().unwrap_or_else(|e| e.into_inner());
        files.retain(|item| item.id != id);
        write_json(&self.data_path, &*files)?;
        drop(files);
        Ok(self.state())
    }

    pub fn clear_files(&self) -> Result<ShareServerState, String> {
        let mut files = self.files.lock().unwrap_or_else(|e| e.into_inner());
        files.clear();
        write_json(&self.data_path, &*files)?;
        drop(files);
        Ok(self.state())
    }

    fn save_settings(&self) -> Result<(), String> {
        let settings = ShareSettings {
            selected_host: Some(
                self.selected_host
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone(),
            ),
            port: *self
                .configured_port
                .lock()
                .unwrap_or_else(|e| e.into_inner()),
        };
        write_json(&self.settings_path, &settings)
    }

    fn start_http_server(self: &Arc<Self>, listener: TcpListener, stop: Arc<AtomicBool>) {
        let manager = Arc::clone(self);
        thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _addr)) => {
                        let manager = Arc::clone(&manager);
                        thread::spawn(move || {
                            if let Err(e) = manager.handle_connection(stream) {
                                log::warn!("[share] request failed: {}", e);
                            }
                        });
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(100));
                    }
                    Err(e) => {
                        log::warn!("[share] incoming connection failed: {}", e);
                        thread::sleep(Duration::from_millis(200));
                    }
                }
            }
            log::debug!("[share] server thread exited");
        });
    }

    fn handle_connection(&self, mut stream: TcpStream) -> io::Result<()> {
        let mut request_line = String::new();
        {
            let mut reader = BufReader::new(&mut stream);
            reader.read_line(&mut request_line)?;
            loop {
                let mut line = String::new();
                let bytes = reader.read_line(&mut line)?;
                if bytes == 0 || line == "\r\n" || line == "\n" {
                    break;
                }
            }
        }

        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("");
        let target = parts.next().unwrap_or("/");
        let path = target.split('?').next().unwrap_or("/");
        let is_head = method.eq_ignore_ascii_case("HEAD");

        if !method.eq_ignore_ascii_case("GET") && !is_head {
            return write_text_response(
                &mut stream,
                405,
                "Method Not Allowed",
                "text/plain; charset=utf-8",
                "Method Not Allowed",
                is_head,
            );
        }

        match path {
            "/" | "/index.html" => write_text_response(
                &mut stream,
                200,
                "OK",
                "text/html; charset=utf-8",
                &self.render_index_html(),
                is_head,
            ),
            "/api/files" => {
                let body =
                    serde_json::to_string(&self.state()).unwrap_or_else(|_| "{}".to_string());
                write_text_response(
                    &mut stream,
                    200,
                    "OK",
                    "application/json; charset=utf-8",
                    &body,
                    is_head,
                )
            }
            _ if path.starts_with("/download/") => {
                let id = percent_decode(&path["/download/".len()..]);
                self.write_download(&mut stream, &id, is_head)
            }
            "/favicon.ico" => write_response(
                &mut stream,
                204,
                "No Content",
                &[("Content-Length", "0".to_string())],
                None,
            ),
            _ => write_text_response(
                &mut stream,
                404,
                "Not Found",
                "text/plain; charset=utf-8",
                "Not Found",
                is_head,
            ),
        }
    }

    fn write_download(&self, stream: &mut TcpStream, id: &str, is_head: bool) -> io::Result<()> {
        let entry = {
            let files = self.files.lock().unwrap_or_else(|e| e.into_inner());
            files.iter().find(|item| item.id == id).cloned()
        };

        let Some(entry) = entry else {
            return write_text_response(
                stream,
                404,
                "Not Found",
                "text/plain; charset=utf-8",
                "文件不存在",
                is_head,
            );
        };

        let metadata = match fs::metadata(&entry.path) {
            Ok(metadata) if metadata.is_file() => metadata,
            _ => {
                return write_text_response(
                    stream,
                    404,
                    "Not Found",
                    "text/plain; charset=utf-8",
                    "文件不存在",
                    is_head,
                )
            }
        };

        let headers = [
            ("Content-Type", content_type(&entry.name).to_string()),
            ("Content-Length", metadata.len().to_string()),
            (
                "Content-Disposition",
                format!(
                    "attachment; filename=\"{}\"; filename*=UTF-8''{}",
                    ascii_filename(&entry.name),
                    percent_encode(&entry.name)
                ),
            ),
            ("Cache-Control", "no-store".to_string()),
        ];
        write_response(stream, 200, "OK", &headers, None)?;
        if !is_head {
            let mut file = File::open(&entry.path)?;
            io::copy(&mut file, stream)?;
        }
        Ok(())
    }

    fn render_index_html(&self) -> String {
        let title = "Sayble 共享";
        format!(
            r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title}</title>
<style>
:root {{ color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
body {{ margin: 0; background: #f7f7f7; color: #161616; }}
main {{ max-width: 680px; margin: 0 auto; padding: 28px 18px; }}
h1 {{ margin: 0; font-size: 24px; }}
.sub {{ margin: 8px 0 22px; color: #666; font-size: 14px; }}
.file {{ display: flex; align-items: center; justify-content: space-between; gap: 14px; border: 1px solid #e4e4e4; background: #fff; border-radius: 10px; padding: 14px; margin-bottom: 10px; }}
.name {{ font-weight: 650; word-break: break-all; }}
.meta {{ margin-top: 5px; color: #777; font-size: 12px; }}
a {{ border-radius: 8px; background: #171717; color: #fff; padding: 9px 12px; text-decoration: none; white-space: nowrap; font-size: 14px; }}
.empty {{ border: 1px dashed #cfcfcf; border-radius: 10px; padding: 28px 16px; text-align: center; color: #777; background: #fff; }}
.chrome-warning[hidden] {{ display: none; }}
.chrome-warning {{ position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(22, 22, 22, 0.5); }}
.chrome-warning-card {{ width: min(100%, 380px); border-radius: 14px; background: #fff; padding: 20px; box-shadow: 0 18px 46px rgba(0, 0, 0, 0.24); }}
.chrome-warning-title {{ margin: 0; font-size: 19px; font-weight: 750; }}
.chrome-warning-text {{ margin: 10px 0 18px; color: #555; font-size: 14px; line-height: 1.65; }}
.chrome-warning-actions {{ display: flex; gap: 10px; justify-content: flex-end; }}
.chrome-warning button {{ border: 0; border-radius: 8px; padding: 10px 12px; font-size: 14px; font-weight: 650; }}
.chrome-warning .secondary {{ background: #efefef; color: #222; }}
.chrome-warning .primary {{ background: #171717; color: #fff; }}
</style>
</head>
<body>
<main>
<h1>{title}</h1>
<p class="sub">来自桌面端的临时共享文件</p>
<div id="files" class="empty">暂无共享文件</div>
</main>
<div id="chrome-warning" class="chrome-warning" role="dialog" aria-modal="true" aria-labelledby="chrome-warning-title" hidden>
  <div class="chrome-warning-card">
    <h2 id="chrome-warning-title" class="chrome-warning-title">请更换浏览器下载</h2>
    <p class="chrome-warning-text">检测到你正在使用 Chrome。Chrome 经常会拦截 APK、EXE 或包含安装包的 ZIP 下载。为了顺利下载测试包，请复制当前链接，换用手机自带浏览器、Firefox 或下载器打开。</p>
    <div class="chrome-warning-actions">
      <button id="chrome-warning-copy" class="secondary" type="button">复制链接</button>
      <button id="chrome-warning-close" class="primary" type="button">知道了</button>
    </div>
  </div>
</div>
<script>
const isChromeBrowser = () => {{
  const ua = navigator.userAgent || "";
  const vendor = navigator.vendor || "";
  const isChrome = ua.includes("Chrome/") && (vendor === "" || vendor.includes("Google"));
  const isCriOS = ua.includes("CriOS/");
  const isOtherChromium = /Edg|OPR|Opera|SamsungBrowser|UCBrowser|QQBrowser|MiuiBrowser|HuaweiBrowser/i.test(ua);
  return (isChrome || isCriOS) && !isOtherChromium;
}};
const showChromeWarning = () => {{
  if (!isChromeBrowser()) return;
  const warning = document.getElementById("chrome-warning");
  const close = document.getElementById("chrome-warning-close");
  const copy = document.getElementById("chrome-warning-copy");
  if (!warning || !close || !copy) return;
  warning.hidden = false;
  close.addEventListener("click", () => {{
    warning.hidden = true;
  }});
  copy.addEventListener("click", async () => {{
    try {{
      if (navigator.clipboard && window.isSecureContext) {{
        await navigator.clipboard.writeText(window.location.href);
      }} else {{
        const input = document.createElement("textarea");
        input.value = window.location.href;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }}
      copy.textContent = "已复制";
    }} catch (e) {{
      copy.textContent = "请长按地址复制";
    }}
  }});
}};
const formatSize = (size) => {{
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  if (size < 1024 * 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + " MB";
  return (size / 1024 / 1024 / 1024).toFixed(2) + " GB";
}};
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({{
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}}[ch]));
async function load() {{
  const el = document.getElementById("files");
  try {{
    const state = await fetch("/api/files", {{ cache: "no-store" }}).then((r) => r.json());
    if (!state.files || state.files.length === 0) {{
      el.className = "empty";
      el.textContent = "暂无共享文件";
      return;
    }}
    el.className = "";
    el.innerHTML = state.files.map((file) => `
      <div class="file">
        <div>
          <div class="name">${{escapeHtml(file.name)}}</div>
          <div class="meta">${{formatSize(file.size)}}</div>
        </div>
        <a href="/download/${{encodeURIComponent(file.id)}}">下载</a>
      </div>
    `).join("");
  }} catch (e) {{
    el.className = "empty";
    el.textContent = "加载失败，请确认电脑和手机在同一网络";
  }}
}}
showChromeWarning();
load();
</script>
</body>
</html>"#
        )
    }
}

#[tauri::command]
pub fn cmd_get_share_state(
    manager: tauri::State<'_, Arc<ShareManager>>,
) -> Result<ShareServerState, String> {
    Ok(manager.state())
}

#[tauri::command]
pub fn cmd_start_share_server(
    manager: tauri::State<'_, Arc<ShareManager>>,
    port: u16,
) -> Result<ShareServerState, String> {
    match manager.start_server(port) {
        Ok(state) => Ok(state),
        Err(e) => {
            *manager
                .last_error
                .lock()
                .unwrap_or_else(|lock| lock.into_inner()) = Some(e.clone());
            Err(e)
        }
    }
}

#[tauri::command]
pub fn cmd_stop_share_server(
    manager: tauri::State<'_, Arc<ShareManager>>,
) -> Result<ShareServerState, String> {
    manager.stop_server()
}

#[tauri::command]
pub fn cmd_set_share_host(
    manager: tauri::State<'_, Arc<ShareManager>>,
    address: String,
) -> Result<ShareServerState, String> {
    manager.set_host(address)
}

#[tauri::command]
pub fn cmd_add_share_file(
    manager: tauri::State<'_, Arc<ShareManager>>,
    path: String,
) -> Result<ShareServerState, String> {
    manager.add_file(path)
}

#[tauri::command]
pub fn cmd_remove_share_file(
    manager: tauri::State<'_, Arc<ShareManager>>,
    id: String,
) -> Result<ShareServerState, String> {
    manager.remove_file(id)
}

#[tauri::command]
pub fn cmd_clear_share_files(
    manager: tauri::State<'_, Arc<ShareManager>>,
) -> Result<ShareServerState, String> {
    manager.clear_files()
}

fn normalize_port(port: u16) -> Result<u16, String> {
    if port == 0 {
        Err("端口必须在 1-65535 之间".to_string())
    } else {
        Ok(port)
    }
}

fn bind_error(port: u16, error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::AddrInUse => format!("端口 {} 已被占用，请换一个端口", port),
        io::ErrorKind::PermissionDenied => {
            format!("没有权限监听端口 {}，请换一个大于 1024 的端口", port)
        }
        _ => format!("启动共享服务失败: {}", error),
    }
}

fn host_candidates(port: u16, selected_host: &str) -> Vec<ShareHostCandidate> {
    let mut seen = HashSet::new();
    let mut rows: Vec<(String, Ipv4Addr)> = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(name, ip)| match ip {
            IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some((name, ip)),
            _ => None,
        })
        .filter(|(_, ip)| seen.insert(*ip))
        .collect();

    rows.sort_by_key(|(name, ip)| (host_score(name, ip), ip.octets()));

    if rows.is_empty() {
        rows.push(("本机".to_string(), Ipv4Addr::LOCALHOST));
    }

    rows.into_iter()
        .map(|(name, ip)| {
            let address = ip.to_string();
            ShareHostCandidate {
                name,
                url: format!("http://{}:{}", address, port),
                selected: address == selected_host,
                address,
            }
        })
        .collect()
}

fn choose_host(preferred: Option<&str>, candidates: &[ShareHostCandidate]) -> String {
    if let Some(preferred) = preferred {
        if candidates.iter().any(|item| item.address == preferred) {
            return preferred.to_string();
        }
    }

    candidates
        .first()
        .map(|item| item.address.clone())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

fn host_score(name: &str, ip: &Ipv4Addr) -> u8 {
    let lower = name.to_ascii_lowercase();
    if lower.contains("tun")
        || lower.contains("tap")
        || lower.contains("vpn")
        || lower.contains("wintun")
        || lower.contains("wireguard")
        || lower.contains("tailscale")
        || lower.contains("zerotier")
        || lower.contains("clash")
        || lower.contains("mihomo")
    {
        return 20;
    }

    if lower.contains("wi-fi")
        || lower.contains("wifi")
        || lower.contains("wlan")
        || lower.contains("ethernet")
        || lower.contains("以太")
        || lower.contains("无线")
    {
        return 0;
    }

    if ip.is_private() {
        5
    } else {
        10
    }
}

fn read_files(path: &PathBuf) -> Result<Vec<SharedFile>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("读取共享列表失败: {}", e))?;
    let mut files: Vec<SharedFile> =
        serde_json::from_str(&content).map_err(|e| format!("解析共享列表失败: {}", e))?;
    files.retain(|item| item.path.is_file());
    Ok(files)
}

fn read_settings(path: &PathBuf) -> Result<ShareSettings, String> {
    if !path.exists() {
        return Ok(ShareSettings::default());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("读取共享设置失败: {}", e))?;
    let mut settings: ShareSettings =
        serde_json::from_str(&content).map_err(|e| format!("解析共享设置失败: {}", e))?;
    settings.port = normalize_port(settings.port).unwrap_or(DEFAULT_PORT);
    Ok(settings)
}

#[cfg(target_os = "windows")]
fn normalize_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", rest))
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

#[cfg(not(target_os = "windows"))]
fn normalize_path(path: PathBuf) -> PathBuf {
    path
}

fn write_json<T: serde::Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(value).map_err(|e| format!("序列化共享数据失败: {}", e))?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, json).map_err(|e| format!("写入 {} 失败: {}", tmp_path.display(), e))?;
    fs::rename(&tmp_path, path).map_err(|e| format!("保存 {} 失败: {}", path.display(), e))?;
    Ok(())
}

fn write_text_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &str,
    is_head: bool,
) -> io::Result<()> {
    let headers = [
        ("Content-Type", content_type.to_string()),
        ("Content-Length", body.len().to_string()),
        ("Cache-Control", "no-store".to_string()),
    ];
    if is_head {
        write_response(stream, status, reason, &headers, None)
    } else {
        write_response(stream, status, reason, &headers, Some(body.as_bytes()))
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    headers: &[(&str, String)],
    body: Option<&[u8]>,
) -> io::Result<()> {
    write!(stream, "HTTP/1.1 {} {}\r\n", status, reason)?;
    for (key, value) in headers {
        write!(stream, "{}: {}\r\n", key, value)?;
    }
    write!(stream, "Connection: close\r\n\r\n")?;
    if let Some(body) = body {
        stream.write_all(body)?;
    }
    stream.flush()
}

fn content_type(name: &str) -> &'static str {
    let ext = PathBuf::from(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "apk" => "application/vnd.android.package-archive",
        "html" | "htm" => "text/html; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "txt" | "log" => "text/plain; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

fn ascii_filename(name: &str) -> String {
    let mut value = String::new();
    for ch in name.chars() {
        if ch.is_ascii_graphic() && ch != '"' && ch != '\\' && ch != ';' {
            value.push(ch);
        } else if ch == ' ' {
            value.push(' ');
        } else {
            value.push('_');
        }
    }
    if value.trim().is_empty() {
        "download".to_string()
    } else {
        value
    }
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char)
            }
            _ => encoded.push_str(&format!("%{:02X}", byte)),
        }
    }
    encoded
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                decoded.push(hex);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).to_string()
}
