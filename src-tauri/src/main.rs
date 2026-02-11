// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 在日志系统初始化之前设置 panic hook，确保崩溃信息能被记录
    let crash_log = sayble_lib::store::base_dir().join("logs").join("crash.log");
    std::panic::set_hook(Box::new(move |info| {
        let _ = std::fs::create_dir_all(crash_log.parent().unwrap());
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let msg = format!("[{}] PANIC: {}\n", timestamp, info);
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&crash_log)
            .and_then(|mut f| std::io::Write::write_all(&mut f, msg.as_bytes()));
    }));

    sayble_lib::run()
}
