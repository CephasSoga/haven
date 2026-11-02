/// Haven as an installed app: the same web app, in the system web view, plus a native
/// HTTP client so the Morning feed can read news feeds without a local server.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running Haven");
}
