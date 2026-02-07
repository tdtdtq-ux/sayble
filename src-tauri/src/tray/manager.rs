use crate::config::AppState;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use std::sync::{Arc, Mutex};

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
        let settings_item = MenuItemBuilder::with_id("settings", "设置").build(app)?;
        let about_item = MenuItemBuilder::with_id("about", "关于").build(app)?;
        let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;

        let menu = MenuBuilder::new(app)
            .item(&settings_item)
            .item(&about_item)
            .separator()
            .item(&quit_item)
            .build()?;

        let _tray = TrayIconBuilder::new()
            .icon(Image::from_bytes(include_bytes!("../../icons/32x32.png"))?)
            .tooltip("Voice Keyboard - 空闲")
            .menu(&menu)
            .on_menu_event(move |app, event| {
                match event.id().as_ref() {
                    "settings" => {
                        // 打开设置窗口
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "about" => {
                        log::info!("Voice Keyboard v0.1.0");
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
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
                    let _ = app.emit("tray-toggle-recording", ());
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
            AppState::Idle => "Voice Keyboard - 空闲",
            AppState::Recording => "Voice Keyboard - 录音中...",
            AppState::Recognizing => "Voice Keyboard - 识别中...",
        };

        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(tooltip));
        }
    }

    pub fn get_state(&self) -> AppState {
        self.state.lock().map(|s| *s).unwrap_or(AppState::Idle)
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
