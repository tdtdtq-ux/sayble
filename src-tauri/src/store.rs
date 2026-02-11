use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct JsonStore {
    path: PathBuf,
    data: Mutex<HashMap<String, Value>>,
}

impl JsonStore {
    pub fn new(path: PathBuf) -> Self {
        let data = if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
                Err(e) => {
                    log::warn!("[store] failed to read {}: {}", path.display(), e);
                    HashMap::new()
                }
            }
        } else {
            HashMap::new()
        };
        Self {
            path,
            data: Mutex::new(data),
        }
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        let data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        data.get(key).cloned()
    }

    pub fn set(&self, key: &str, value: Value) {
        let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        data.insert(key.to_string(), value);
    }

    pub fn entries(&self) -> Vec<(String, Value)> {
        let data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        data.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn save(&self) -> Result<(), String> {
        let data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        let json = serde_json::to_string_pretty(&*data)
            .map_err(|e| format!("Failed to serialize: {}", e))?;

        let tmp_path = self.path.with_extension("json.tmp");
        fs::write(&tmp_path, &json)
            .map_err(|e| format!("Failed to write {}: {}", tmp_path.display(), e))?;
        fs::rename(&tmp_path, &self.path)
            .map_err(|e| format!("Failed to rename {} -> {}: {}", tmp_path.display(), self.path.display(), e))?;
        Ok(())
    }
}

/// 返回数据根目录 `~/.sayble/`，所有持久化文件统一存放于此
pub fn base_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Failed to get home directory")
        .join(".sayble")
}

pub struct AppStore {
    settings: JsonStore,
    stats: JsonStore,
    history: JsonStore,
}

const MAX_HISTORY_RECORDS: usize = 200;

impl AppStore {
    pub fn init() -> Self {
        let base = base_dir();
        fs::create_dir_all(&base).expect("Failed to create ~/.sayble directory");

        Self {
            settings: JsonStore::new(base.join("settings.json")),
            stats: JsonStore::new(base.join("stats.json")),
            history: JsonStore::new(base.join("history.json")),
        }
    }

    pub fn settings(&self) -> &JsonStore {
        &self.settings
    }

    pub fn stats(&self) -> &JsonStore {
        &self.stats
    }

    /// 累加一次识别的统计数据并持久化
    pub fn accumulate_stats(&self, chars: usize, duration_ms: Option<i64>) {
        let s = self.stats();
        let prev_dur: i64 = s.get("total_duration_ms").and_then(|v| v.as_i64()).unwrap_or(0);
        let prev_chars: i64 = s.get("total_chars").and_then(|v| v.as_i64()).unwrap_or(0);
        let count: i64 = s.get("total_count").and_then(|v| v.as_i64()).unwrap_or(0);
        s.set("total_duration_ms", serde_json::json!(prev_dur + duration_ms.unwrap_or(0)));
        s.set("total_chars", serde_json::json!(prev_chars + chars as i64));
        s.set("total_count", serde_json::json!(count + 1));
        if let Err(e) = s.save() {
            log::error!("[store] stats save failed: {}", e);
        }
    }

    /// 追加一条历史记录，超过 MAX_HISTORY_RECORDS 时删除最旧的
    pub fn append_history(&self, record: Value) {
        let h = &self.history;
        let mut records = h.get("records")
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
        records.push(record);
        while records.len() > MAX_HISTORY_RECORDS {
            records.remove(0);
        }
        h.set("records", Value::Array(records));
        if let Err(e) = h.save() {
            log::error!("[store] history save failed: {}", e);
        }
    }

    /// 读取历史记录，倒序返回（最新在前）
    pub fn load_history(&self) -> Vec<Value> {
        let mut records = self.history.get("records")
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
        records.reverse();
        records
    }

    /// 删除一条历史记录（按 timestamp 匹配）
    pub fn remove_history(&self, timestamp: &str) {
        let h = &self.history;
        let mut records = h.get("records")
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
        records.retain(|r| r.get("timestamp").and_then(|t| t.as_str()) != Some(timestamp));
        h.set("records", Value::Array(records));
        if let Err(e) = h.save() {
            log::error!("[store] history remove save failed: {}", e);
        }
    }

    /// 清空历史记录
    pub fn clear_history(&self) {
        self.history.set("records", Value::Array(vec![]));
        if let Err(e) = self.history.save() {
            log::error!("[store] history clear save failed: {}", e);
        }
    }
}
