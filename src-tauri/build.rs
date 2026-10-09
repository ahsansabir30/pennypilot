include!("src/app_commands.rs");

fn main() {
    println!("cargo:rerun-if-changed=src/app_commands.rs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        for library in ["gdi32", "user32", "crypt32", "ws2_32", "advapi32"] {
            println!("cargo:rustc-link-lib=dylib={library}");
        }
    }
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to generate Tauri ACL");
}
