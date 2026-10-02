use std::{fs, path::Path};

fn is_ink_path(path: &str) -> bool {
  Path::new(path)
    .extension()
    .and_then(|extension| extension.to_str())
    .is_some_and(|extension| extension.eq_ignore_ascii_case("ink"))
}

#[tauri::command]
fn startup_ink_path() -> Option<String> {
  std::env::args().skip(1).find(|arg| is_ink_path(arg))
}

#[tauri::command]
fn read_ink_file(path: String) -> Result<String, String> {
  if !is_ink_path(&path) {
    return Err("Ink can only open .ink documents.".into());
  }

  fs::read_to_string(&path).map_err(|error| format!("Could not open the Ink document: {error}"))
}

#[tauri::command]
fn write_ink_file(path: String, text: String) -> Result<(), String> {
  if !is_ink_path(&path) {
    return Err("Ink can only save .ink documents.".into());
  }

  fs::write(&path, text).map_err(|error| format!("Could not save the Ink document: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![startup_ink_path, read_ink_file, write_ink_file])
    .run(tauri::generate_context!())
    .expect("error while running Ink");
}
