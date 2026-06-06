use crate::config::AppState;
use crate::tunnel::TunnelManager;
use std::sync::{Arc, Mutex};
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub struct TrayManager {
    state: Arc<Mutex<AppState>>,
}

impl TrayManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(AppState::Idle)),
        }
    }

    pub fn state(&self) -> Arc<Mutex<AppState>> {
        self.state.clone()
    }

    pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
        let menu = MenuBuilder::new(app).item(&quit_item).build()?;

        let _tray = TrayIconBuilder::new()
            .icon(Image::from_bytes(include_bytes!("../../icons/32x32.png"))?)
            .tooltip("Sayble - 空闲")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(move |app, event| {
                if event.id().as_ref() == "quit" {
                    if let Some(manager) = app.try_state::<Arc<TunnelManager>>() {
                        manager.stop_all();
                    }
                    app.exit(0);
                }
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray.app_handle();
                    log::info!("[tray] left click: show home");
                    show_main_window(app);
                    let _ = app.emit("show-home", ());
                }
            })
            .build(app)?;

        Ok(())
    }

    pub fn update_state(&self, app: &AppHandle, new_state: AppState) {
        if let Ok(mut state) = self.state.lock() {
            *state = new_state;
        }

        let tooltip = match new_state {
            AppState::Idle => "Sayble - 空闲",
            AppState::Recording => "Sayble - 录音中...",
            AppState::Recognizing => "Sayble - 识别中...",
        };

        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(tooltip));
        }
    }

    pub fn get_state(&self) -> AppState {
        self.state.lock().map(|s| *s).unwrap_or(AppState::Idle)
    }
}

fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("[tray] main window not found");
        return;
    };

    if let Err(e) = window.show() {
        log::error!("[tray] failed to show main window: {}", e);
    }
    if let Err(e) = window.unminimize() {
        log::warn!("[tray] failed to unminimize main window: {}", e);
    }
    if let Err(e) = window.set_focus() {
        log::warn!("[tray] failed to focus main window: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tray_manager_new() {
        let manager = TrayManager::new();
        assert_eq!(manager.get_state(), AppState::Idle);
    }

    #[test]
    fn test_tray_manager_state_arc() {
        let manager = TrayManager::new();
        let state = manager.state();
        {
            let mut s = state.lock().unwrap();
            *s = AppState::Recording;
        }
        assert_eq!(manager.get_state(), AppState::Recording);
    }

    #[test]
    fn test_tray_manager_get_state_default() {
        let manager = TrayManager::new();
        let state = manager.get_state();
        assert_eq!(state, AppState::Idle);
    }
}
