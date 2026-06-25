use crate::storage::product_bootstrap::{self, BootstrapRunResult, ProductBootstrapStatus};

#[tauri::command]
pub fn get_product_bootstrap_status() -> Result<ProductBootstrapStatus, String> {
    product_bootstrap::get_status()
}

#[tauri::command]
pub fn run_product_bootstrap(force: bool) -> Result<BootstrapRunResult, String> {
    if force {
        product_bootstrap::run_force()
    } else {
        product_bootstrap::run_if_needed()
    }
}
