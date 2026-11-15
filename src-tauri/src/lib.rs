use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri::Manager;

/// Whether closing the window keeps Haven running in the tray (Settings → Desktop app).
struct Background(AtomicBool);

#[tauri::command]
fn set_run_in_background(state: tauri::State<Background>, on: bool) {
    state.0.store(on, Ordering::Relaxed);
}

/// Brings the main window back, from the tray or when Haven is launched a second time.
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        #[cfg(desktop)]
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Haven as an installed app: the same web app, in the system web view, plus native pieces:
/// an HTTP client (news feeds, update checks), notifications (reminders), opening links,
/// and on desktop, installing updates in place, a tray icon, running in the background
/// once the window is closed, and opening when the computer starts.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Must come first: launching Haven again just brings back the running one.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)));

    let builder = builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(Background(AtomicBool::new(true)))
        .invoke_handler(tauri::generate_handler![set_run_in_background]);

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Started with the computer: open quietly in the tray.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<Background>().0.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });

    let builder = builder.setup(|app| {
        #[cfg(desktop)]
        {
            let open = MenuItem::with_id(app, "open", "Open Haven", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Haven", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::with_id("haven")
                .tooltip("Haven")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // The window starts hidden (tauri.conf.json) so a start with the computer doesn't flash it.
            if !std::env::args().any(|a| a == "--hidden") {
                show_main(app.handle());
            }
        }
        #[cfg(mobile)]
        show_main(app.handle());
        Ok(())
    });

    builder.run(tauri::generate_context!()).expect("error while running Haven");
}
