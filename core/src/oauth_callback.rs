//! OAuth loopback callback server.
//!
//! Implements the "system-default-browser OAuth flow with a localhost
//! loopback callback" required by the spec:
//!   * Binds ONLY to 127.0.0.1 on an OS-assigned port — never 0.0.0.0, so
//!     nothing outside this machine can ever reach it.
//!   * Lives only for the duration of one authorization attempt (default
//!     5 minute timeout), then shuts itself down whether or not a
//!     callback arrived.
//!   * Validates the returned `state` against the exact value this
//!     attempt generated before accepting the `code` — an OAuth callback
//!     with a mismatched or missing state is rejected, not just logged.
//!   * Hand-rolled minimal HTTP/1.1 parsing (GET request line + query
//!     string only) rather than a full server framework, since this only
//!     ever needs to understand one thing: a redirect the browser makes
//!     immediately after the user finishes the provider's consent screen.

use std::collections::HashMap;
use std::time::Duration;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::time::timeout;

#[derive(Debug, Error)]
pub enum CallbackError {
    #[error("could not bind the local callback listener: {0}")]
    Bind(String),
    #[error("timed out waiting for the browser to complete authorization")]
    Timeout,
    #[error("the callback did not include an authorization code")]
    MissingCode,
    #[error("the callback's state did not match — rejecting to prevent a CSRF/mix-up attack")]
    StateMismatch,
    #[error("the listener was closed before a callback arrived")]
    Closed,
}

pub struct CallbackServer {
    pub port: u16,
    result_rx: oneshot::Receiver<Result<CallbackResult, CallbackError>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallbackResult {
    pub code: String,
    pub state: String,
}

impl CallbackServer {
    /// Binds a fresh loopback-only listener and starts accepting exactly
    /// one valid callback in the background. `expected_state` must be the
    /// same random value passed to the provider's authorization URL.
    pub async fn start(expected_state: impl Into<String>, max_wait: Duration) -> Result<Self, CallbackError> {
        let (listener, port) = Self::bind().await?;
        let (server, _abort_handle) = Self::listen(listener, port, expected_state, max_wait);
        Ok(server)
    }

    /// Binds the loopback listener only, without starting to accept a
    /// callback yet -- needed when the caller must learn the port (to build
    /// a correct `redirect_uri`) *before* it knows the `expected_state` an
    /// adapter's `begin_authorization` will generate. Pair with `listen`.
    pub async fn bind() -> Result<(TcpListener, u16), CallbackError> {
        Self::bind_on(0).await
    }

    /// Same as `bind`, but on a specific port rather than an OS-assigned
    /// one. Needed for providers whose OAuth app registration requires an
    /// *exact* pre-registered redirect URI (TikTok, Meta/Instagram) --
    /// unlike Google's "Desktop app" OAuth client type, which explicitly
    /// allows any 127.0.0.1 port per RFC 8252, most platforms only accept
    /// the literal URI you registered, so a random port every launch would
    /// simply never match and the OAuth flow would fail every time.
    pub async fn bind_on(port: u16) -> Result<(TcpListener, u16), CallbackError> {
        let listener = TcpListener::bind(("127.0.0.1", port)).await.map_err(|e| CallbackError::Bind(e.to_string()))?;
        let bound_port = listener.local_addr().map_err(|e| CallbackError::Bind(e.to_string()))?.port();
        Ok((listener, bound_port))
    }

    /// Starts accepting exactly one valid callback on an already-bound
    /// listener (see `bind`). The `max_wait` timeout lives INSIDE this
    /// spawned task, wrapped around the future that actually owns
    /// `listener` -- that's what makes the port genuinely release itself
    /// when time runs out. An earlier version only timed out the caller's
    /// `wait_for_callback` wait, which did nothing to the still-running
    /// background task still holding the socket -- for a fixed-port
    /// platform (TikTok, Instagram) that meant a single abandoned/timed-out
    /// connect attempt could permanently block every later attempt with an
    /// "address already in use" OS error, confirmed against a real
    /// Instagram connect attempt that collided with an earlier one.
    /// Also returns an `AbortHandle` for the spawned listener task. Callers
    /// juggling a *fixed* port (TikTok/Instagram) should keep this and call
    /// `.abort()` on it before starting a fresh attempt on the same
    /// platform -- otherwise a still-pending attempt (e.g. the user
    /// accidentally opened the authorization URL in a different browser, or
    /// just clicked connect twice) keeps holding the port for up to
    /// `max_wait`, and the next attempt's `bind_on` fails with "address
    /// already in use" (OS error 10048 on Windows). Confirmed live.
    pub fn listen(listener: TcpListener, port: u16, expected_state: impl Into<String>, max_wait: Duration) -> (Self, tokio::task::AbortHandle) {
        let expected_state = expected_state.into();
        let (tx, rx) = oneshot::channel();
        let join_handle = tokio::spawn(async move {
            let outcome = match timeout(max_wait, accept_one_valid_callback(listener, &expected_state)).await {
                Ok(result) => result,
                Err(_) => Err(CallbackError::Timeout),
            };
            let _ = tx.send(outcome);
        });
        let abort_handle = join_handle.abort_handle();
        (Self { port, result_rx: rx }, abort_handle)
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}/callback", self.port)
    }

    /// Waits for the outcome the spawned task already resolves within its
    /// own `max_wait` (passed to `listen`/`start`) -- no separate timeout
    /// needed here, since the thing that actually holds the socket open is
    /// already bounded.
    pub async fn wait_for_callback(self) -> Result<CallbackResult, CallbackError> {
        self.result_rx.await.unwrap_or(Err(CallbackError::Closed))
    }
}

async fn accept_one_valid_callback(
    listener: TcpListener,
    expected_state: &str,
) -> Result<CallbackResult, CallbackError> {
    loop {
        let (mut socket, peer_addr) = listener.accept().await.map_err(|e| CallbackError::Bind(e.to_string()))?;

        // Defense in depth: even though the listener is bound to 127.0.0.1,
        // explicitly reject anything that somehow isn't loopback (e.g. a
        // misconfigured proxy) rather than trusting the bind alone.
        if !peer_addr.ip().is_loopback() {
            continue;
        }

        let mut buf = vec![0u8; 8192];
        let n = match socket.read(&mut buf).await {
            Ok(n) => n,
            Err(_) => continue,
        };
        let request = String::from_utf8_lossy(&buf[..n]);

        let Some(request_line) = request.lines().next() else { continue };
        let Some(path_and_query) = parse_get_path(request_line) else { continue };
        let params = parse_query_params(path_and_query);

        let response_body = respond_and_close(&mut socket, &params, expected_state).await;

        match (params.get("code"), params.get("state")) {
            (Some(code), Some(state)) if state == expected_state => {
                return Ok(CallbackResult { code: code.clone(), state: state.clone() });
            }
            (Some(_), Some(_)) => return Err(CallbackError::StateMismatch),
            _ => {
                let _ = response_body; // page was already sent explaining the problem
                return Err(CallbackError::MissingCode);
            }
        }
    }
}

fn parse_get_path(request_line: &str) -> Option<&str> {
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?;
    if method != "GET" {
        return None;
    }
    parts.next()
}

fn parse_query_params(path_and_query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Some((_, query)) = path_and_query.split_once('?') else { return map };
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            map.insert(url_decode(k), url_decode(v));
        }
    }
    map
}

fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(byte);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

async fn respond_and_close(
    socket: &mut tokio::net::TcpStream,
    params: &HashMap<String, String>,
    expected_state: &str,
) -> String {
    let ok = matches!((params.get("code"), params.get("state")), (Some(_), Some(s)) if s == expected_state);
    let (title, message) = if ok {
        ("Connected", "You can return to Nzyselle Database now.")
    } else if params.contains_key("error") {
        ("Authorization cancelled", "You can return to Nzyselle Database and try again.")
    } else {
        ("Something went wrong", "You can return to Nzyselle Database and try again.")
    };
    let body = format!(
        "<html><body style=\"font-family:sans-serif;text-align:center;padding-top:15vh;\"><h2>{title}</h2><p>{message}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = socket.write_all(response.as_bytes()).await;
    let _ = socket.shutdown().await;
    body
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpStream;

    async fn send_get(port: u16, path_and_query: &str) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let req = format!("GET {path_and_query} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        stream.write_all(req.as_bytes()).await.unwrap();
        let mut buf = vec![0u8; 4096];
        let _ = stream.read(&mut buf).await; // drain the response so the server's write doesn't block
    }

    #[tokio::test]
    async fn accepts_a_valid_callback_and_returns_the_code() {
        let server = CallbackServer::start("state-abc-123", Duration::from_secs(2)).await.unwrap();
        let port = server.port;

        tokio::spawn(async move {
            send_get(port, "/callback?code=auth-code-xyz&state=state-abc-123").await;
        });

        let result = server.wait_for_callback().await.unwrap();
        assert_eq!(result.code, "auth-code-xyz");
        assert_eq!(result.state, "state-abc-123");
    }

    #[tokio::test]
    async fn rejects_a_mismatched_state_instead_of_accepting_the_code() {
        let server = CallbackServer::start("expected-state", Duration::from_secs(2)).await.unwrap();
        let port = server.port;

        tokio::spawn(async move {
            send_get(port, "/callback?code=stolen-code&state=wrong-state").await;
        });

        let result = server.wait_for_callback().await;
        assert!(matches!(result, Err(CallbackError::StateMismatch)));
    }

    #[tokio::test]
    async fn times_out_if_the_browser_never_completes_the_flow() {
        let server = CallbackServer::start("state-1", Duration::from_millis(150)).await.unwrap();
        let result = server.wait_for_callback().await;
        assert!(matches!(result, Err(CallbackError::Timeout)));
    }

    #[tokio::test]
    async fn timing_out_actually_releases_the_port_instead_of_leaking_the_listener() {
        // Regression test for a real confirmed bug: the timeout used to only
        // apply to the caller's wait, not the spawned task that owns the
        // TcpListener, so a timed-out attempt left the port permanently
        // bound and broke every later connect attempt on a fixed port
        // (TikTok/Instagram) with an OS "address already in use" error.
        let server = CallbackServer::start("state-1", Duration::from_millis(100)).await.unwrap();
        let port = server.port;
        let result = server.wait_for_callback().await;
        assert!(matches!(result, Err(CallbackError::Timeout)));

        // If the spawned task were still holding the listener, this bind
        // would fail with "address already in use".
        let rebind = CallbackServer::bind_on(port).await;
        assert!(rebind.is_ok(), "port should be free again after the listener's own timeout elapsed");
    }

    #[tokio::test]
    async fn redirect_uri_points_only_at_loopback() {
        let server = CallbackServer::start("state-1", Duration::from_secs(2)).await.unwrap();
        assert!(server.redirect_uri().starts_with("http://127.0.0.1:"));
    }

    #[tokio::test]
    async fn missing_code_is_reported_distinctly_from_a_mismatch() {
        let server = CallbackServer::start("state-1", Duration::from_secs(2)).await.unwrap();
        let port = server.port;
        tokio::spawn(async move {
            send_get(port, "/callback?error=access_denied&state=state-1").await;
        });
        let result = server.wait_for_callback().await;
        assert!(matches!(result, Err(CallbackError::MissingCode)));
    }
}
