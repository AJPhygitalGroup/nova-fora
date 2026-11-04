"""One-time helper: get a Gmail API refresh token for the sender mailbox.

    python -m app.cli gmail-refresh-token [--out PATH] [--port N]

Runs the OAuth 2.0 installed-app ("loopback") flow with PKCE, scope
`https://www.googleapis.com/auth/gmail.send`:

  1. Reads GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET from the environment, or
     asks for them with hidden input (never as CLI args — shell history).
  2. Opens the browser on Google's consent page. Sign in as the SENDER
     mailbox (e.g. jescalona@dantzigfleets.com) and allow "Send email".
  3. Google redirects to http://127.0.0.1:<port>/ ; the code is exchanged
     for tokens and ONLY the refresh token is written to --out
     (default ./gmail_refresh_token.txt, owner-only permissions).

The token is never printed. Copy the file's content into the
GMAIL_REFRESH_TOKEN env var (EasyPanel), then delete the file.

Prerequisites in Google Cloud (same project as the OAuth client):
  - Gmail API enabled (APIs & Services → Library → Gmail API → Enable).
  - OAuth consent screen user type = INTERNAL. With External in Testing
    mode Google expires the refresh token after 7 days and email stops.
  - Client type "Desktop app" works as is. A "Web application" client
    needs http://127.0.0.1:<port>/ in its Authorized redirect URIs — run
    with that fixed --port.
"""

from __future__ import annotations

import base64
import contextlib
import getpass
import hashlib
import os
import secrets
import stat
import threading
import webbrowser
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/gmail.send"


class OAuthFlowError(RuntimeError):
    pass


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    return verifier, challenge


def build_auth_url(client_id: str, redirect_uri: str, state: str, challenge: str) -> str:
    return (
        AUTH_URL
        + "?"
        + urlencode(
            {
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": SCOPE,
                "access_type": "offline",  # → refresh token
                "prompt": "consent",  # → refresh token even if granted before
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
    )


def exchange_code(
    client: httpx.Client,
    *,
    client_id: str,
    client_secret: str,
    code: str,
    verifier: str,
    redirect_uri: str,
) -> str:
    resp = client.post(
        TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
    )
    if resp.status_code != 200:
        # Google's error body has no secrets ({"error": "...", "error_description": "..."}).
        try:
            err = resp.json()
            reason = f"{err.get('error')}: {err.get('error_description', '')}"
        except ValueError:
            reason = f"HTTP {resp.status_code}"
        raise OAuthFlowError(f"token exchange failed — {reason}")
    refresh = resp.json().get("refresh_token")
    if not refresh:
        raise OAuthFlowError(
            "Google returned no refresh token. Remove the app's access at "
            "https://myaccount.google.com/permissions and run again."
        )
    return refresh


def write_token_file(path: Path, token: str) -> None:
    path.write_text(token + "\n", encoding="utf-8")
    with contextlib.suppress(OSError):  # best effort on Windows
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)  # 0600


def _wait_for_code(server: HTTPServer, state: str, timeout: float) -> str:
    result: dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 — http.server API
            qs = parse_qs(urlparse(self.path).query)
            if qs.get("state", [""])[0] != state:
                result["error"] = "state mismatch"
            elif "error" in qs:
                result["error"] = qs["error"][0]
            elif "code" in qs:
                result["code"] = qs["code"][0]
            else:
                result["error"] = "no code in redirect"
            ok = "code" in result
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                (
                    "<h3>Done — you can close this tab.</h3>"
                    if ok
                    else "<h3>Authorization failed — check the terminal.</h3>"
                ).encode()
            )

        def log_message(self, *args):  # keep the code out of the console
            pass

    server.RequestHandlerClass = Handler
    server.timeout = timeout
    server.handle_request()
    if "code" not in result:
        raise OAuthFlowError(result.get("error", "timed out waiting for Google's redirect"))
    return result["code"]


def run_flow(
    *,
    client_id: str,
    client_secret: str,
    out_path: Path,
    port: int = 0,
    open_browser: Callable[[str], object] = webbrowser.open,
    http_client: Callable[[], httpx.Client] = lambda: httpx.Client(timeout=20),
    timeout: float = 300.0,
) -> Path:
    """Run the loopback flow and write the refresh token to `out_path`."""
    server = HTTPServer(("127.0.0.1", port), BaseHTTPRequestHandler)
    redirect_uri = f"http://127.0.0.1:{server.server_address[1]}/"
    state = secrets.token_urlsafe(24)
    verifier, challenge = pkce_pair()
    url = build_auth_url(client_id, redirect_uri, state, challenge)
    try:
        print("Opening Google's consent page. Sign in as the SENDER mailbox.")
        print(f"If the browser does not open, paste this URL into it:\n{url}\n")
        threading.Thread(target=open_browser, args=(url,), daemon=True).start()
        code = _wait_for_code(server, state, timeout)
    finally:
        server.server_close()
    with http_client() as client:
        token = exchange_code(
            client,
            client_id=client_id,
            client_secret=client_secret,
            code=code,
            verifier=verifier,
            redirect_uri=redirect_uri,
        )
    write_token_file(out_path, token)
    return out_path


def cmd_gmail_refresh_token(out: str | None = None, port: int = 0) -> None:
    client_id = os.environ.get("GMAIL_CLIENT_ID") or input("GMAIL_CLIENT_ID: ").strip()
    client_secret = (
        os.environ.get("GMAIL_CLIENT_SECRET")
        or getpass.getpass("GMAIL_CLIENT_SECRET (hidden): ").strip()
    )
    if not client_id or not client_secret:
        raise SystemExit("GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required.")
    out_path = Path(out or "gmail_refresh_token.txt").resolve()
    try:
        run_flow(client_id=client_id, client_secret=client_secret, out_path=out_path, port=port)
    except OAuthFlowError as exc:
        raise SystemExit(f"gmail-refresh-token: {exc}") from None
    print(
        f"Refresh token written to {out_path}\n"
        "Copy its content into the GMAIL_REFRESH_TOKEN env var, then delete the file. "
        "Do not paste it into a chat or commit it."
    )
