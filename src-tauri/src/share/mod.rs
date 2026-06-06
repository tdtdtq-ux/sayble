use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{self, BufRead, BufReader, Read, Write},
    net::{IpAddr, Ipv4Addr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use uuid::Uuid;

use crate::store;
use tauri::Emitter;

const SHARE_FILE: &str = "share_files.json";
const SHARE_SETTINGS_FILE: &str = "share_settings.json";
const SHARE_UPLOAD_FILE: &str = "share_uploads.json";
const SHARE_CONTENT_FILE: &str = "share_contents.json";
const DEFAULT_PORT: u16 = 17321;
const MAX_FILES: usize = 50;
const MAX_UPLOAD_RECORDS: usize = 100;
const MAX_CONTENT_RECORDS: usize = 100;
const MAX_CONTENT_TEXT_BYTES: usize = 256 * 1024;

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
    pub upload_save_dir: Option<PathBuf>,
    pub uploads: Vec<ShareUploadRecord>,
    pub contents: Vec<ShareContentItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShareSettings {
    #[serde(default)]
    selected_host: Option<String>,
    #[serde(default = "default_share_port")]
    port: u16,
    #[serde(default)]
    upload_save_dir: Option<PathBuf>,
}

impl Default for ShareSettings {
    fn default() -> Self {
        Self {
            selected_host: None,
            port: DEFAULT_PORT,
            upload_save_dir: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ShareUploadStatus {
    Pending,
    Accepted,
    Rejected,
    Uploading,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareUploadRecord {
    pub id: String,
    pub batch_id: String,
    pub name: String,
    pub saved_name: Option<String>,
    pub path: Option<PathBuf>,
    pub size: u64,
    #[serde(default)]
    pub duration_seconds: Option<f64>,
    pub received: u64,
    pub source_ip: String,
    pub status: ShareUploadStatus,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadPrepareRequest {
    files: Vec<UploadPrepareFile>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadPrepareFile {
    name: String,
    size: u64,
    #[serde(default)]
    duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadPrepareResponse {
    batch_id: String,
    uploads: Vec<ShareUploadRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadBatchStatus {
    batch_id: String,
    uploads: Vec<ShareUploadRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ShareContentDirection {
    PcToMobile,
    MobileToPc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareContentItem {
    pub id: String,
    pub direction: ShareContentDirection,
    pub text: String,
    pub source_ip: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContentRequest {
    text: String,
}

fn default_share_port() -> u16 {
    DEFAULT_PORT
}

struct ShareServerHandle {
    port: u16,
    stop: Arc<AtomicBool>,
}

pub struct ShareManager {
    app: tauri::AppHandle,
    data_path: PathBuf,
    settings_path: PathBuf,
    upload_path: PathBuf,
    content_path: PathBuf,
    configured_port: Mutex<u16>,
    selected_host: Mutex<String>,
    upload_save_dir: Mutex<Option<PathBuf>>,
    last_error: Mutex<Option<String>>,
    server: Mutex<Option<ShareServerHandle>>,
    files: Mutex<Vec<SharedFile>>,
    uploads: Mutex<Vec<ShareUploadRecord>>,
    contents: Mutex<Vec<ShareContentItem>>,
}

impl ShareManager {
    pub fn init(app: tauri::AppHandle) -> Result<Arc<Self>, String> {
        let base = store::base_dir();
        fs::create_dir_all(&base).map_err(|e| format!("创建共享数据目录失败: {}", e))?;
        let data_path = base.join(SHARE_FILE);
        let settings_path = base.join(SHARE_SETTINGS_FILE);
        let upload_path = base.join(SHARE_UPLOAD_FILE);
        let content_path = base.join(SHARE_CONTENT_FILE);
        let files = read_files(&data_path)?;
        let uploads = read_uploads(&upload_path)?;
        let contents = read_contents(&content_path)?;
        let settings = read_settings(&settings_path)?;
        let port = normalize_port(settings.port)?;
        let candidates = host_candidates(port, "");
        let selected_host = choose_host(settings.selected_host.as_deref(), &candidates);

        let manager = Arc::new(Self {
            app,
            data_path,
            settings_path,
            upload_path,
            content_path,
            configured_port: Mutex::new(port),
            selected_host: Mutex::new(selected_host),
            upload_save_dir: Mutex::new(settings.upload_save_dir),
            last_error: Mutex::new(None),
            server: Mutex::new(None),
            files: Mutex::new(files),
            uploads: Mutex::new(uploads),
            contents: Mutex::new(contents),
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
            upload_save_dir: self
                .upload_save_dir
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            uploads: self
                .uploads
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            contents: self
                .contents
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
        }
    }

    pub fn start_server(self: &Arc<Self>, port: u16) -> Result<ShareServerState, String> {
        let port = normalize_port(port)?;
        self.validate_upload_dir()?;

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

        {
            let mut configured = self
                .configured_port
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *configured = port;
        }
        self.save_settings()?;

        let stop = Arc::new(AtomicBool::new(false));
        self.start_http_server(listener, Arc::clone(&stop));

        {
            let mut server = self.server.lock().unwrap_or_else(|e| e.into_inner());
            *server = Some(ShareServerHandle { port, stop });
        }
        {
            let mut last_error = self.last_error.lock().unwrap_or_else(|e| e.into_inner());
            *last_error = None;
        }

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

    pub fn set_upload_dir(&self, path: String) -> Result<ShareServerState, String> {
        let path = PathBuf::from(path);
        let path = path
            .canonicalize()
            .map_err(|e| format!("读取上传目录失败: {}", e))?;
        let path = normalize_path(path);
        let metadata = fs::metadata(&path).map_err(|e| format!("读取上传目录失败: {}", e))?;
        if !metadata.is_dir() {
            return Err("上传保存位置必须是文件夹".to_string());
        }
        {
            let mut upload_save_dir = self
                .upload_save_dir
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *upload_save_dir = Some(path);
        }
        self.save_settings()?;
        Ok(self.state())
    }

    pub fn accept_upload(&self, id: String) -> Result<ShareServerState, String> {
        self.update_upload_status(&id, ShareUploadStatus::Accepted, None)?;
        Ok(self.state())
    }

    pub fn reject_upload(&self, id: String) -> Result<ShareServerState, String> {
        self.update_upload_status(&id, ShareUploadStatus::Rejected, None)?;
        Ok(self.state())
    }

    pub fn accept_upload_batch(&self, batch_id: String) -> Result<ShareServerState, String> {
        self.update_upload_batch_status(&batch_id, ShareUploadStatus::Accepted)?;
        Ok(self.state())
    }

    pub fn reject_upload_batch(&self, batch_id: String) -> Result<ShareServerState, String> {
        self.update_upload_batch_status(&batch_id, ShareUploadStatus::Rejected)?;
        Ok(self.state())
    }

    pub fn clear_uploads(&self) -> Result<ShareServerState, String> {
        let mut uploads = self.uploads.lock().unwrap_or_else(|e| e.into_inner());
        uploads.retain(|item| {
            matches!(
                item.status,
                ShareUploadStatus::Pending
                    | ShareUploadStatus::Accepted
                    | ShareUploadStatus::Uploading
            )
        });
        write_json(&self.upload_path, &*uploads)?;
        drop(uploads);
        Ok(self.state())
    }

    pub fn delete_upload(&self, id: String, delete_file: bool) -> Result<ShareServerState, String> {
        let mut uploads = self.uploads.lock().unwrap_or_else(|e| e.into_inner());
        let Some(index) = uploads.iter().position(|item| item.id == id) else {
            return Err("上传记录不存在".to_string());
        };
        if delete_file {
            let Some(path) = uploads[index].path.clone() else {
                return Err("上传记录没有原文件路径".to_string());
            };
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("删除原文件失败: {}", e)),
            }
        }
        uploads.remove(index);
        write_json(&self.upload_path, &*uploads)?;
        drop(uploads);
        Ok(self.state())
    }

    pub fn add_pc_content(&self, text: String) -> Result<ShareServerState, String> {
        self.add_content(ShareContentDirection::PcToMobile, text, None)?;
        Ok(self.state())
    }

    pub fn remove_content(&self, id: String) -> Result<ShareServerState, String> {
        let mut contents = self.contents.lock().unwrap_or_else(|e| e.into_inner());
        contents.retain(|item| item.id != id);
        write_json(&self.content_path, &*contents)?;
        drop(contents);
        Ok(self.state())
    }

    pub fn clear_contents(&self) -> Result<ShareServerState, String> {
        let mut contents = self.contents.lock().unwrap_or_else(|e| e.into_inner());
        contents.clear();
        write_json(&self.content_path, &*contents)?;
        drop(contents);
        Ok(self.state())
    }

    fn add_mobile_content(
        &self,
        text: String,
        source_ip: String,
    ) -> Result<ShareContentItem, String> {
        self.add_content(ShareContentDirection::MobileToPc, text, Some(source_ip))
    }

    fn add_content(
        &self,
        direction: ShareContentDirection,
        text: String,
        source_ip: Option<String>,
    ) -> Result<ShareContentItem, String> {
        if text.trim().is_empty() {
            return Err("内容不能为空".to_string());
        }
        if text.len() > MAX_CONTENT_TEXT_BYTES {
            return Err("内容太长，请控制在 256KB 以内".to_string());
        }

        let item = ShareContentItem {
            id: Uuid::new_v4().to_string(),
            direction,
            text,
            source_ip,
            created_at: now_string(),
        };
        let mut contents = self.contents.lock().unwrap_or_else(|e| e.into_inner());
        contents.insert(0, item.clone());
        if contents.len() > MAX_CONTENT_RECORDS {
            contents.truncate(MAX_CONTENT_RECORDS);
        }
        write_json(&self.content_path, &*contents)?;
        drop(contents);

        let _ = self.app.emit("share-content-changed", &item);
        if item.direction == ShareContentDirection::MobileToPc {
            let _ = self.app.emit("share-content-received", &item);
        }
        Ok(item)
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
            upload_save_dir: self
                .upload_save_dir
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
        };
        write_json(&self.settings_path, &settings)
    }

    fn validate_upload_dir(&self) -> Result<PathBuf, String> {
        let Some(path) = self
            .upload_save_dir
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        else {
            return Err("请先设置手机上传保存目录".to_string());
        };
        let metadata =
            fs::metadata(&path).map_err(|_| "上传保存目录不存在，请重新设置".to_string())?;
        if !metadata.is_dir() {
            return Err("上传保存位置必须是文件夹".to_string());
        }
        Ok(path)
    }

    fn update_upload_status(
        &self,
        id: &str,
        status: ShareUploadStatus,
        error: Option<String>,
    ) -> Result<(), String> {
        let mut uploads = self.uploads.lock().unwrap_or_else(|e| e.into_inner());
        let Some(record) = uploads.iter_mut().find(|item| item.id == id) else {
            return Err("上传记录不存在".to_string());
        };
        if matches!(
            record.status,
            ShareUploadStatus::Completed | ShareUploadStatus::Failed | ShareUploadStatus::Rejected
        ) {
            return Ok(());
        }
        record.status = status;
        record.updated_at = now_string();
        record.error = error;
        let record = record.clone();
        write_json(&self.upload_path, &*uploads)?;
        let _ = self.app.emit("share-upload-changed", &record);
        Ok(())
    }

    fn update_upload_batch_status(
        &self,
        batch_id: &str,
        status: ShareUploadStatus,
    ) -> Result<(), String> {
        let mut uploads = self.uploads.lock().unwrap_or_else(|e| e.into_inner());
        let mut changed = false;
        let now = now_string();
        for record in uploads.iter_mut().filter(|item| item.batch_id == batch_id) {
            if matches!(
                record.status,
                ShareUploadStatus::Pending | ShareUploadStatus::Accepted
            ) {
                record.status = status.clone();
                record.updated_at = now.clone();
                changed = true;
            }
        }
        if !changed {
            return Err("没有可更新的上传记录".to_string());
        }
        let changed_records: Vec<ShareUploadRecord> = uploads
            .iter()
            .filter(|item| item.batch_id == batch_id)
            .cloned()
            .collect();
        write_json(&self.upload_path, &*uploads)?;
        for record in changed_records {
            let _ = self.app.emit("share-upload-changed", &record);
        }
        Ok(())
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
        stream.set_nonblocking(false)?;
        let source_ip = stream
            .peer_addr()
            .map(|addr| addr.ip().to_string())
            .unwrap_or_else(|_| "unknown".to_string());
        let mut request_line = String::new();
        let mut headers = Vec::new();
        let mut reader = BufReader::new(&mut stream);
        reader.read_line(&mut request_line)?;
        loop {
            let mut line = String::new();
            let bytes = reader.read_line(&mut line)?;
            if bytes == 0 || line == "\r\n" || line == "\n" {
                break;
            }
            if let Some((key, value)) = line.trim_end().split_once(':') {
                headers.push((key.trim().to_ascii_lowercase(), value.trim().to_string()));
            }
        }

        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("");
        let target = parts.next().unwrap_or("/");
        let path = target.split('?').next().unwrap_or("/");
        let is_head = method.eq_ignore_ascii_case("HEAD");
        let content_length = header_value(&headers, "content-length")
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);

        if method.eq_ignore_ascii_case("OPTIONS") {
            return write_response(
                reader.get_mut(),
                204,
                "No Content",
                &[
                    ("Access-Control-Allow-Origin", "*".to_string()),
                    (
                        "Access-Control-Allow-Methods",
                        "GET, POST, OPTIONS".to_string(),
                    ),
                    (
                        "Access-Control-Allow-Headers",
                        "Content-Type, Content-Length".to_string(),
                    ),
                    ("Content-Length", "0".to_string()),
                ],
                None,
            );
        }

        if !method.eq_ignore_ascii_case("GET") && !method.eq_ignore_ascii_case("POST") && !is_head {
            return write_text_response(
                reader.get_mut(),
                405,
                "Method Not Allowed",
                "text/plain; charset=utf-8",
                "Method Not Allowed",
                is_head,
            );
        }

        match path {
            "/" | "/index.html" if method.eq_ignore_ascii_case("GET") || is_head => {
                write_text_response(
                    reader.get_mut(),
                    200,
                    "OK",
                    "text/html; charset=utf-8",
                    &self.render_index_html(),
                    is_head,
                )
            }
            "/api/files" if method.eq_ignore_ascii_case("GET") || is_head => {
                let body =
                    serde_json::to_string(&self.state()).unwrap_or_else(|_| "{}".to_string());
                write_text_response(
                    reader.get_mut(),
                    200,
                    "OK",
                    "application/json; charset=utf-8",
                    &body,
                    is_head,
                )
            }
            "/api/content" if method.eq_ignore_ascii_case("GET") || is_head => {
                self.write_content_list(reader.get_mut(), is_head)
            }
            "/api/content" if method.eq_ignore_ascii_case("POST") => {
                self.write_content_create(&mut reader, content_length, source_ip)
            }
            "/api/upload/prepare" if method.eq_ignore_ascii_case("POST") => {
                self.write_upload_prepare(&mut reader, content_length, source_ip)
            }
            _ if path.starts_with("/api/upload/batch/")
                && (method.eq_ignore_ascii_case("GET") || is_head) =>
            {
                let batch_id = percent_decode(&path["/api/upload/batch/".len()..]);
                self.write_upload_batch_status(reader.get_mut(), &batch_id, is_head)
            }
            _ if path.starts_with("/api/upload/") && method.eq_ignore_ascii_case("POST") => {
                let id = percent_decode(&path["/api/upload/".len()..]);
                self.write_upload(&mut reader, &id, content_length)
            }
            _ if path.starts_with("/download/")
                && (method.eq_ignore_ascii_case("GET") || is_head) =>
            {
                let id = percent_decode(&path["/download/".len()..]);
                self.write_download(reader.get_mut(), &id, is_head)
            }
            "/favicon.ico" => write_response(
                reader.get_mut(),
                204,
                "No Content",
                &[("Content-Length", "0".to_string())],
                None,
            ),
            _ => write_text_response(
                reader.get_mut(),
                404,
                "Not Found",
                "text/plain; charset=utf-8",
                "Not Found",
                is_head,
            ),
        }
    }

    fn write_content_list(&self, stream: &mut TcpStream, is_head: bool) -> io::Result<()> {
        let contents = self
            .contents
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let body = serde_json::to_string(&contents).unwrap_or_else(|_| "[]".to_string());
        write_text_response(
            stream,
            200,
            "OK",
            "application/json; charset=utf-8",
            &body,
            is_head,
        )
    }

    fn write_content_create(
        &self,
        reader: &mut BufReader<&mut TcpStream>,
        content_length: u64,
        source_ip: String,
    ) -> io::Result<()> {
        if content_length == 0 || content_length as usize > MAX_CONTENT_TEXT_BYTES + 1024 {
            return write_text_response(
                reader.get_mut(),
                400,
                "Bad Request",
                "text/plain; charset=utf-8",
                "内容无效",
                false,
            );
        }

        let body = match read_exact_body(reader, content_length) {
            Ok(body) => body,
            Err(e) => {
                return write_text_response(
                    reader.get_mut(),
                    400,
                    "Bad Request",
                    "text/plain; charset=utf-8",
                    &format!("读取内容失败: {}", e),
                    false,
                )
            }
        };
        let request: ContentRequest = match serde_json::from_slice(&body) {
            Ok(request) => request,
            Err(e) => {
                return write_text_response(
                    reader.get_mut(),
                    400,
                    "Bad Request",
                    "text/plain; charset=utf-8",
                    &format!("解析内容失败: {}", e),
                    false,
                )
            }
        };

        match self.add_mobile_content(request.text, source_ip) {
            Ok(item) => {
                let body = serde_json::to_string(&item).unwrap_or_else(|_| "{}".to_string());
                write_text_response(
                    reader.get_mut(),
                    200,
                    "OK",
                    "application/json; charset=utf-8",
                    &body,
                    false,
                )
            }
            Err(e) => write_text_response(
                reader.get_mut(),
                400,
                "Bad Request",
                "text/plain; charset=utf-8",
                &e,
                false,
            ),
        }
    }

    fn write_upload_prepare(
        &self,
        reader: &mut BufReader<&mut TcpStream>,
        content_length: u64,
        source_ip: String,
    ) -> io::Result<()> {
        if let Err(e) = self.validate_upload_dir() {
            return write_text_response(
                reader.get_mut(),
                400,
                "Bad Request",
                "text/plain; charset=utf-8",
                &e,
                false,
            );
        }
        if content_length == 0 || content_length > 1024 * 1024 {
            return write_text_response(
                reader.get_mut(),
                400,
                "Bad Request",
                "text/plain; charset=utf-8",
                "上传请求无效",
                false,
            );
        }

        let body = match read_exact_body(reader, content_length) {
            Ok(body) => body,
            Err(e) => {
                return write_text_response(
                    reader.get_mut(),
                    400,
                    "Bad Request",
                    "text/plain; charset=utf-8",
                    &format!("读取上传请求失败: {}", e),
                    false,
                )
            }
        };
        let request: UploadPrepareRequest = match serde_json::from_slice(&body) {
            Ok(request) => request,
            Err(e) => {
                return write_text_response(
                    reader.get_mut(),
                    400,
                    "Bad Request",
                    "text/plain; charset=utf-8",
                    &format!("解析上传请求失败: {}", e),
                    false,
                )
            }
        };
        if request.files.is_empty() {
            return write_text_response(
                reader.get_mut(),
                400,
                "Bad Request",
                "text/plain; charset=utf-8",
                "请选择要上传的文件",
                false,
            );
        }

        let batch_id = Uuid::new_v4().to_string();
        let now = now_string();
        let new_uploads: Vec<ShareUploadRecord> = request
            .files
            .into_iter()
            .filter_map(|file| {
                let name = sanitize_filename(&file.name);
                if name.is_empty() {
                    return None;
                }
                Some(ShareUploadRecord {
                    id: Uuid::new_v4().to_string(),
                    batch_id: batch_id.clone(),
                    name,
                    saved_name: None,
                    path: None,
                    size: file.size,
                    duration_seconds: file
                        .duration_seconds
                        .filter(|duration| duration.is_finite() && *duration > 0.0),
                    received: 0,
                    source_ip: source_ip.clone(),
                    status: ShareUploadStatus::Pending,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                    completed_at: None,
                    error: None,
                })
            })
            .collect();

        if new_uploads.is_empty() {
            return write_text_response(
                reader.get_mut(),
                400,
                "Bad Request",
                "text/plain; charset=utf-8",
                "文件名无效",
                false,
            );
        }

        {
            let mut uploads = self.uploads.lock().unwrap_or_else(|e| e.into_inner());
            for upload in new_uploads.iter().rev() {
                uploads.insert(0, upload.clone());
            }
            if uploads.len() > MAX_UPLOAD_RECORDS {
                uploads.truncate(MAX_UPLOAD_RECORDS);
            }
            if let Err(e) = write_json(&self.upload_path, &*uploads) {
                return write_text_response(
                    reader.get_mut(),
                    500,
                    "Internal Server Error",
                    "text/plain; charset=utf-8",
                    &e,
                    false,
                );
            }
        }

        let response = UploadPrepareResponse {
            batch_id,
            uploads: new_uploads,
        };
        let _ = self.app.emit("share-upload-request", &response);
        let body = serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_string());
        write_text_response(
            reader.get_mut(),
            200,
            "OK",
            "application/json; charset=utf-8",
            &body,
            false,
        )
    }

    fn write_upload_batch_status(
        &self,
        stream: &mut TcpStream,
        batch_id: &str,
        is_head: bool,
    ) -> io::Result<()> {
        let uploads: Vec<ShareUploadRecord> = self
            .uploads
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter(|item| item.batch_id == batch_id)
            .cloned()
            .collect();
        let body = serde_json::to_string(&UploadBatchStatus {
            batch_id: batch_id.to_string(),
            uploads,
        })
        .unwrap_or_else(|_| "{}".to_string());
        write_text_response(
            stream,
            200,
            "OK",
            "application/json; charset=utf-8",
            &body,
            is_head,
        )
    }

    fn write_upload(
        &self,
        reader: &mut BufReader<&mut TcpStream>,
        id: &str,
        content_length: u64,
    ) -> io::Result<()> {
        let save_dir = match self.validate_upload_dir() {
            Ok(path) => path,
            Err(e) => {
                return write_text_response(
                    reader.get_mut(),
                    400,
                    "Bad Request",
                    "text/plain; charset=utf-8",
                    &e,
                    false,
                )
            }
        };

        let record = {
            let uploads = self.uploads.lock().unwrap_or_else(|e| e.into_inner());
            uploads.iter().find(|item| item.id == id).cloned()
        };
        let Some(record) = record else {
            return write_text_response(
                reader.get_mut(),
                404,
                "Not Found",
                "text/plain; charset=utf-8",
                "上传记录不存在",
                false,
            );
        };
        if record.status == ShareUploadStatus::Rejected {
            return write_text_response(
                reader.get_mut(),
                409,
                "Conflict",
                "text/plain; charset=utf-8",
                "电脑已拒绝接收",
                false,
            );
        }
        if record.status != ShareUploadStatus::Accepted {
            return write_text_response(
                reader.get_mut(),
                409,
                "Conflict",
                "text/plain; charset=utf-8",
                "等待电脑确认接收",
                false,
            );
        }
        if content_length != record.size {
            self.fail_upload(
                id,
                format!(
                    "文件大小不一致: 预计 {}, 实际 {}",
                    record.size, content_length
                ),
            );
            return write_text_response(
                reader.get_mut(),
                400,
                "Bad Request",
                "text/plain; charset=utf-8",
                "文件大小不一致",
                false,
            );
        }

        let (saved_name, path, tmp_path, mut file) =
            match create_unique_upload_file(&save_dir, &record.name) {
                Ok(result) => result,
                Err(e) => {
                    self.fail_upload(id, format!("创建文件失败: {}", e));
                    return write_text_response(
                        reader.get_mut(),
                        500,
                        "Internal Server Error",
                        "text/plain; charset=utf-8",
                        &format!("创建文件失败: {}", e),
                        false,
                    );
                }
            };

        self.mark_uploading(id, saved_name, path.clone());

        let mut received = 0u64;
        let mut remaining = content_length;
        let mut last_progress_emit = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        while remaining > 0 {
            let read_len = buffer.len().min(remaining as usize);
            let count = match reader.read(&mut buffer[..read_len]) {
                Ok(0) => break,
                Ok(count) => count,
                Err(e) => {
                    self.fail_upload(id, format!("读取上传内容失败: {}", e));
                    drop(file);
                    let _ = fs::remove_file(&tmp_path);
                    return write_text_response(
                        reader.get_mut(),
                        500,
                        "Internal Server Error",
                        "text/plain; charset=utf-8",
                        &format!("读取上传内容失败: {}", e),
                        false,
                    );
                }
            };
            if let Err(e) = file.write_all(&buffer[..count]) {
                self.fail_upload(id, format!("写入上传文件失败: {}", e));
                drop(file);
                let _ = fs::remove_file(&tmp_path);
                return write_text_response(
                    reader.get_mut(),
                    500,
                    "Internal Server Error",
                    "text/plain; charset=utf-8",
                    &format!("写入上传文件失败: {}", e),
                    false,
                );
            }
            received += count as u64;
            remaining -= count as u64;
            if received == content_length
                || received.saturating_sub(last_progress_emit) >= 512 * 1024
            {
                self.update_upload_received(id, received);
                last_progress_emit = received;
            }
        }

        if received != content_length {
            self.fail_upload(id, "上传中断".to_string());
            drop(file);
            let _ = fs::remove_file(&tmp_path);
            return write_text_response(
                reader.get_mut(),
                400,
                "Bad Request",
                "text/plain; charset=utf-8",
                "上传中断",
                false,
            );
        }

        if let Err(e) = file.flush() {
            self.fail_upload(id, format!("保存上传文件失败: {}", e));
            drop(file);
            let _ = fs::remove_file(&tmp_path);
            return write_text_response(
                reader.get_mut(),
                500,
                "Internal Server Error",
                "text/plain; charset=utf-8",
                &format!("保存上传文件失败: {}", e),
                false,
            );
        }
        drop(file);

        if let Err(e) = fs::rename(&tmp_path, &path) {
            self.fail_upload(id, format!("保存上传文件失败: {}", e));
            let _ = fs::remove_file(&tmp_path);
            return write_text_response(
                reader.get_mut(),
                500,
                "Internal Server Error",
                "text/plain; charset=utf-8",
                &format!("保存上传文件失败: {}", e),
                false,
            );
        }

        self.complete_upload(id);
        write_text_response(
            reader.get_mut(),
            200,
            "OK",
            "application/json; charset=utf-8",
            r#"{"ok":true}"#,
            false,
        )
    }

    fn mark_uploading(&self, id: &str, saved_name: String, path: PathBuf) {
        let record = {
            let mut uploads = self.uploads.lock().unwrap_or_else(|e| e.into_inner());
            let Some(record) = uploads.iter_mut().find(|item| item.id == id) else {
                return;
            };
            record.status = ShareUploadStatus::Uploading;
            record.saved_name = Some(saved_name);
            record.path = Some(path);
            record.received = 0;
            record.updated_at = now_string();
            let record = record.clone();
            let _ = write_json(&self.upload_path, &*uploads);
            record
        };
        let _ = self.app.emit("share-upload-progress", &record);
    }

    fn update_upload_received(&self, id: &str, received: u64) {
        let record = {
            let mut uploads = self.uploads.lock().unwrap_or_else(|e| e.into_inner());
            let Some(record) = uploads.iter_mut().find(|item| item.id == id) else {
                return;
            };
            record.status = ShareUploadStatus::Uploading;
            record.received = received;
            record.updated_at = now_string();
            record.clone()
        };
        let _ = self.app.emit("share-upload-progress", &record);
    }

    fn complete_upload(&self, id: &str) {
        let record = {
            let mut uploads = self.uploads.lock().unwrap_or_else(|e| e.into_inner());
            let Some(record) = uploads.iter_mut().find(|item| item.id == id) else {
                return;
            };
            record.status = ShareUploadStatus::Completed;
            record.received = record.size;
            record.updated_at = now_string();
            record.completed_at = Some(record.updated_at.clone());
            record.error = None;
            let record = record.clone();
            let _ = write_json(&self.upload_path, &*uploads);
            record
        };
        let _ = self.app.emit("share-upload-finished", &record);
    }

    fn fail_upload(&self, id: &str, error: String) {
        let record = {
            let mut uploads = self.uploads.lock().unwrap_or_else(|e| e.into_inner());
            let Some(record) = uploads.iter_mut().find(|item| item.id == id) else {
                return;
            };
            record.status = ShareUploadStatus::Failed;
            record.updated_at = now_string();
            record.completed_at = Some(record.updated_at.clone());
            record.error = Some(error);
            let record = record.clone();
            let _ = write_json(&self.upload_path, &*uploads);
            record
        };
        let _ = self.app.emit("share-upload-finished", &record);
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
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: #f7f7f7; color: #161616; }}
main {{ max-width: 640px; margin: 0 auto; padding: 14px 12px; }}
.topbar {{ display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }}
.brand {{ flex: 0 0 auto; font-size: 15px; font-weight: 800; }}
.file {{ display: flex; align-items: center; justify-content: space-between; gap: 14px; border: 1px solid #e4e4e4; background: #fff; border-radius: 10px; padding: 14px; margin-bottom: 10px; }}
.name {{ font-weight: 650; word-break: break-all; }}
.meta {{ margin-top: 5px; color: #777; font-size: 12px; }}
a {{ border-radius: 8px; background: #171717; color: #fff; padding: 9px 12px; text-decoration: none; white-space: nowrap; font-size: 14px; }}
.empty {{ border: 1px dashed #cfcfcf; border-radius: 10px; padding: 28px 16px; text-align: center; color: #777; background: #fff; }}
.tabs {{ flex: 1 1 auto; display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px; min-width: 0; padding: 3px; border-radius: 10px; background: #ececec; }}
.tab {{ border: 0; border-radius: 8px; padding: 8px 6px; background: transparent; color: #555; font-size: 14px; font-weight: 700; }}
.tab.active {{ background: #fff; color: #151515; box-shadow: 0 1px 5px rgba(0, 0, 0, 0.08); }}
.panel[hidden] {{ display: none; }}
.upload-picker {{ border: 1px dashed #cfcfcf; border-radius: 10px; background: #fff; padding: 14px; text-align: center; }}
.upload-picker input {{ display: block; width: 100%; margin: 12px 0; }}
.upload-button {{ border: 0; border-radius: 8px; background: #171717; color: #fff; padding: 10px 14px; font-size: 14px; font-weight: 650; }}
.upload-button:disabled {{ opacity: 0.55; }}
.upload-row {{ display: flex; align-items: center; justify-content: space-between; gap: 14px; border: 1px solid #e4e4e4; background: #fff; border-radius: 10px; padding: 14px; margin-bottom: 10px; }}
.upload-main {{ min-width: 0; flex: 1; }}
.status {{ display: inline-flex; align-items: center; border-radius: 999px; background: #eee; color: #555; padding: 3px 8px; font-size: 12px; font-weight: 700; white-space: nowrap; }}
.status.completed {{ background: #e8f8ef; color: #177245; }}
.status.pending, .status.uploading {{ background: #eef2ff; color: #3730a3; }}
.status.failed, .status.rejected {{ background: #feecec; color: #b42318; }}
.progress {{ width: 100%; height: 7px; overflow: hidden; border-radius: 999px; background: #ededed; margin-top: 8px; }}
.bar {{ height: 100%; width: 0; border-radius: inherit; background: #171717; transition: width 160ms ease; }}
.content-box {{ border: 1px dashed #cfcfcf; border-radius: 10px; background: #fff; padding: 14px; }}
.content-box textarea {{ display: block; width: 100%; min-height: 104px; resize: vertical; border: 1px solid #ddd; border-radius: 8px; padding: 10px; margin: 10px 0; font: inherit; }}
.content-actions {{ display: flex; gap: 10px; justify-content: space-between; align-items: center; }}
.content-list {{ margin-top: 14px; }}
.content-item {{ border: 1px solid #e4e4e4; background: #fff; border-radius: 10px; padding: 14px; margin-bottom: 10px; }}
.content-text {{ margin-top: 8px; white-space: pre-wrap; word-break: break-word; font-size: 14px; line-height: 1.65; }}
.secondary-button {{ border: 0; border-radius: 8px; background: #efefef; color: #222; padding: 9px 12px; font-size: 14px; font-weight: 650; }}
.video-toolbar {{ display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }}
.video-toolbar input {{ display: none; }}
.orientation-badge {{ border-radius: 999px; background: #efefef; color: #555; padding: 5px 9px; font-size: 12px; font-weight: 700; white-space: nowrap; }}
.video-list {{ display: flex; flex-direction: column; gap: 10px; }}
.video-list > .empty {{ display: flex; align-items: center; justify-content: center; width: 100%; aspect-ratio: 16 / 9; padding: 0; }}
.video-card {{ position: relative; overflow: hidden; border: 1px solid #e4e4e4; border-radius: 10px; background: #fff; }}
.video-cover {{ display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #111; }}
.video-info {{ padding: 10px; }}
.video-info button {{ min-width: 0; }}
.video-title {{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 650; }}
.video-meta {{ margin-top: 3px; color: #777; font-size: 12px; }}
.video-actions {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }}
.video-actions button {{ width: 100%; }}
@media (orientation: landscape) {{
  main {{ max-width: none; padding: 10px 12px; }}
  .video-list {{ flex-direction: row; overflow-x: auto; scroll-snap-type: x proximity; padding-bottom: 6px; }}
  .video-card {{ flex: 0 0 min(38vw, 320px); scroll-snap-align: start; }}
  .video-list > .empty {{ flex: 0 0 min(38vw, 320px); }}
}}
@media (orientation: portrait) {{
  .video-list {{ overflow-y: visible; }}
}}
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
<div class="topbar">
  <div class="brand">{title}</div>
  <div class="tabs">
    <button id="tab-download" class="tab active" type="button">下载</button>
    <button id="tab-upload" class="tab" type="button">上传</button>
    <button id="tab-content" class="tab" type="button">内容</button>
    <button id="tab-record" class="tab" type="button">录像</button>
  </div>
</div>
<section id="panel-download" class="panel">
  <div id="files" class="empty">暂无共享文件</div>
</section>
<section id="panel-upload" class="panel" hidden>
  <div class="upload-picker">
    <div class="name">上传到电脑</div>
    <input id="upload-input" type="file" multiple />
    <button id="upload-button" class="upload-button" type="button">提交上传</button>
  </div>
  <div id="uploads" style="margin-top: 14px;"></div>
</section>
<section id="panel-content" class="panel" hidden>
  <div class="content-box">
    <div class="name">发送到电脑</div>
    <textarea id="content-input" maxlength="262144" placeholder="输入要发送到电脑的内容"></textarea>
    <div class="content-actions">
      <button id="content-refresh" class="secondary-button" type="button">刷新</button>
      <button id="content-send" class="upload-button" type="button">发送</button>
    </div>
  </div>
  <div id="contents" class="content-list"></div>
</section>
<section id="panel-record" class="panel" hidden>
  <div class="video-toolbar">
    <span id="orientation-badge" class="orientation-badge">检测中</span>
    <div>
      <input id="video-input" type="file" accept="video/*" capture="user" />
      <button id="video-add" class="upload-button" type="button">添加视频</button>
    </div>
  </div>
  <div id="videos" class="video-list">
    <div class="empty">暂无视频</div>
  </div>
</section>
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
const formatDuration = (seconds) => {{
  if (!Number.isFinite(seconds) || seconds <= 0) return "读取中";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${{h}}:${{String(m).padStart(2, "0")}}:${{String(s).padStart(2, "0")}}`;
  return `${{m}}:${{String(s).padStart(2, "0")}}`;
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
const uploadItems = new Map();
const recordedVideos = [];
const setTab = (tab) => {{
  document.getElementById("tab-download").classList.toggle("active", tab === "download");
  document.getElementById("tab-upload").classList.toggle("active", tab === "upload");
  document.getElementById("tab-content").classList.toggle("active", tab === "content");
  document.getElementById("tab-record").classList.toggle("active", tab === "record");
  document.getElementById("panel-download").hidden = tab !== "download";
  document.getElementById("panel-upload").hidden = tab !== "upload";
  document.getElementById("panel-content").hidden = tab !== "content";
  document.getElementById("panel-record").hidden = tab !== "record";
}};
const orientationQuery = window.matchMedia("(orientation: landscape)");
const updateOrientation = () => {{
  const badge = document.getElementById("orientation-badge");
  if (badge) badge.textContent = orientationQuery.matches ? "横屏" : "竖屏";
}};
if (orientationQuery.addEventListener) {{
  orientationQuery.addEventListener("change", updateOrientation);
}} else if (orientationQuery.addListener) {{
  orientationQuery.addListener(updateOrientation);
}}
updateOrientation();
const renderUploads = () => {{
  const el = document.getElementById("uploads");
  const items = Array.from(uploadItems.values());
  if (items.length === 0) {{
    el.innerHTML = "";
    return;
  }}
  el.innerHTML = items.map((item) => `
    <div class="upload-row">
      <div class="upload-main">
        <div class="name">${{escapeHtml(item.file.name)}}</div>
        <div class="meta">${{formatSize(item.file.size)}} · ${{escapeHtml(item.message || "")}}</div>
        <div class="progress"><div class="bar" style="width: ${{item.progress || 0}}%"></div></div>
      </div>
      <span class="status ${{escapeHtml(item.status)}}">${{escapeHtml(item.label)}}</span>
    </div>
  `).join("");
}};
const setUploadItem = (id, patch) => {{
  const item = uploadItems.get(id);
  if (!item) return;
  uploadItems.set(id, {{ ...item, ...patch }});
  renderUploads();
}};
const uploadFile = (record, file) => new Promise((resolve) => {{
  if (!file) {{
    setUploadItem(record.id, {{ status: "failed", label: "失败", message: "本地文件丢失" }});
    resolve();
    return;
  }}
  setUploadItem(record.id, {{ status: "uploading", label: "上传中", message: "正在上传", progress: 0 }});
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `/api/upload/${{encodeURIComponent(record.id)}}`);
  xhr.upload.onprogress = (event) => {{
    if (event.lengthComputable) {{
      setUploadItem(record.id, {{ progress: Math.round((event.loaded / event.total) * 100) }});
    }}
  }};
  xhr.onload = () => {{
    if (xhr.status >= 200 && xhr.status < 300) {{
      setUploadItem(record.id, {{ status: "completed", label: "已完成", message: "已保存到电脑", progress: 100 }});
    }} else {{
      setUploadItem(record.id, {{ status: "failed", label: "失败", message: xhr.responseText || "上传失败" }});
    }}
    resolve();
  }};
  xhr.onerror = () => {{
    setUploadItem(record.id, {{ status: "failed", label: "失败", message: "网络错误" }});
    resolve();
  }};
  xhr.send(file);
}});
const readMediaDuration = (file) => new Promise((resolve) => {{
  if (!file || !/^(audio|video)\//.test(file.type || "")) {{
    resolve(null);
    return;
  }}
  const element = document.createElement((file.type || "").startsWith("audio/") ? "audio" : "video");
  const url = URL.createObjectURL(file);
  let settled = false;
  const finish = (value) => {{
    if (settled) return;
    settled = true;
    URL.revokeObjectURL(url);
    resolve(Number.isFinite(value) && value > 0 ? value : null);
  }};
  element.preload = "metadata";
  element.src = url;
  element.addEventListener("loadedmetadata", () => finish(element.duration), {{ once: true }});
  element.addEventListener("error", () => finish(null), {{ once: true }});
  setTimeout(() => finish(null), 1800);
}});
const prepareUploads = async (files, durationByFile = new Map()) => {{
  const metadata = await Promise.all(files.map(async (file) => ({{
    name: file.name,
    size: file.size,
    durationSeconds: durationByFile.has(file) ? durationByFile.get(file) : await readMediaDuration(file),
  }})));
  const response = await fetch("/api/upload/prepare", {{
    method: "POST",
    headers: {{ "Content-Type": "application/json" }},
    body: JSON.stringify({{ files: metadata }}),
  }});
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}};
const pollBatch = (batchId, fileById) => {{
  const started = new Set();
  const timer = setInterval(async () => {{
    try {{
      const status = await fetch(`/api/upload/batch/${{encodeURIComponent(batchId)}}`, {{ cache: "no-store" }}).then((r) => r.json());
      let done = true;
      for (const record of status.uploads || []) {{
        const item = uploadItems.get(record.id);
        if (!item) continue;
        if (["completed", "failed", "rejected"].includes(item.status)) continue;
        if (record.status === "rejected") {{
          setUploadItem(record.id, {{ status: "rejected", label: "已拒绝", message: "电脑已拒绝" }});
          continue;
        }}
        if (record.status === "failed") {{
          setUploadItem(record.id, {{ status: "failed", label: "失败", message: record.error || "上传失败" }});
          continue;
        }}
        if (record.status === "completed") {{
          setUploadItem(record.id, {{ status: "completed", label: "已完成", message: "已保存到电脑", progress: 100 }});
          continue;
        }}
        if ((record.status === "accepted" || record.status === "uploading") && !started.has(record.id)) {{
          started.add(record.id);
          uploadFile(record, fileById.get(record.id));
        }}
        done = false;
      }}
      if (done) clearInterval(timer);
    }} catch (e) {{
      // 保持轮询，手机网络偶发抖动时无需立即失败。
    }}
  }}, 1000);
}};
const submitUpload = async () => {{
  const input = document.getElementById("upload-input");
  const button = document.getElementById("upload-button");
  const files = Array.from(input.files || []);
  if (files.length === 0) return;
  button.disabled = true;
  try {{
    const prepared = await prepareUploads(files);
    const fileById = new Map();
    prepared.uploads.forEach((record, index) => {{
      const file = files[index];
      fileById.set(record.id, file);
      uploadItems.set(record.id, {{
        file,
        status: "pending",
        label: "待接收",
        message: "等待电脑接收",
        progress: 0,
      }});
    }});
    renderUploads();
    pollBatch(prepared.batchId, fileById);
    input.value = "";
  }} catch (e) {{
    alert(String(e.message || e));
  }} finally {{
    button.disabled = false;
  }}
}};
const copyContent = async (text, button) => {{
  try {{
    if (navigator.clipboard && window.isSecureContext) {{
      await navigator.clipboard.writeText(text);
    }} else {{
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }}
    button.textContent = "已复制";
    setTimeout(() => button.textContent = "复制", 1200);
  }} catch (e) {{
    button.textContent = "复制失败";
    setTimeout(() => button.textContent = "复制", 1200);
  }}
}};
const renderContents = (items) => {{
  const el = document.getElementById("contents");
  const pcItems = (items || []).filter((item) => item.direction === "pcToMobile");
  if (pcItems.length === 0) {{
    el.innerHTML = '<div class="empty">暂无电脑发来的内容</div>';
    return;
  }}
  el.innerHTML = pcItems.map((item) => `
    <div class="content-item">
      <div class="file">
        <div>
          <div class="name">电脑发来</div>
          <div class="meta">${{escapeHtml(item.createdAt || "")}}</div>
        </div>
        <button class="secondary-button" type="button" data-copy-id="${{escapeHtml(item.id)}}">复制</button>
      </div>
      <div class="content-text">${{escapeHtml(item.text)}}</div>
    </div>
  `).join("");
  for (const button of el.querySelectorAll("[data-copy-id]")) {{
    const item = pcItems.find((entry) => entry.id === button.getAttribute("data-copy-id"));
    if (item) button.addEventListener("click", () => copyContent(item.text, button));
  }}
}};
const refreshContents = async () => {{
  const el = document.getElementById("contents");
  el.innerHTML = '<div class="empty">刷新中...</div>';
  try {{
    const items = await fetch("/api/content", {{ cache: "no-store" }}).then((r) => r.json());
    renderContents(items);
  }} catch (e) {{
    el.innerHTML = '<div class="empty">刷新失败，请确认电脑和手机在同一网络</div>';
  }}
}};
const submitContent = async () => {{
  const input = document.getElementById("content-input");
  const button = document.getElementById("content-send");
  const text = input.value;
  if (!text.trim()) return;
  button.disabled = true;
  try {{
    const response = await fetch("/api/content", {{
      method: "POST",
      headers: {{ "Content-Type": "application/json" }},
      body: JSON.stringify({{ text }}),
    }});
    if (!response.ok) throw new Error(await response.text());
    input.value = "";
    button.textContent = "已发送";
    setTimeout(() => button.textContent = "发送", 1200);
  }} catch (e) {{
    alert(String(e.message || e));
  }} finally {{
    button.disabled = false;
  }}
}};
const readVideoDetails = (url) => new Promise((resolve) => {{
  const video = document.createElement("video");
  let duration = 0;
  let seekTarget = 0;
  let settled = false;
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  const finish = () => {{
    if (settled) return;
    settled = true;
    try {{
      const width = video.videoWidth || 320;
      const height = video.videoHeight || 180;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {{
        resolve({{ poster: "", duration }});
        return;
      }}
      ctx.drawImage(video, 0, 0, width, height);
      resolve({{ poster: canvas.toDataURL("image/jpeg", 0.72), duration }});
    }} catch (e) {{
      resolve({{ poster: "", duration }});
    }}
  }};
  video.addEventListener("loadedmetadata", () => {{
    duration = Number.isFinite(video.duration) ? video.duration : 0;
    seekTarget = duration > 0.4 ? 0.2 : 0;
    if (seekTarget > 0) {{
      try {{
        video.currentTime = seekTarget;
      }} catch (e) {{
        finish();
      }}
    }}
  }}, {{ once: true }});
  video.addEventListener("seeked", finish, {{ once: true }});
  video.addEventListener("loadeddata", () => {{
    if (!settled && seekTarget === 0) finish();
  }}, {{ once: true }});
  video.addEventListener("error", () => {{
    if (!settled) {{
      settled = true;
      resolve({{ poster: "", duration }});
    }}
  }}, {{ once: true }});
  setTimeout(() => {{
    if (!settled) {{
      settled = true;
      resolve({{ poster: "", duration }});
    }}
  }}, 1800);
}});
const findVideoItem = (id) => recordedVideos.find((entry) => entry.id === id);
const setVideoItem = (id, patch) => {{
  const item = findVideoItem(id);
  if (!item) return;
  Object.assign(item, patch);
  renderVideos();
}};
const videoUploadButtonText = (item) => {{
  if (item.uploadStatus === "completed") return "已上传";
  if (item.uploadStatus === "pending") return "等待接收";
  if (item.uploadStatus === "uploading") return `上传中 ${{item.uploadProgress || 0}}%`;
  if (item.uploadStatus === "failed" || item.uploadStatus === "rejected") return "重新上传";
  return "上传";
}};
const videoUploadLabel = (item) => {{
  if (item.uploadStatus === "completed") return "已上传";
  if (item.uploadStatus === "pending") return "待接收";
  if (item.uploadStatus === "uploading") return `上传中 ${{item.uploadProgress || 0}}%`;
  if (item.uploadStatus === "rejected") return "已拒绝";
  if (item.uploadStatus === "failed") return "上传失败";
  return "";
}};
const renderVideos = () => {{
  const el = document.getElementById("videos");
  if (recordedVideos.length === 0) {{
    el.innerHTML = '<div class="empty">暂无视频</div>';
    return;
  }}
  el.innerHTML = recordedVideos.map((item) => `
    <div class="video-card">
      <video class="video-cover" src="${{escapeHtml(item.url)}}" preload="auto" controls playsinline ${{item.poster ? `poster="${{escapeHtml(item.poster)}}"` : ""}}></video>
      <div class="video-info">
        <div class="upload-main">
          <div class="video-title">${{escapeHtml(item.name)}}</div>
          <div class="video-meta">${{formatSize(item.size)}} · ${{formatDuration(item.duration)}} · ${{escapeHtml(item.createdAt)}}${{videoUploadLabel(item) ? ` · <span class="status ${{escapeHtml(item.uploadStatus)}}">${{escapeHtml(videoUploadLabel(item))}}</span>` : ""}}</div>
        </div>
        <div class="video-actions">
          <button class="upload-button" type="button" data-upload-video="${{escapeHtml(item.id)}}" ${{["pending", "uploading", "completed"].includes(item.uploadStatus) ? "disabled" : ""}}>${{escapeHtml(videoUploadButtonText(item))}}</button>
          <button class="secondary-button" type="button" data-delete-video="${{escapeHtml(item.id)}}">删除</button>
        </div>
      </div>
    </div>
  `).join("");
  for (const video of el.querySelectorAll("video")) {{
    video.addEventListener("play", () => {{
      for (const other of el.querySelectorAll("video")) {{
        if (other !== video) other.pause();
      }}
    }});
  }}
  for (const button of el.querySelectorAll("[data-upload-video]")) {{
    button.addEventListener("click", (event) => {{
      event.stopPropagation();
      uploadRecordedVideo(button.getAttribute("data-upload-video"));
    }});
  }}
  for (const button of el.querySelectorAll("[data-delete-video]")) {{
    button.addEventListener("click", (event) => {{
      event.stopPropagation();
      deleteVideo(button.getAttribute("data-delete-video"));
    }});
  }}
}};
const addVideoFile = async (file) => {{
  const url = URL.createObjectURL(file);
  const now = new Date();
  const createdAt = `${{String(now.getHours()).padStart(2, "0")}}:${{String(now.getMinutes()).padStart(2, "0")}}:${{String(now.getSeconds()).padStart(2, "0")}}`;
  const item = {{
    id: `${{Date.now()}}-${{Math.random().toString(16).slice(2)}}`,
    name: file.name || "video",
    size: file.size,
    file,
    url,
    poster: "",
    duration: 0,
    createdAt,
    uploadStatus: "idle",
    uploadProgress: 0,
    uploadMessage: "",
  }};
  recordedVideos.unshift(item);
  renderVideos();
  const details = await readVideoDetails(url);
  item.poster = details.poster;
  item.duration = details.duration;
  renderVideos();
}};
const openVideoCapture = () => {{
  document.getElementById("video-input").click();
}};
const uploadVideoBinary = (videoId, record) => {{
  const item = findVideoItem(videoId);
  if (!item || !item.file) return;
  setVideoItem(videoId, {{ uploadStatus: "uploading", uploadProgress: 0, uploadMessage: "正在上传" }});
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `/api/upload/${{encodeURIComponent(record.id)}}`);
  xhr.upload.onprogress = (event) => {{
    if (event.lengthComputable) {{
      setVideoItem(videoId, {{ uploadProgress: Math.round((event.loaded / event.total) * 100) }});
    }}
  }};
  xhr.onload = () => {{
    if (xhr.status >= 200 && xhr.status < 300) {{
      setVideoItem(videoId, {{ uploadStatus: "completed", uploadProgress: 100, uploadMessage: "" }});
    }} else {{
      setVideoItem(videoId, {{ uploadStatus: "failed", uploadMessage: xhr.responseText || "上传失败" }});
    }}
  }};
  xhr.onerror = () => {{
    setVideoItem(videoId, {{ uploadStatus: "failed", uploadMessage: "网络错误" }});
  }};
  xhr.send(item.file);
}};
const pollVideoUpload = (videoId, batchId, recordId) => {{
  let started = false;
  const timer = setInterval(async () => {{
    const item = findVideoItem(videoId);
    if (!item) {{
      clearInterval(timer);
      return;
    }}
    try {{
      const status = await fetch(`/api/upload/batch/${{encodeURIComponent(batchId)}}`, {{ cache: "no-store" }}).then((r) => r.json());
      const record = (status.uploads || []).find((entry) => entry.id === recordId);
      if (!record) return;
      if (record.status === "rejected") {{
        setVideoItem(videoId, {{ uploadStatus: "rejected", uploadMessage: "电脑已拒绝" }});
        clearInterval(timer);
        return;
      }}
      if (record.status === "failed") {{
        setVideoItem(videoId, {{ uploadStatus: "failed", uploadMessage: record.error || "上传失败" }});
        clearInterval(timer);
        return;
      }}
      if (record.status === "completed") {{
        setVideoItem(videoId, {{ uploadStatus: "completed", uploadProgress: 100, uploadMessage: "" }});
        clearInterval(timer);
        return;
      }}
      if ((record.status === "accepted" || record.status === "uploading") && !started) {{
        started = true;
        uploadVideoBinary(videoId, record);
      }}
    }} catch (e) {{
      // 保持轮询，等待手机网络恢复。
    }}
  }}, 1000);
}};
const uploadRecordedVideo = async (id) => {{
  const item = findVideoItem(id);
  if (!item || !item.file || ["pending", "uploading", "completed"].includes(item.uploadStatus)) return;
  setVideoItem(id, {{ uploadStatus: "pending", uploadProgress: 0, uploadMessage: "等待电脑接收" }});
  try {{
    const durations = new Map([[item.file, item.duration]]);
    const prepared = await prepareUploads([item.file], durations);
    const record = (prepared.uploads || [])[0];
    if (!record) throw new Error("上传准备失败");
    setVideoItem(id, {{ uploadBatchId: prepared.batchId, uploadRecordId: record.id }});
    pollVideoUpload(id, prepared.batchId, record.id);
  }} catch (e) {{
    setVideoItem(id, {{ uploadStatus: "failed", uploadMessage: String(e.message || e) }});
  }}
}};
const deleteVideo = (id) => {{
  const index = recordedVideos.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  if (!confirm("确定删除这个视频吗？")) return;
  const [item] = recordedVideos.splice(index, 1);
  URL.revokeObjectURL(item.url);
  renderVideos();
}};
document.getElementById("tab-download").addEventListener("click", () => setTab("download"));
document.getElementById("tab-upload").addEventListener("click", () => setTab("upload"));
document.getElementById("tab-content").addEventListener("click", () => {{
  setTab("content");
  refreshContents();
}});
document.getElementById("tab-record").addEventListener("click", () => setTab("record"));
document.getElementById("upload-button").addEventListener("click", submitUpload);
document.getElementById("content-refresh").addEventListener("click", refreshContents);
document.getElementById("content-send").addEventListener("click", submitContent);
document.getElementById("video-add").addEventListener("click", openVideoCapture);
document.getElementById("video-input").addEventListener("change", async (event) => {{
  const file = event.target.files && event.target.files[0];
  if (file) await addVideoFile(file);
  event.target.value = "";
}});
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

#[tauri::command]
pub fn cmd_set_share_upload_dir(
    manager: tauri::State<'_, Arc<ShareManager>>,
    path: String,
) -> Result<ShareServerState, String> {
    manager.set_upload_dir(path)
}

#[tauri::command]
pub fn cmd_accept_share_upload(
    manager: tauri::State<'_, Arc<ShareManager>>,
    id: String,
) -> Result<ShareServerState, String> {
    manager.accept_upload(id)
}

#[tauri::command]
pub fn cmd_reject_share_upload(
    manager: tauri::State<'_, Arc<ShareManager>>,
    id: String,
) -> Result<ShareServerState, String> {
    manager.reject_upload(id)
}

#[tauri::command]
pub fn cmd_accept_share_upload_batch(
    manager: tauri::State<'_, Arc<ShareManager>>,
    batch_id: String,
) -> Result<ShareServerState, String> {
    manager.accept_upload_batch(batch_id)
}

#[tauri::command]
pub fn cmd_reject_share_upload_batch(
    manager: tauri::State<'_, Arc<ShareManager>>,
    batch_id: String,
) -> Result<ShareServerState, String> {
    manager.reject_upload_batch(batch_id)
}

#[tauri::command]
pub fn cmd_clear_share_uploads(
    manager: tauri::State<'_, Arc<ShareManager>>,
) -> Result<ShareServerState, String> {
    manager.clear_uploads()
}

#[tauri::command]
pub fn cmd_delete_share_upload(
    manager: tauri::State<'_, Arc<ShareManager>>,
    id: String,
    delete_file: bool,
) -> Result<ShareServerState, String> {
    manager.delete_upload(id, delete_file)
}

#[tauri::command]
pub fn cmd_add_share_content(
    manager: tauri::State<'_, Arc<ShareManager>>,
    text: String,
) -> Result<ShareServerState, String> {
    manager.add_pc_content(text)
}

#[tauri::command]
pub fn cmd_remove_share_content(
    manager: tauri::State<'_, Arc<ShareManager>>,
    id: String,
) -> Result<ShareServerState, String> {
    manager.remove_content(id)
}

#[tauri::command]
pub fn cmd_clear_share_contents(
    manager: tauri::State<'_, Arc<ShareManager>>,
) -> Result<ShareServerState, String> {
    manager.clear_contents()
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

fn read_uploads(path: &PathBuf) -> Result<Vec<ShareUploadRecord>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("读取上传记录失败: {}", e))?;
    let mut uploads: Vec<ShareUploadRecord> =
        serde_json::from_str(&content).map_err(|e| format!("解析上传记录失败: {}", e))?;
    let now = now_string();
    let mut changed = false;
    for upload in &mut uploads {
        if matches!(
            upload.status,
            ShareUploadStatus::Pending | ShareUploadStatus::Accepted | ShareUploadStatus::Uploading
        ) {
            if let (Some(path), Some(saved_name)) = (&upload.path, &upload.saved_name) {
                let tmp_path = path.with_file_name(format!("{}.part", saved_name));
                let _ = fs::remove_file(tmp_path);
            }
            upload.status = ShareUploadStatus::Failed;
            upload.updated_at = now.clone();
            upload.completed_at = Some(now.clone());
            upload.error = Some("应用重启，上传已中断".to_string());
            changed = true;
        }
    }
    uploads.truncate(MAX_UPLOAD_RECORDS);
    if changed {
        write_json(path, &uploads)?;
    }
    Ok(uploads)
}

fn read_contents(path: &PathBuf) -> Result<Vec<ShareContentItem>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("读取互传内容失败: {}", e))?;
    let mut contents: Vec<ShareContentItem> =
        serde_json::from_str(&content).map_err(|e| format!("解析互传内容失败: {}", e))?;
    contents.truncate(MAX_CONTENT_RECORDS);
    Ok(contents)
}

fn read_settings(path: &PathBuf) -> Result<ShareSettings, String> {
    if !path.exists() {
        return Ok(ShareSettings::default());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("读取共享设置失败: {}", e))?;
    let mut settings: ShareSettings =
        serde_json::from_str(&content).map_err(|e| format!("解析共享设置失败: {}", e))?;
    settings.port = normalize_port(settings.port).unwrap_or(DEFAULT_PORT);
    if let Some(path) = settings.upload_save_dir.as_ref() {
        if !path.is_dir() {
            settings.upload_save_dir = None;
        }
    }
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

fn header_value<'a>(headers: &'a [(String, String)], key: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.as_str())
}

fn read_exact_body<R: Read>(reader: &mut R, content_length: u64) -> io::Result<Vec<u8>> {
    let mut body = vec![0u8; content_length as usize];
    reader.read_exact(&mut body)?;
    Ok(body)
}

fn now_string() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

fn sanitize_filename(name: &str) -> String {
    let name = name
        .split(['/', '\\'])
        .next_back()
        .unwrap_or(name)
        .trim()
        .trim_matches('.');
    let mut value = String::new();
    for ch in name.chars() {
        if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control() {
            value.push('_');
        } else {
            value.push(ch);
        }
    }
    if value.is_empty() {
        "upload".to_string()
    } else {
        value
    }
}

fn create_unique_upload_file(
    dir: &Path,
    original_name: &str,
) -> io::Result<(String, PathBuf, PathBuf, File)> {
    let original = PathBuf::from(original_name);
    let stem = original
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("upload");
    let ext = original.extension().and_then(|s| s.to_str()).unwrap_or("");
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();

    for index in 1..=999 {
        let suffix = if index == 1 {
            String::new()
        } else {
            format!("_{}", index)
        };
        let name = if ext.is_empty() {
            format!("{}_{}{}", stem, timestamp, suffix)
        } else {
            format!("{}_{}{}.{}", stem, timestamp, suffix, ext)
        };
        let path = dir.join(&name);
        let tmp_path = path.with_file_name(format!("{}.part", name));
        if path.exists() || tmp_path.exists() {
            continue;
        }

        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
        {
            Ok(file) if path.exists() => {
                drop(file);
                let _ = fs::remove_file(&tmp_path);
                continue;
            }
            Ok(file) => return Ok((name, path, tmp_path, file)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }

    let fallback = if ext.is_empty() {
        format!("{}_{}_{}", stem, timestamp, Uuid::new_v4())
    } else {
        format!("{}_{}_{}.{}", stem, timestamp, Uuid::new_v4(), ext)
    };
    let path = dir.join(&fallback);
    let tmp_path = path.with_file_name(format!("{}.part", fallback));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)?;
    Ok((fallback, path, tmp_path, file))
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
