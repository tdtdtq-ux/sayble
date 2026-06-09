use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, Monitor, WebviewUrl, WindowEvent};
use url::Url;
use uuid::Uuid;

pub const LIVE_WINDOW_NAV_HEIGHT: f64 = 40.0;
pub const LIVE_WINDOW_MIN_CONTENT_WIDTH: u32 = 200;
pub const LIVE_WINDOW_MIN_CONTENT_HEIGHT: u32 = 200;
pub const LIVE_WINDOW_MAX_CONTENT_WIDTH: u32 = 3840;
pub const LIVE_WINDOW_MAX_CONTENT_HEIGHT: u32 = 3840;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveWindowOpenRequest {
    pub id: String,
    pub name: String,
    pub url: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LiveWindowLabels {
    pub window: String,
    pub nav: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LiveWindowSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LiveWindowChildLayout {
    pub width: u32,
    pub nav_height: u32,
    pub content_y: i32,
    pub content_height: u32,
    pub total_height: u32,
}

pub fn build_live_window_labels(id: &str) -> LiveWindowLabels {
    let safe_id = sanitize_live_window_id(id).unwrap_or_else(|| "window".to_string());
    let base = format!("live-window-{}", safe_id);

    LiveWindowLabels {
        window: base.clone(),
        nav: format!("live-window-nav-{}", safe_id),
        content: format!("live-content-{}", safe_id),
    }
}

pub fn parse_live_window_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|e| format!("无效 URL: {}", e))?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        _ => Err("仅支持 http:// 或 https:// URL".to_string()),
    }
}

pub fn live_window_size(request: &LiveWindowOpenRequest) -> LiveWindowSize {
    LiveWindowSize {
        width: request.width as f64,
        height: request.height as f64 + LIVE_WINDOW_NAV_HEIGHT,
    }
}

pub fn live_window_uses_system_decorations() -> bool {
    false
}

pub fn live_window_child_layout(
    request: &LiveWindowOpenRequest,
    scale_factor: f64,
) -> LiveWindowChildLayout {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let width = scale_dimension(request.width as f64, scale);
    let nav_height = scale_dimension(LIVE_WINDOW_NAV_HEIGHT, scale);
    let content_height = scale_dimension(request.height as f64, scale);

    LiveWindowChildLayout {
        width,
        nav_height,
        content_y: nav_height as i32,
        content_height,
        total_height: nav_height.saturating_add(content_height),
    }
}

pub fn centered_live_window_position(
    work_x: i32,
    work_y: i32,
    work_width: u32,
    work_height: u32,
    window_width: u32,
    window_height: u32,
) -> tauri::PhysicalPosition<i32> {
    let x = if window_width >= work_width {
        work_x
    } else {
        work_x + ((work_width - window_width) / 2) as i32
    };
    let y = if window_height >= work_height {
        work_y
    } else {
        work_y + ((work_height - window_height) / 2) as i32
    };

    tauri::PhysicalPosition::new(x, y)
}

#[tauri::command]
pub async fn cmd_open_live_window(
    app: tauri::AppHandle,
    config: LiveWindowOpenRequest,
) -> Result<(), String> {
    validate_request(&config)?;
    let target_url = parse_live_window_url(&config.url)?;
    let instance_id = format!(
        "{}-{}",
        sanitize_live_window_id(&config.id).ok_or_else(|| "直播窗口 ID 不能为空".to_string())?,
        Uuid::new_v4().simple()
    );
    let labels = build_live_window_labels(&instance_id);
    let size = live_window_size(&config);
    let target_monitor = live_window_target_monitor(&app);
    let scale_factor = target_monitor
        .as_ref()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);
    let child_layout = live_window_child_layout(&config, scale_factor);

    let window = tauri::window::WindowBuilder::new(&app, labels.window.clone())
        .title(config.name.clone())
        .inner_size(size.width, size.height)
        .min_inner_size(
            LIVE_WINDOW_MIN_CONTENT_WIDTH as f64,
            LIVE_WINDOW_NAV_HEIGHT + LIVE_WINDOW_MIN_CONTENT_HEIGHT as f64,
        )
        .decorations(live_window_uses_system_decorations())
        .resizable(false)
        .visible(false)
        .build()
        .map_err(|e| format!("创建直播窗口失败: {}", e))?;
    if let Some(monitor) = target_monitor.as_ref() {
        let work_area = monitor.work_area();
        let position = centered_live_window_position(
            work_area.position.x,
            work_area.position.y,
            work_area.size.width,
            work_area.size.height,
            child_layout.width,
            child_layout.total_height,
        );
        if let Err(e) = window.set_position(position) {
            log::warn!("[live-window] failed to position on target monitor: {}", e);
        }
    }
    log::info!(
        "[live-window] open id={}, logical={}x{}, scale={}, child_physical={}x{}",
        config.id,
        size.width,
        size.height,
        scale_factor,
        child_layout.width,
        child_layout.total_height
    );

    let nav_url = format!(
        "index.html?window=live-browser-nav&id={}&url={}",
        encode_query(&instance_id),
        encode_query(target_url.as_str())
    );
    let nav_builder =
        tauri::webview::WebviewBuilder::new(labels.nav.clone(), WebviewUrl::App(nav_url.into()));

    window
        .add_child(
            nav_builder,
            tauri::PhysicalPosition::new(0, 0),
            tauri::PhysicalSize::new(child_layout.width, child_layout.nav_height),
        )
        .map_err(|e| format!("创建直播窗口导航栏失败: {}", e))?;

    let nav_label = labels.nav.clone();
    let app_for_navigation = app.clone();
    let content_builder = tauri::webview::WebviewBuilder::new(
        labels.content.clone(),
        WebviewUrl::External(target_url),
    )
    .on_navigation(move |url| {
        if let Err(e) = app_for_navigation.emit_to(
            &nav_label,
            "live-window-url-changed",
            url.as_str().to_string(),
        ) {
            log::warn!("[live-window] failed to emit url change: {}", e);
        }
        true
    });

    window
        .add_child(
            content_builder,
            tauri::PhysicalPosition::new(0, child_layout.content_y),
            tauri::PhysicalSize::new(child_layout.width, child_layout.content_height),
        )
        .map_err(|e| format!("创建直播窗口网页内容失败: {}", e))?;
    register_live_window_resize_handler(&app, &window, labels.clone(), config.clone());

    window
        .show()
        .map_err(|e| format!("显示直播窗口失败: {}", e))?;
    window
        .set_focus()
        .map_err(|e| format!("聚焦直播窗口失败: {}", e))?;

    Ok(())
}

fn register_live_window_resize_handler(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    labels: LiveWindowLabels,
    config: LiveWindowOpenRequest,
) {
    let app_handle = app.clone();
    let window_handle = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
            resize_live_window_children(&app_handle, &labels, &config, *scale_factor);
        }
        WindowEvent::Moved(_) => {
            if let Ok(Some(monitor)) = window_handle.current_monitor() {
                resize_live_window_children(&app_handle, &labels, &config, monitor.scale_factor());
            }
        }
        _ => {}
    });
}

fn resize_live_window_children(
    app: &tauri::AppHandle,
    labels: &LiveWindowLabels,
    config: &LiveWindowOpenRequest,
    scale_factor: f64,
) {
    let layout = live_window_child_layout(config, scale_factor);
    if let Some(nav) = app.get_webview(&labels.nav) {
        if let Err(e) = nav.set_position(tauri::PhysicalPosition::new(0, 0)) {
            log::warn!("[live-window] failed to reposition nav webview: {}", e);
        }
        if let Err(e) = nav.set_size(tauri::PhysicalSize::new(layout.width, layout.nav_height)) {
            log::warn!("[live-window] failed to resize nav webview: {}", e);
        }
    }
    if let Some(content) = app.get_webview(&labels.content) {
        if let Err(e) = content.set_position(tauri::PhysicalPosition::new(0, layout.content_y)) {
            log::warn!("[live-window] failed to reposition content webview: {}", e);
        }
        if let Err(e) = content.set_size(tauri::PhysicalSize::new(
            layout.width,
            layout.content_height,
        )) {
            log::warn!("[live-window] failed to resize content webview: {}", e);
        }
    }
}

fn live_window_target_monitor(app: &tauri::AppHandle) -> Option<Monitor> {
    app.get_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| {
            app.cursor_position().ok().and_then(|position| {
                app.monitor_from_point(position.x, position.y)
                    .ok()
                    .flatten()
            })
        })
        .or_else(|| app.primary_monitor().ok().flatten())
}

#[tauri::command]
pub fn cmd_live_window_navigate(
    app: tauri::AppHandle,
    id: String,
    url: String,
) -> Result<(), String> {
    let target_url = parse_live_window_url(&url)?;
    let webview = live_window_content_webview(&app, &id)?;
    webview
        .navigate(target_url)
        .map_err(|e| format!("跳转失败: {}", e))
}

#[tauri::command]
pub fn cmd_live_window_reload(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let webview = live_window_content_webview(&app, &id)?;
    webview.reload().map_err(|e| format!("刷新失败: {}", e))
}

#[tauri::command]
pub fn cmd_live_window_go_back(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let webview = live_window_content_webview(&app, &id)?;
    webview
        .eval("window.history.back();")
        .map_err(|e| format!("后退失败: {}", e))
}

#[tauri::command]
pub fn cmd_live_window_go_forward(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let webview = live_window_content_webview(&app, &id)?;
    webview
        .eval("window.history.forward();")
        .map_err(|e| format!("前进失败: {}", e))
}

#[tauri::command]
pub fn cmd_live_window_close(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let labels = build_live_window_labels(&id);
    let window = app
        .get_window(&labels.window)
        .ok_or_else(|| "直播窗口不存在".to_string())?;
    window.close().map_err(|e| format!("关闭失败: {}", e))
}

fn validate_request(request: &LiveWindowOpenRequest) -> Result<(), String> {
    if sanitize_live_window_id(&request.id).is_none() {
        return Err("直播窗口 ID 不能为空".to_string());
    }
    if request.name.trim().is_empty() {
        return Err("直播窗口名称不能为空".to_string());
    }
    if request.width < LIVE_WINDOW_MIN_CONTENT_WIDTH
        || request.width > LIVE_WINDOW_MAX_CONTENT_WIDTH
    {
        return Err(format!(
            "内容宽度需在 {} 到 {} 之间",
            LIVE_WINDOW_MIN_CONTENT_WIDTH, LIVE_WINDOW_MAX_CONTENT_WIDTH
        ));
    }
    if request.height < LIVE_WINDOW_MIN_CONTENT_HEIGHT
        || request.height > LIVE_WINDOW_MAX_CONTENT_HEIGHT
    {
        return Err(format!(
            "内容高度需在 {} 到 {} 之间",
            LIVE_WINDOW_MIN_CONTENT_HEIGHT, LIVE_WINDOW_MAX_CONTENT_HEIGHT
        ));
    }

    Ok(())
}

fn sanitize_live_window_id(id: &str) -> Option<String> {
    let safe_id: String = id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let safe_id = safe_id.trim_matches('-').to_string();
    if safe_id.is_empty() {
        None
    } else {
        Some(safe_id)
    }
}

fn live_window_content_webview(app: &tauri::AppHandle, id: &str) -> Result<tauri::Webview, String> {
    let labels = build_live_window_labels(id);
    app.get_webview(&labels.content)
        .ok_or_else(|| "直播窗口网页内容不存在".to_string())
}

fn scale_dimension(value: f64, scale_factor: f64) -> u32 {
    (value * scale_factor).round().max(1.0) as u32
}

fn encode_query(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}
