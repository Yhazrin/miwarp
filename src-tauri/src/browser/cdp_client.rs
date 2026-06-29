//! Chrome DevTools Protocol (CDP) 客户端
//!
//! 通过WebSocket与Chrome通信的JSON-RPC协议实现

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::{broadcast, oneshot, Mutex, RwLock};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

/// CDP事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpEvent {
    pub method: String,
    pub params: Value,
}

/// CDP消息
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum CdpMessage {
    #[serde(rename = "command")]
    Command {
        id: u64,
        method: String,
        params: Value,
    },
    #[serde(rename = "response")]
    Response {
        id: u64,
        result: Option<Value>,
        error: Option<CdpError>,
    },
    #[serde(rename = "event")]
    Event { method: String, params: Value },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CdpError {
    code: i32,
    message: String,
}

/// CDP客户端
pub struct CdpClient {
    ws: Arc<Mutex<WebSocketStream<MaybeTlsStream<TcpStream>>>>,
    msg_id: AtomicU64,
    pending: Arc<RwLock<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    event_tx: broadcast::Sender<CdpEvent>,
}

impl CdpClient {
    /// 连接到Chrome CDP端点
    pub async fn connect(ws_url: &str) -> Result<Self, String> {
        log::info!("[cdp] Connecting to: {}", ws_url);

        let (ws, _response) = connect_async(ws_url)
            .await
            .map_err(|e| format!("Failed to connect to CDP: {}", e))?;

        let (event_tx, _) = broadcast::channel(100);

        let client = Self {
            ws: Arc::new(Mutex::new(ws)),
            msg_id: AtomicU64::new(1),
            pending: Arc::new(RwLock::new(HashMap::new())),
            event_tx: event_tx.clone(),
        };

        // 启动消息接收任务
        let ws_clone = client.ws.clone();
        let pending_clone = client.pending.clone();
        let event_tx_clone = event_tx.clone();

        tokio::spawn(async move {
            Self::receive_loop(ws_clone, pending_clone, event_tx_clone).await;
        });

        Ok(client)
    }

    /// 消息接收循环
    async fn receive_loop(
        ws: Arc<Mutex<WebSocketStream<MaybeTlsStream<TcpStream>>>>,
        pending: Arc<RwLock<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
        event_tx: broadcast::Sender<CdpEvent>,
    ) {
        loop {
            let msg = {
                let mut ws_guard = ws.lock().await;
                ws_guard.next().await
            };

            match msg {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(message) = serde_json::from_str::<Value>(&text) {
                        // 检查是否是响应
                        if let Some(id) = message.get("id").and_then(|v| v.as_u64()) {
                            let mut pending_guard = pending.write().await;
                            if let Some(tx) = pending_guard.remove(&id) {
                                if let Some(error) = message.get("error") {
                                    let err_msg = error
                                        .get("message")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Unknown error");
                                    let _ = tx.send(Err(err_msg.to_string()));
                                } else {
                                    let result =
                                        message.get("result").cloned().unwrap_or(Value::Null);
                                    let _ = tx.send(Ok(result));
                                }
                            }
                        }
                        // 检查是否是事件
                        else if let Some(method) = message.get("method").and_then(|v| v.as_str())
                        {
                            let params = message.get("params").cloned().unwrap_or(Value::Null);
                            let event = CdpEvent {
                                method: method.to_string(),
                                params,
                            };
                            let _ = event_tx.send(event);
                        }
                    }
                }
                Some(Ok(Message::Close(_))) => {
                    log::info!("[cdp] WebSocket closed");
                    break;
                }
                Some(Err(e)) => {
                    log::error!("[cdp] WebSocket error: {}", e);
                    break;
                }
                None => {
                    log::info!("[cdp] WebSocket stream ended");
                    break;
                }
                _ => {}
            }
        }
    }

    /// 发送CDP命令并等待响应
    pub async fn send_command(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.msg_id.fetch_add(1, Ordering::SeqCst);

        let message = serde_json::json!({
            "id": id,
            "method": method,
            "params": params
        });

        // 注册pending响应
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.write().await;
            pending.insert(id, tx);
        }

        // 发送消息
        {
            let mut ws = self.ws.lock().await;
            ws.send(Message::Text(message.to_string()))
                .await
                .map_err(|e| format!("Failed to send CDP command: {}", e))?;
        }

        // 等待响应（超时30秒）
        match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Channel closed".to_string()),
            Err(_) => {
                // 超时，移除pending
                let mut pending = self.pending.write().await;
                pending.remove(&id);
                Err("CDP command timeout".to_string())
            }
        }
    }

    /// 订阅事件
    pub fn subscribe(&self) -> broadcast::Receiver<CdpEvent> {
        self.event_tx.subscribe()
    }

    /// 关闭连接
    pub async fn close(&self) -> Result<(), String> {
        let mut ws = self.ws.lock().await;
        ws.send(Message::Close(None))
            .await
            .map_err(|e| format!("Failed to close WebSocket: {}", e))?;
        Ok(())
    }
}

/// CDP命令封装
impl CdpClient {
    /// 获取浏览器版本
    pub async fn get_version(&self) -> Result<Value, String> {
        self.send_command("Browser.getVersion", serde_json::json!({}))
            .await
    }

    /// 获取所有目标（Tab）
    pub async fn get_targets(&self) -> Result<Vec<CdpTarget>, String> {
        let result = self
            .send_command("Target.getTargets", serde_json::json!({}))
            .await?;
        let target_infos = result
            .get("targetInfos")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "Invalid response format".to_string())?;

        let targets: Vec<CdpTarget> = target_infos
            .iter()
            .filter_map(|info| {
                Some(CdpTarget {
                    target_id: info.get("targetId")?.as_str()?.to_string(),
                    r#type: info.get("type")?.as_str()?.to_string(),
                    title: info.get("title")?.as_str()?.to_string(),
                    url: info.get("url")?.as_str()?.to_string(),
                    attached: info.get("attached")?.as_bool()?,
                })
            })
            .collect();

        Ok(targets)
    }

    /// 附加到目标
    pub async fn attach_to_target(&self, target_id: &str) -> Result<String, String> {
        let result = self
            .send_command(
                "Target.attachToTarget",
                serde_json::json!({
                    "targetId": target_id,
                    "flatten": true
                }),
            )
            .await?;

        result
            .get("sessionId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "Failed to get session ID".to_string())
    }

    /// 在session中发送命令
    pub async fn send_command_to_session(
        &self,
        session_id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        let id = self.msg_id.fetch_add(1, Ordering::SeqCst);

        let message = serde_json::json!({
            "id": id,
            "method": method,
            "params": params,
            "sessionId": session_id
        });

        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.write().await;
            pending.insert(id, tx);
        }

        {
            let mut ws = self.ws.lock().await;
            ws.send(Message::Text(message.to_string()))
                .await
                .map_err(|e| format!("Failed to send CDP command: {}", e))?;
        }

        match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Channel closed".to_string()),
            Err(_) => {
                let mut pending = self.pending.write().await;
                pending.remove(&id);
                Err("CDP command timeout".to_string())
            }
        }
    }
}

/// CDP目标信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpTarget {
    pub target_id: String,
    pub r#type: String,
    pub title: String,
    pub url: String,
    pub attached: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cdp_message_serialization() {
        let msg = serde_json::json!({
            "id": 1,
            "method": "Page.navigate",
            "params": { "url": "https://example.com" }
        });

        let serialized = serde_json::to_string(&msg).unwrap();
        assert!(serialized.contains("Page.navigate"));
    }
}
