//! Desktop AI transport. Tokens never leave the native process. No arbitrary URLs or commands.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{Mutex, Notify},
};

const AUTH: &str = "https://auth.openai.com";
const API: &str = "https://api.openai.com/v1";
const MAX_BODY: usize = 2 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn random() -> String {
    format!(
        "{}{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
pub(crate) fn digest(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes()))
}
fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|_| "Could not initialize secure AI transport.".into())
}
#[tauri::command]
pub fn open_ai_settings(target: String) -> Result<()> {
    let url = match target.as_str() {
        "chatgpt-usage" => "https://chatgpt.com/settings/usage",
        "claude-usage" => "https://claude.ai/settings/usage",
        "claude-install" => "https://code.claude.com/docs/en/setup",
        _ => return Err("Unsupported connection link.".into()),
    };
    if std::process::Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        Ok(())
    } else {
        Err("Could not open your browser.".into())
    }
}
fn read_secret(account: &str) -> Result<Option<String>> {
    crate::vault::get(&format!("chatgpt.{account}")).map_err(String::from)
}
fn save_secret(account: &str, value: &str) -> Result<()> {
    crate::vault::set(&format!("chatgpt.{account}"), Some(value)).map_err(String::from)
}

#[derive(Clone, Serialize, Deserialize)]
struct Model {
    id: String,
    label: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Session {
    client: String,
    subject: String,
    email: String,
    access: String,
    refresh: Option<String>,
    expires: u64,
    earliest_refresh: u64,
    models: Vec<Model>,
    #[serde(default)]
    id_token: String,
}
impl Session {
    fn id(&self) -> String {
        digest(&format!("{}:{}", self.subject, self.client))
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct Profiles {
    active: Option<String>,
    sessions: Vec<Session>,
}
impl Profiles {
    fn active(&self) -> Option<&Session> {
        self.active
            .as_ref()
            .and_then(|id| self.sessions.iter().find(|s| s.id() == *id))
    }
    fn select(&mut self, session: Session) {
        let id = session.id();
        self.sessions.retain(|s| s.id() != id);
        self.sessions.push(session);
        self.active = Some(id);
    }
    fn save(&self) -> Result<()> {
        save_secret(
            "session",
            &serde_json::to_string(self).map_err(|_| "Could not save connection.")?,
        )
    }
}
#[derive(Default)]
pub struct Connections {
    session: Mutex<Profiles>,
    initialized: Mutex<bool>,
    epoch: AtomicU64,
    connecting: Mutex<bool>,
    error: Mutex<Option<String>>,
    tasks: Mutex<HashMap<String, Arc<Notify>>>,
    cancelled: Mutex<HashMap<String, u64>>,
    login_cancel: Mutex<Option<Arc<Notify>>>,
}
impl Connections {
    pub async fn register(&self, id: &str) -> Result<Arc<Notify>> {
        let mut tasks = self.tasks.lock().await;
        let mut cancelled = self.cancelled.lock().await;
        cancelled.retain(|_, at| now().saturating_sub(*at) < 300);
        if cancelled.remove(id).is_some() {
            return Err("Request cancelled.".into());
        }
        if id.len() > 100 || tasks.len() >= 8 || tasks.contains_key(id) {
            return Err("Too many active AI requests.".into());
        }
        let cancel = Arc::new(Notify::new());
        tasks.insert(id.into(), cancel.clone());
        Ok(cancel)
    }
    pub async fn unregister(&self, id: &str) {
        self.tasks.lock().await.remove(id);
    }
    async fn cancel(&self, id: &str) {
        let tasks = self.tasks.lock().await;
        if let Some(cancel) = tasks.get(id) {
            cancel.notify_one();
        } else if id.len() <= 100 {
            let mut cancelled = self.cancelled.lock().await;
            cancelled.retain(|_, at| now().saturating_sub(*at) < 300);
            if cancelled.len() < 512 {
                cancelled.insert(id.into(), now());
            }
        }
    }
}
async fn initialize(state: &Connections) -> Result<()> {
    let mut initialized = state.initialized.lock().await;
    if !*initialized {
        *state.session.lock().await = read_secret("session")?
            .map(|v| {
                serde_json::from_str(&v).map_err(|_| {
                    "Saved ChatGPT connection is invalid. Reconnect in Settings → AI.".to_string()
                })
            })
            .transpose()?
            .unwrap_or_default();
        *initialized = true;
    }
    Ok(())
}
fn http_error(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        401 => "Your ChatGPT session expired. Reconnect in Settings → AI.",
        403 => "ChatGPT plan permission is unavailable. Reconnect and allow plan usage.",
        429 => "ChatGPT usage limit reached. Manage usage in Settings → AI, or try later.",
        400 | 404 => "This request or model is unavailable for your ChatGPT account. Refresh the connection and choose a model.",
        _ => "ChatGPT is temporarily unavailable. Check your connection and try again.",
    }.into()
}
async fn bounded_json(response: reqwest::Response) -> Result<Value> {
    if !response.status().is_success() {
        return Err(http_error(response.status()));
    }
    let mut bytes = Vec::new();
    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.map_err(|_| "AI connection was interrupted.")?;
        if bytes.len() + chunk.len() > MAX_BODY {
            return Err("AI response exceeded its limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "AI service returned an invalid response.".into())
}
fn validate_tokens(value: &Value) -> Result<()> {
    if value["access_token"]
        .as_str()
        .filter(|v| !v.is_empty())
        .is_none()
        || !value["token_type"]
            .as_str()
            .unwrap_or("")
            .eq_ignore_ascii_case("bearer")
        || value["expires_in"].as_u64().filter(|v| *v > 0).is_none()
        || !value["scope"]
            .as_str()
            .unwrap_or("")
            .split_whitespace()
            .any(|s| s == "chatgpt.tokens.use.direct")
    {
        return Err(
            "ChatGPT plan permission was not granted. Reconnect and allow plan usage.".into(),
        );
    }
    Ok(())
}
async fn tokens(fields: &[(&str, &str)]) -> Result<Value> {
    let response = client()?
        .post(format!("{AUTH}/api/accounts/oauth/token"))
        .form(fields)
        .send()
        .await
        .map_err(|_| "Could not reach ChatGPT sign-in. Try again.")?;
    let value = bounded_json(response).await?;
    validate_tokens(&value)?;
    Ok(value)
}
async fn current(state: &Connections) -> Result<Session> {
    initialize(state).await?;
    // Serialize refreshes so rotated refresh tokens are never reused concurrently.
    let mut slot = state.session.lock().await;
    let mut session = slot
        .active()
        .cloned()
        .ok_or("Connect ChatGPT in Settings → AI first.")?;
    if now() + 60 >= session.expires && now() >= session.earliest_refresh {
        let refresh = session
            .refresh
            .as_deref()
            .ok_or("Reconnect ChatGPT in Settings → AI.")?;
        let next = tokens(&[
            ("grant_type", "refresh_token"),
            ("client_id", &session.client),
            ("refresh_token", refresh),
            ("resource", API),
        ])
        .await?;
        let mut updated = session.clone();
        updated.access = next["access_token"].as_str().unwrap().into();
        updated.refresh = next["refresh_token"]
            .as_str()
            .map(String::from)
            .or(updated.refresh);
        updated.expires = now() + next["expires_in"].as_u64().unwrap();
        updated.earliest_refresh = next["earliest_refresh_at"].as_u64().unwrap_or(0);
        let mut profiles = slot.clone();
        profiles.select(updated.clone());
        profiles.save()?;
        *slot = profiles;
        session = updated;
    }
    Ok(session)
}
#[tauri::command]
pub async fn chatgpt_status(state: State<'_, Connections>) -> Result<Value> {
    initialize(&state).await?;
    let profiles = state.session.lock().await;
    let session = profiles.active();
    Ok(
        json!({"available":true, "status":if *state.connecting.lock().await {"connecting"} else if session.is_some() {"connected"} else {"disconnected"},
        "email":session.map(|s| &s.email), "connectionId":session.map(Session::id),
        "profiles":profiles.sessions.iter().map(|s|json!({"id":s.id(),"email":s.email})).collect::<Vec<_>>(),
        "models":session.map(|s| s.models.clone()).unwrap_or_default(), "error":*state.error.lock().await}),
    )
}

struct Attempt {
    state: String,
    nonce: String,
    verifier: String,
    redirect: String,
    client: Option<String>,
    subject: Option<String>,
}
fn authorization_url(host: &str, attempt: &Attempt) -> String {
    let mut url = tauri::Url::parse(&format!("{AUTH}/api/accounts/authorize")).unwrap();
    let mut query = url.query_pairs_mut();
    query.extend_pairs([
        (
            "client_id",
            attempt.client.as_deref().unwrap_or("dynamic_agent_client"),
        ),
        ("ext_agent_host_id", host),
        ("response_type", "code"),
        ("redirect_uri", &attempt.redirect),
        (
            "scope",
            "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        ),
        ("resource", API),
        ("state", &attempt.state),
        ("nonce", &attempt.nonce),
        ("code_challenge_method", "S256"),
        ("code_challenge", &digest(&attempt.verifier)),
    ]);
    if attempt.client.is_none() {
        query.append_pair("agent_name_hint", "Precipice");
    }
    drop(query);
    url.into()
}
fn callback(url: &tauri::Url, attempt: &Attempt) -> Result<(String, String)> {
    let pairs: HashMap<_, _> = url.query_pairs().into_owned().collect();
    if url.path() != "/auth/callback" || pairs.get("state") != Some(&attempt.state) {
        return Err("Invalid sign-in callback. Start again.".into());
    }
    if pairs.contains_key("error") {
        return Err("ChatGPT sign-in was cancelled or permission was declined.".into());
    }
    let client = pairs
        .get("client_id")
        .or(attempt.client.as_ref())
        .filter(|s| !s.is_empty() && s.as_str() != "dynamic_agent_client")
        .ok_or("Sign-in returned no client identity.")?;
    if attempt
        .client
        .as_ref()
        .is_some_and(|expected| expected != client)
    {
        return Err("Sign-in returned a different account registration.".into());
    }
    Ok((
        client.clone(),
        pairs
            .get("code")
            .filter(|s| !s.is_empty())
            .ok_or("Sign-in returned no code.")?
            .clone(),
    ))
}
#[derive(Clone, Deserialize)]
struct Claims {
    sub: String,
    email: Option<String>,
    nonce: String,
}
async fn verify_identity(token: &str, client_id: &str, attempt: &Attempt) -> Result<Claims> {
    use jsonwebtoken::{decode_header, jwk::JwkSet, Algorithm, DecodingKey};
    let header = decode_header(token).map_err(|_| "Invalid ChatGPT identity.")?;
    if header.alg != Algorithm::RS256 {
        return Err("Unsupported ChatGPT identity signature.".into());
    }
    let jwks = bounded_json(
        client()?
            .get(format!("{AUTH}/.well-known/jwks.json"))
            .send()
            .await
            .map_err(|_| "Could not verify ChatGPT identity.")?,
    )
    .await?;
    let keys: JwkSet = serde_json::from_value(jwks).map_err(|_| "Invalid ChatGPT signing keys.")?;
    let key = keys
        .find(
            header
                .kid
                .as_deref()
                .ok_or("Identity has no signing key.")?,
        )
        .ok_or("Unknown identity signing key.")?;
    decode_identity(
        token,
        client_id,
        attempt,
        &DecodingKey::from_jwk(key).map_err(|_| "Invalid signing key.")?,
    )
}
fn decode_identity(
    token: &str,
    client_id: &str,
    attempt: &Attempt,
    key: &jsonwebtoken::DecodingKey,
) -> Result<Claims> {
    use jsonwebtoken::{decode, Algorithm, Validation};
    let mut validation = Validation::new(Algorithm::RS256);
    validation.leeway = 0;
    validation.validate_nbf = true;
    validation.set_audience(&[client_id]);
    validation.set_issuer(&[AUTH]);
    validation.set_required_spec_claims(&["exp", "sub", "aud", "iss"]);
    let claims = decode::<Claims>(token, key, &validation)
        .map_err(|_| "ChatGPT identity verification failed. Start sign-in again.")?
        .claims;
    if claims.sub.is_empty()
        || claims.nonce != attempt.nonce
        || attempt.subject.as_ref().is_some_and(|s| *s != claims.sub)
    {
        return Err("ChatGPT account did not match this sign-in. Start again.".into());
    }
    Ok(claims)
}
async fn complete(attempt: &Attempt, url: &tauri::Url) -> Result<Session> {
    let (client_id, code) = callback(url, attempt)?;
    let value = tokens(&[
        ("grant_type", "authorization_code"),
        ("client_id", &client_id),
        ("code", &code),
        ("code_verifier", &attempt.verifier),
        ("redirect_uri", &attempt.redirect),
        ("resource", API),
    ])
    .await?;
    let identity = verify_identity(
        value["id_token"]
            .as_str()
            .ok_or("No verified identity returned.")?,
        &client_id,
        attempt,
    )
    .await?;
    let access = value["access_token"].as_str().unwrap();
    let catalog = bounded_json(
        client()?
            .get(format!("{API}/models"))
            .bearer_auth(access)
            .send()
            .await
            .map_err(|_| "Could not discover ChatGPT models.")?,
    )
    .await?;
    let models: Vec<Model> = catalog["models"]
        .as_array()
        .ok_or("Invalid ChatGPT model catalog.")?
        .iter()
        .filter(|m| m["visibility"] == "list")
        .filter_map(|m| {
            Some(Model {
                id: format!("chatgpt/{}", m["slug"].as_str()?),
                label: m["display_name"].as_str()?.into(),
            })
        })
        .collect();
    if models.is_empty() {
        return Err("No eligible models for this ChatGPT account.".into());
    }
    Ok(Session {
        client: client_id,
        subject: identity.sub,
        email: identity.email.unwrap_or("ChatGPT account".into()),
        access: access.into(),
        refresh: value["refresh_token"].as_str().map(String::from),
        expires: now() + value["expires_in"].as_u64().unwrap(),
        earliest_refresh: value["earliest_refresh_at"].as_u64().unwrap_or(0),
        models,
        id_token: value["id_token"].as_str().unwrap().into(),
    })
}
async fn revoke(session: &Session) -> bool {
    let Some(refresh) = session.refresh.as_deref() else {
        return true;
    };
    let Ok(client) = client() else {
        return false;
    };
    let Ok(response) = client
        .get(format!("{AUTH}/.well-known/openid-configuration"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
    else {
        return false;
    };
    let Ok(config) = bounded_json(response).await else {
        return false;
    };
    let Some(endpoint) = config["revocation_endpoint"].as_str() else {
        return false;
    };
    let Ok(url) = tauri::Url::parse(endpoint) else {
        return false;
    };
    if url.scheme() != "https"
        || url.host_str() != Some("auth.openai.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }
    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        if let Ok(response) = client
            .post(url.clone())
            .timeout(Duration::from_secs(5))
            .form(&[
                ("token", refresh),
                ("token_type_hint", "refresh_token"),
                ("client_id", &session.client),
            ])
            .send()
            .await
        {
            if response.status() == reqwest::StatusCode::OK {
                return true;
            }
            if !response.status().is_server_error() {
                return false;
            }
        }
    }
    false
}
async fn commit_connection(state: &Connections, epoch: u64, session: Session) -> Result<()> {
    let mut slot = state.session.lock().await;
    if state.epoch.load(Ordering::SeqCst) != epoch {
        return Err("Sign-in was cancelled. Start again.".into());
    }
    save_secret(
        "registration",
        &json!({"client":session.client,"subject":session.subject}).to_string(),
    )?;
    let mut profiles = slot.clone();
    profiles.select(session);
    profiles.save()?;
    *slot = profiles;
    for cancel in state.tasks.lock().await.values() {
        cancel.notify_one();
    }
    Ok(())
}
#[tauri::command]
pub async fn chatgpt_connect(
    app: tauri::AppHandle,
    state: State<'_, Connections>,
    new_account: bool,
) -> Result<()> {
    use tauri::Manager;
    initialize(&state).await?;
    if new_account && state.session.lock().await.sessions.len() >= 8 {
        return Err(
            "Eight ChatGPT accounts are already saved. Disconnect one before adding another."
                .into(),
        );
    }
    let host = match read_secret("host")? {
        Some(host) => host,
        None => {
            let host = format!("urn:uuid:{}", uuid::Uuid::new_v4());
            save_secret("host", &host)?;
            host
        }
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Could not start local sign-in callback.")?;
    let port = listener
        .local_addr()
        .map_err(|_| "No callback address.")?
        .port();
    let selected = state.session.lock().await.active().cloned();
    let registration = selected
        .as_ref()
        .map(|s| json!({"client":s.client,"subject":s.subject}))
        .or(read_secret("registration")?.and_then(|s| serde_json::from_str::<Value>(&s).ok()));
    let attempt = Attempt {
        state: random(),
        nonce: random(),
        verifier: random(),
        redirect: format!("http://127.0.0.1:{port}/auth/callback"),
        client: if new_account {
            None
        } else {
            registration
                .as_ref()
                .and_then(|v| v["client"].as_str())
                .map(String::from)
        },
        subject: if new_account {
            None
        } else {
            registration
                .as_ref()
                .and_then(|v| v["subject"].as_str())
                .map(String::from)
        },
    };
    let epoch = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
    let cancel = Arc::new(Notify::new());
    if let Some(previous) = state.login_cancel.lock().await.replace(cancel.clone()) {
        previous.notify_one();
    }
    *state.connecting.lock().await = true;
    *state.error.lock().await = None;
    if !std::process::Command::new("/usr/bin/open")
        .arg(authorization_url(&host, &attempt))
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        *state.connecting.lock().await = false;
        return Err("Could not open your browser for ChatGPT sign-in.".into());
    }
    tauri::async_runtime::spawn(async move {
        let state = app.state::<Connections>();
        let outcome = tokio::select! {biased;
            _=cancel.notified()=>Err("ChatGPT sign-in cancelled.".into()),
            result=tokio::time::timeout(Duration::from_secs(300), async {
            loop {
                let (mut socket, _) = listener.accept().await.map_err(|_| "Sign-in listener stopped.")?;
                let mut bytes=Vec::new();
                let read=tokio::time::timeout(Duration::from_secs(3),async {
                    let mut buffer=[0;1024];
                    while !bytes.windows(4).any(|part|part==b"\r\n\r\n") {
                        let count=socket.read(&mut buffer).await.map_err(|_|())?;
                        if count==0 || bytes.len()+count>16*1024 {return Err(());}
                        bytes.extend_from_slice(&buffer[..count]);
                    }
                    Ok(())
                }).await;
                if !matches!(read,Ok(Ok(()))) {continue;}
                let request=String::from_utf8_lossy(&bytes);
                let path=request.lines().next().and_then(|l|l.strip_prefix("GET ")).and_then(|l|l.split(' ').next()).unwrap_or("");
                let url=tauri::Url::parse(&format!("http://127.0.0.1:{port}{path}")).map_err(|_| "Invalid callback URL.")?;
                // Ignore probes/foreign callbacks without consuming the valid pending attempt.
                if callback(&url,&attempt).is_err() && !url.query_pairs().any(|(k,v)|k=="state" && v==attempt.state.as_str()) {
                    let _=socket.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await; continue;
                }
                let result=match complete(&attempt,&url).await {
                    Ok(session)=>commit_connection(&state,epoch,session).await,
                    Err(error)=>Err(error),
                };
                let text=if result.is_ok(){"ChatGPT connected. Return to Precipice."}else{"Sign-in failed. Return to Precipice for details."};
                let _=socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{text}",text.len()).as_bytes()).await;
                return result;
            }
        })=>result.unwrap_or_else(|_|Err("ChatGPT sign-in expired. Try again.".into()))};
        if state.epoch.load(Ordering::SeqCst) != epoch {
            return;
        }
        if let Err(error) = outcome {
            *state.error.lock().await = Some(error);
        }
        *state.connecting.lock().await = false;
    });
    Ok(())
}
#[tauri::command]
pub async fn chatgpt_cancel_login(state: State<'_, Connections>) -> Result<()> {
    state.epoch.fetch_add(1, Ordering::SeqCst);
    if let Some(cancel) = state.login_cancel.lock().await.take() {
        cancel.notify_one();
    }
    *state.connecting.lock().await = false;
    *state.error.lock().await = None;
    Ok(())
}
#[tauri::command]
pub async fn chatgpt_disconnect(state: State<'_, Connections>) -> Result<Value> {
    state.epoch.fetch_add(1, Ordering::SeqCst);
    if let Some(cancel) = state.login_cancel.lock().await.take() {
        cancel.notify_one();
    }
    for cancel in state.tasks.lock().await.values() {
        cancel.notify_one();
    }
    let mut slot = state.session.lock().await;
    let old = slot.active().cloned();
    let confirmed = if let Some(old) = &old {
        revoke(old).await
    } else {
        true
    };
    let mut profiles = slot.clone();
    if let Some(old) = &old {
        profiles.sessions.retain(|s| s.id() != old.id());
    }
    profiles.active = None;
    profiles.save()?;
    *slot = profiles;
    *state.connecting.lock().await = false;
    *state.error.lock().await = None;
    for cancel in state.tasks.lock().await.values() {
        cancel.notify_one();
    }
    Ok(json!({"revocationConfirmed":confirmed}))
}
#[tauri::command]
pub async fn chatgpt_select(state: State<'_, Connections>, connection_id: String) -> Result<()> {
    initialize(&state).await?;
    let mut slot = state.session.lock().await;
    if !slot.sessions.iter().any(|s| s.id() == connection_id) {
        return Err("This saved ChatGPT account is unavailable. Sign in again.".into());
    }
    let mut profiles = slot.clone();
    profiles.active = Some(connection_id);
    profiles.save()?;
    *slot = profiles;
    state.epoch.fetch_add(1, Ordering::SeqCst);
    if let Some(cancel) = state.login_cancel.lock().await.take() {
        cancel.notify_one();
    }
    *state.connecting.lock().await = false;
    *state.error.lock().await = None;
    for cancel in state.tasks.lock().await.values() {
        cancel.notify_one();
    }
    Ok(())
}
#[tauri::command]
pub async fn ai_cancel(state: State<'_, Connections>, id: String) -> Result<()> {
    state.cancel(&id).await;
    Ok(())
}
fn validate_request(body: &Value, session: &Session) -> Result<()> {
    if body.to_string().len() > MAX_BODY {
        return Err("Request too large. Use a smaller selection.".into());
    }
    if body["connectionId"] != session.id() {
        return Err("ChatGPT account changed. Send the request again.".into());
    }
    let model = body["model"].as_str().ok_or("No ChatGPT model selected.")?;
    if !session
        .models
        .iter()
        .any(|m| m.id == format!("chatgpt/{model}"))
    {
        return Err("Choose a model from your connected ChatGPT account.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn chatgpt_request(
    state: State<'_, Connections>,
    id: String,
    body: Value,
    on_chunk: Channel<Vec<u8>>,
) -> Result<()> {
    let cancel = state.register(&id).await?;
    let result = tokio::select! { biased;
        _=cancel.notified()=>Err("Request cancelled.".into()),
        result=async {
            let session=current(&state).await?;validate_request(&body,&session)?;
            let response=client()?.post(format!("{API}/responses")).bearer_auth(&session.access).json(&json!({
                "model":body["model"],"instructions":body["instructions"],"input":body["input"],"tools":body["tools"],
                "store":false,"stream":true,"include":["reasoning.encrypted_content"]
            })).send().await.map_err(|_|"Could not reach ChatGPT. Check your connection.")?;
            if !response.status().is_success(){return Err(http_error(response.status()));}
            let mut stream=response.bytes_stream();let mut total=0;
            while let Some(chunk)=stream.next().await {
                let chunk=chunk.map_err(|_|"ChatGPT stream was interrupted. Retry the request.")?;total+=chunk.len();
                if total>16*MAX_BODY {return Err("ChatGPT response exceeded its limit.".into());}
                on_chunk.send(chunk.to_vec()).map_err(|_|"Request cancelled.")?;
            }
            Ok(())
        }=>result
    };
    state.tasks.lock().await.remove(&id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn attempt() -> Attempt {
        Attempt {
            state: "state".into(),
            nonce: "nonce".into(),
            verifier: "verifier".into(),
            redirect: "http://127.0.0.1:123/auth/callback".into(),
            client: None,
            subject: None,
        }
    }
    #[test]
    fn rejects_foreign_replayed_or_denied_callbacks() {
        let a = attempt();
        for query in [
            "state=wrong&code=x&client_id=c",
            "state=state&error=access_denied",
            "state=state&code=x&client_id=dynamic_agent_client",
            "state=state&client_id=c",
        ] {
            assert!(callback(
                &tauri::Url::parse(&format!("{}?{query}", a.redirect)).unwrap(),
                &a
            )
            .is_err());
        }
        assert_eq!(
            callback(
                &tauri::Url::parse(&format!("{}?state=state&code=x&client_id=c", a.redirect))
                    .unwrap(),
                &a
            )
            .unwrap(),
            ("c".into(), "x".into())
        );
        let mut a = a;
        a.client = Some("original".into());
        assert!(callback(
            &tauri::Url::parse(&format!(
                "{}?state=state&code=x&client_id=other",
                a.redirect
            ))
            .unwrap(),
            &a
        )
        .is_err());
    }
    #[test]
    fn requires_explicit_plan_permission() {
        let good = json!({"access_token":"secret","token_type":"Bearer","expires_in":3600,"scope":"openid chatgpt.tokens.use.direct"});
        assert!(validate_tokens(&good).is_ok());
        for key in ["access_token", "token_type", "expires_in", "scope"] {
            let mut bad = good.clone();
            bad.as_object_mut().unwrap().remove(key);
            assert!(validate_tokens(&bad).is_err());
        }
    }
    #[test]
    fn authorization_uses_pkce_loopback_and_stable_host() {
        let a = attempt();
        let url = tauri::Url::parse(&authorization_url("urn:uuid:host", &a)).unwrap();
        let q: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["redirect_uri"], a.redirect);
        assert_eq!(q["ext_agent_host_id"], "urn:uuid:host");
        assert_eq!(q["code_challenge"], digest("verifier"));
        assert_eq!(q["client_id"], "dynamic_agent_client");
    }
    #[test]
    fn request_is_bound_to_account_and_catalog() {
        let s = Session {
            client: "c".into(),
            subject: "s".into(),
            email: "e".into(),
            access: "secret".into(),
            refresh: None,
            expires: 1,
            earliest_refresh: 0,
            id_token: "id".into(),
            models: vec![Model {
                id: "chatgpt/m".into(),
                label: "M".into(),
            }],
        };
        assert!(validate_request(&json!({"connectionId":s.id(),"model":"m"}), &s).is_ok());
        assert!(validate_request(&json!({"connectionId":"other","model":"m"}), &s).is_err());
        assert!(validate_request(&json!({"connectionId":s.id(),"model":"other"}), &s).is_err());
    }
    #[tokio::test]
    async fn cancellation_covers_before_and_after_registration_and_limits_concurrency() {
        let state = Connections::default();
        state.cancel("early").await;
        assert!(state.register("early").await.is_err());
        let cancel = state.register("running").await.unwrap();
        state.cancel("running").await;
        tokio::time::timeout(Duration::from_millis(50), cancel.notified())
            .await
            .unwrap();
        assert!(state.register("running").await.is_err());
        state.unregister("running").await;
        for i in 0..8 {
            state.register(&format!("id-{i}")).await.unwrap();
        }
        assert!(state.register("overflow").await.is_err());
    }
    #[test]
    fn signed_identity_requires_audience_issuer_expiry_nonce_and_same_account() {
        use jsonwebtoken::{encode, Algorithm, DecodingKey, EncodingKey, Header};
        use std::io::Write;
        use std::process::{Command, Stdio};
        // Ephemeral test-only key; no credentials, network, files or Keychain access.
        let private = Command::new("/usr/bin/openssl")
            .args(["genrsa", "2048"])
            .output()
            .unwrap();
        assert!(private.status.success());
        let mut process = Command::new("/usr/bin/openssl")
            .args(["rsa", "-pubout"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        process
            .stdin
            .take()
            .unwrap()
            .write_all(&private.stdout)
            .unwrap();
        let public = process.wait_with_output().unwrap();
        assert!(public.status.success());
        let signing = EncodingKey::from_rsa_pem(&private.stdout).unwrap();
        let key = DecodingKey::from_rsa_pem(&public.stdout).unwrap();
        let good = json!({"sub":"person","email":"person@example.test","nonce":"nonce","aud":"client","iss":AUTH,"exp":now()+600});
        let sign =
            |claims: &Value| encode(&Header::new(Algorithm::RS256), claims, &signing).unwrap();
        let mut attempt = attempt();
        attempt.subject = Some("person".into());
        assert!(decode_identity(&sign(&good), "client", &attempt, &key).is_ok());
        for (field, value) in [
            ("aud", json!("other")),
            ("iss", json!("https://evil.example")),
            ("exp", json!(1)),
            ("nonce", json!("wrong")),
            ("sub", json!("other")),
            ("nbf", json!(now() + 600)),
        ] {
            let mut bad = good.clone();
            bad[field] = value;
            assert!(
                decode_identity(&sign(&bad), "client", &attempt, &key).is_err(),
                "{field}"
            );
        }
        let mut tampered = sign(&good);
        tampered.push('x');
        assert!(decode_identity(&tampered, "client", &attempt, &key).is_err());
    }
    #[test]
    fn profiles_separate_registrations_with_the_same_email_and_preserve_other_accounts() {
        let session = |client: &str| Session {
            client: client.into(),
            subject: "person".into(),
            email: "same@example.test".into(),
            access: format!("token-{client}"),
            refresh: None,
            expires: now() + 3600,
            earliest_refresh: 0,
            models: vec![],
            id_token: "identity".into(),
        };
        let mut profiles = Profiles::default();
        let first = session("one");
        let first_id = first.id();
        profiles.select(first);
        profiles.select(session("two"));
        assert_eq!(profiles.sessions.len(), 2);
        assert_eq!(profiles.active().unwrap().access, "token-two");
        profiles.active = Some(first_id);
        assert_eq!(profiles.active().unwrap().access, "token-one");
        let restored: Profiles =
            serde_json::from_str(&serde_json::to_string(&profiles).unwrap()).unwrap();
        assert_eq!(restored.active().unwrap().client, "one");
    }
}
