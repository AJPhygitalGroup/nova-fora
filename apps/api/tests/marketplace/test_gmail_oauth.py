"""gmail-refresh-token CLI helper — installed-app flow with Google mocked."""

from __future__ import annotations

import threading
import urllib.request
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app import gmail_oauth


def _fake_google(captured: dict):
    def handler(request: httpx.Request) -> httpx.Response:
        form = dict(parse_qs(request.content.decode()))
        captured["form"] = {k: v[0] for k, v in form.items()}
        return httpx.Response(
            200,
            json={"access_token": "at", "refresh_token": "1//refresh-SECRET", "expires_in": 3599},
        )

    return lambda: httpx.Client(transport=httpx.MockTransport(handler))


def _browser_that_consents(code: str = "auth-code-42", tamper_state: bool = False):
    def open_browser(url: str):
        q = parse_qs(urlparse(url).query)
        state = "wrong" if tamper_state else q["state"][0]
        redirect = q["redirect_uri"][0]
        threading.Thread(
            target=lambda: urllib.request.urlopen(f"{redirect}?state={state}&code={code}"),
            daemon=True,
        ).start()

    return open_browser


def test_auth_url_requests_offline_gmail_send_with_pkce():
    verifier, challenge = gmail_oauth.pkce_pair()
    url = gmail_oauth.build_auth_url("cid", "http://127.0.0.1:5000/", "st", challenge)
    q = parse_qs(urlparse(url).query)
    assert q["scope"] == ["https://www.googleapis.com/auth/gmail.send"]
    assert q["access_type"] == ["offline"] and q["prompt"] == ["consent"]
    assert q["code_challenge_method"] == ["S256"] and q["code_challenge"] == [challenge]
    assert 43 <= len(verifier) <= 128


def test_flow_writes_refresh_token_to_file_and_never_prints_it(tmp_path, capsys):
    captured: dict = {}
    out = tmp_path / "token.txt"
    gmail_oauth.run_flow(
        client_id="cid",
        client_secret="csecret",
        out_path=out,
        open_browser=_browser_that_consents(),
        http_client=_fake_google(captured),
        timeout=10,
    )
    assert out.read_text().strip() == "1//refresh-SECRET"
    assert captured["form"]["code"] == "auth-code-42"
    assert captured["form"]["grant_type"] == "authorization_code"
    assert captured["form"]["code_verifier"]
    printed = capsys.readouterr()
    assert "refresh-SECRET" not in printed.out + printed.err
    assert "csecret" not in printed.out + printed.err


def test_flow_rejects_state_mismatch(tmp_path):
    with pytest.raises(gmail_oauth.OAuthFlowError, match="state"):
        gmail_oauth.run_flow(
            client_id="cid",
            client_secret="csecret",
            out_path=tmp_path / "t.txt",
            open_browser=_browser_that_consents(tamper_state=True),
            http_client=_fake_google({}),
            timeout=10,
        )
    assert not (tmp_path / "t.txt").exists()


def test_gmail_send_failure_logs_no_secrets(monkeypatch, caplog):
    """A refused token refresh is logged without client secret / tokens, and
    send() reports failure instead of raising."""
    from app.services import email as email_service

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_grant"})

    settings = type(
        "S",
        (),
        {
            "gmail_client_id": "cid-PUBLIC",
            "gmail_client_secret": "csecret-XYZ",
            "gmail_refresh_token": "1//rt-ABC",
            "gmail_sender": "jescalona@dantzigfleets.com",
            "smtp_host": "",
            "smtp_from": "Nova Fora <noreply@example.com>",
        },
    )()
    monkeypatch.setattr(email_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        email_service, "_gmail_http", lambda: httpx.Client(transport=httpx.MockTransport(handler))
    )
    email_service._gmail_token.clear()
    msg = email_service.EmailMessage(to="a@b.com", subject="s", text="t", html="<p>t</p>")
    with caplog.at_level("DEBUG"):
        assert email_service.send(msg) is False
    logged = caplog.text
    assert "Gmail API send failed" in logged
    assert "csecret-XYZ" not in logged and "1//rt-ABC" not in logged
