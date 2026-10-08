fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        for library in ["gdi32", "user32", "crypt32", "ws2_32", "advapi32"] {
            println!("cargo:rustc-link-lib=dylib={library}");
        }
    }
    tauri_build::build()
}
