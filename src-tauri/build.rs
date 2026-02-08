fn main() {
    let mut attrs = tauri_build::Attributes::new();

    #[cfg(windows)]
    {
        attrs = attrs.windows_attributes(
            tauri_build::WindowsAttributes::new().app_manifest(include_str!("build.manifest")),
        );
    }

    tauri_build::try_build(attrs).expect("failed to run tauri build script");
}
