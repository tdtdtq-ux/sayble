use serde::Deserialize;

pub struct PolishConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub prompt: String,
    pub temperature: f64,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Deserialize)]
struct Message {
    content: Option<String>,
}

pub async fn polish_text(config: &PolishConfig, text: &str) -> Result<String, String> {
    let url = format!(
        "{}/chat/completions",
        config.base_url.trim_end_matches('/')
    );

    let body = serde_json::json!({
        "model": config.model,
        "messages": [
            { "role": "system", "content": config.prompt },
            { "role": "user", "content": text },
        ],
        "temperature": config.temperature,
    });

    log::info!("[polish] POST {}, model={}, text_len={}", url, config.model, text.len());

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| {
            log::error!("[polish] request error: {}", e);
            format!("润色请求失败: {}", e)
        })?;

    let status = resp.status();
    if !status.is_success() {
        let body_text = resp.text().await.unwrap_or_default();
        log::error!("[polish] API error, status={}, body={}", status, body_text);
        return Err(format!("润色 API 错误 ({})", status));
    }

    let chat_resp: ChatResponse = resp.json().await.map_err(|e| {
        log::error!("[polish] failed to parse response: {}", e);
        format!("润色响应解析失败: {}", e)
    })?;

    let content = chat_resp
        .choices
        .into_iter()
        .next()
        .and_then(|c| c.message.content)
        .ok_or_else(|| {
            log::error!("[polish] empty response from API");
            "润色 API 返回空内容".to_string()
        })?;

    let content = content.trim().to_string();
    log::info!("[polish] success, result_len={}", content.len());
    Ok(content)
}
