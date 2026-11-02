/// Haven as an installed app: the same web app, in the system web view, plus native pieces:
/// an HTTP client (news feeds, update checks), notifications (reminders), opening links,
/// and on desktop, installing updates in place.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder.run(tauri::generate_context!()).expect("error while running Haven");
}
