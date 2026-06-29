//! Browser Profile管理
//!
//! 管理浏览器Profile的CRUD操作和持久化

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::RwLock;
use uuid::Uuid;

/// Browser Profile配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserProfile {
    pub id: String,
    pub name: String,
    pub engine: String, // "chrome" | "webview"
    pub data_directory: PathBuf,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub allowed_origins: Vec<String>,
}

/// Profile持久化存储
#[derive(Debug, Serialize, Deserialize)]
struct ProfileStore {
    profiles: HashMap<String, BrowserProfile>,
}

/// Profile管理器
pub struct ProfileManager {
    base_dir: PathBuf,
    profiles: RwLock<HashMap<String, BrowserProfile>>,
}

impl ProfileManager {
    /// 创建新的Profile管理器
    pub fn new(base_dir: PathBuf) -> Result<Self, String> {
        let profiles_dir = base_dir.join("profiles");
        std::fs::create_dir_all(&profiles_dir)
            .map_err(|e| format!("Failed to create profiles dir: {}", e))?;

        let store_path = base_dir.join("profiles.json");
        let profiles = if store_path.exists() {
            let content = std::fs::read_to_string(&store_path)
                .map_err(|e| format!("Failed to read profiles.json: {}", e))?;
            let store: ProfileStore = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse profiles.json: {}", e))?;
            store.profiles
        } else {
            HashMap::new()
        };

        Ok(Self {
            base_dir,
            profiles: RwLock::new(profiles),
        })
    }

    /// 持久化profiles到磁盘
    async fn save(&self) -> Result<(), String> {
        let profiles = self.profiles.read().await;
        let store = ProfileStore {
            profiles: profiles.clone(),
        };
        let content = serde_json::to_string_pretty(&store)
            .map_err(|e| format!("Failed to serialize profiles: {}", e))?;
        let store_path = self.base_dir.join("profiles.json");
        tokio::fs::write(&store_path, content)
            .await
            .map_err(|e| format!("Failed to write profiles.json: {}", e))?;
        Ok(())
    }

    /// 创建新Profile
    pub async fn create_profile(
        &self,
        name: String,
        engine: String,
    ) -> Result<BrowserProfile, String> {
        let id = Uuid::new_v4().to_string();
        let data_directory = self.base_dir.join("profiles").join(&id);

        // 创建Profile数据目录
        tokio::fs::create_dir_all(&data_directory)
            .await
            .map_err(|e| format!("Failed to create profile dir: {}", e))?;

        let profile = BrowserProfile {
            id: id.clone(),
            name,
            engine,
            data_directory,
            created_at: Utc::now(),
            last_used_at: None,
            allowed_origins: Vec::new(),
        };

        let mut profiles = self.profiles.write().await;
        profiles.insert(id, profile.clone());
        drop(profiles);

        self.save().await?;
        log::info!(
            "[browser] Created profile: {} ({})",
            profile.name,
            profile.id
        );

        Ok(profile)
    }

    /// 列出所有Profile
    pub async fn list_profiles(&self) -> Vec<BrowserProfile> {
        let profiles = self.profiles.read().await;
        profiles.values().cloned().collect()
    }

    /// 获取Profile详情
    pub async fn get_profile(&self, profile_id: &str) -> Option<BrowserProfile> {
        let profiles = self.profiles.read().await;
        profiles.get(profile_id).cloned()
    }

    /// 更新最后使用时间
    pub async fn update_last_used(&self, profile_id: &str) -> Result<(), String> {
        let mut profiles = self.profiles.write().await;
        if let Some(profile) = profiles.get_mut(profile_id) {
            profile.last_used_at = Some(Utc::now());
            drop(profiles);
            self.save().await?;
            Ok(())
        } else {
            Err(format!("Profile not found: {}", profile_id))
        }
    }

    /// 删除Profile
    pub async fn delete_profile(&self, profile_id: &str) -> Result<(), String> {
        let mut profiles = self.profiles.write().await;
        if let Some(profile) = profiles.remove(profile_id) {
            // 删除Profile数据目录
            if profile.data_directory.exists() {
                tokio::fs::remove_dir_all(&profile.data_directory)
                    .await
                    .map_err(|e| format!("Failed to delete profile dir: {}", e))?;
            }
            drop(profiles);
            self.save().await?;
            log::info!("[browser] Deleted profile: {}", profile_id);
            Ok(())
        } else {
            Err(format!("Profile not found: {}", profile_id))
        }
    }

    /// 添加允许的origin
    pub async fn add_allowed_origin(&self, profile_id: &str, origin: String) -> Result<(), String> {
        let mut profiles = self.profiles.write().await;
        if let Some(profile) = profiles.get_mut(profile_id) {
            if !profile.allowed_origins.contains(&origin) {
                profile.allowed_origins.push(origin);
                drop(profiles);
                self.save().await?;
            }
            Ok(())
        } else {
            Err(format!("Profile not found: {}", profile_id))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_profile_manager_crud() {
        let temp_dir = tempdir().unwrap();
        let manager = ProfileManager::new(temp_dir.path().to_path_buf()).unwrap();

        // 创建Profile
        let profile = manager
            .create_profile("test".to_string(), "chrome".to_string())
            .await
            .unwrap();
        assert_eq!(profile.name, "test");
        assert_eq!(profile.engine, "chrome");

        // 列出Profile
        let profiles = manager.list_profiles().await;
        assert_eq!(profiles.len(), 1);

        // 获取Profile
        let fetched = manager.get_profile(&profile.id).await.unwrap();
        assert_eq!(fetched.id, profile.id);

        // 更新最后使用时间
        manager.update_last_used(&profile.id).await.unwrap();
        let updated = manager.get_profile(&profile.id).await.unwrap();
        assert!(updated.last_used_at.is_some());

        // 删除Profile
        manager.delete_profile(&profile.id).await.unwrap();
        assert!(manager.get_profile(&profile.id).await.is_none());
    }

    #[tokio::test]
    async fn test_profile_persistence() {
        let temp_dir = tempdir().unwrap();
        let manager = ProfileManager::new(temp_dir.path().to_path_buf()).unwrap();

        // 创建Profile
        manager
            .create_profile("test".to_string(), "chrome".to_string())
            .await
            .unwrap();

        // 重新加载
        let manager2 = ProfileManager::new(temp_dir.path().to_path_buf()).unwrap();
        let profiles = manager2.list_profiles().await;
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, "test");
    }
}
