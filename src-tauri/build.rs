fn main() {
    // 生成编译时间戳
    let build_time = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    println!("cargo:rustc-env=BUILD_TIME={}", build_time);

    let mut attrs = tauri_build::Attributes::new();

    #[cfg(windows)]
    {
        attrs = attrs.windows_attributes(
            tauri_build::WindowsAttributes::new().app_manifest(include_str!("build.manifest")),
        );
    }

    tauri_build::try_build(attrs).expect("failed to run tauri build script");
}
