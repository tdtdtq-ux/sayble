use sayble_lib::live_window::{
    build_live_window_labels, centered_live_window_position, live_window_child_layout,
    live_window_size, live_window_uses_system_decorations, parse_live_window_url,
    LiveWindowOpenRequest, LIVE_WINDOW_NAV_HEIGHT,
};

#[test]
fn builds_stable_labels_from_id() {
    let labels = build_live_window_labels("bilibili-dashboard");

    assert_eq!(labels.window, "live-window-bilibili-dashboard");
    assert_eq!(labels.nav, "live-window-nav-bilibili-dashboard");
    assert_eq!(labels.content, "live-content-bilibili-dashboard");
}

#[test]
fn keeps_external_content_label_out_of_live_window_permission_scope() {
    let labels = build_live_window_labels("bilibili-dashboard");

    assert!(labels.window.starts_with("live-window-"));
    assert!(labels.nav.starts_with("live-window-"));
    assert!(!labels.content.starts_with("live-window-"));
}

#[test]
fn parses_only_http_and_https_urls() {
    assert!(parse_live_window_url("https://example.com/live").is_ok());
    assert!(parse_live_window_url("http://localhost:1420").is_ok());
    assert!(parse_live_window_url("file:///C:/secret.txt").is_err());
    assert!(parse_live_window_url("not a url").is_err());
}

#[test]
fn adds_navigation_height_to_parent_window() {
    let request = LiveWindowOpenRequest {
        id: "id-1".to_string(),
        name: "直播后台".to_string(),
        url: "https://example.com".to_string(),
        width: 900,
        height: 1200,
    };

    let size = live_window_size(&request);

    assert_eq!(size.width, 900.0);
    assert_eq!(size.height, 1200.0 + LIVE_WINDOW_NAV_HEIGHT);
}

#[test]
fn live_window_uses_custom_chrome_instead_of_system_titlebar() {
    assert!(!live_window_uses_system_decorations());
}

#[test]
fn scales_child_webviews_to_match_dpi_scaled_parent_window() {
    let request = LiveWindowOpenRequest {
        id: "id-1".to_string(),
        name: "直播后台".to_string(),
        url: "https://example.com".to_string(),
        width: 1400,
        height: 1867,
    };

    let layout = live_window_child_layout(&request, 1.5);

    assert_eq!(layout.width, 2100);
    assert_eq!(layout.nav_height, 60);
    assert_eq!(layout.content_height, 2801);
    assert_eq!(layout.total_height, 2861);
    assert_eq!(layout.content_y, 60);
}

#[test]
fn centers_window_when_it_fits_target_work_area() {
    let position = centered_live_window_position(1920, -1070, 2560, 1392, 1400, 1000);

    assert_eq!(position.x, 2500);
    assert_eq!(position.y, -874);
}

#[test]
fn pins_oversized_window_to_work_area_origin() {
    let position = centered_live_window_position(1920, -1070, 2560, 1392, 2100, 2861);

    assert_eq!(position.x, 2150);
    assert_eq!(position.y, -1070);
}
