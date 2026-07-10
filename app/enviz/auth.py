"""Minimal cookie authentication for reviewer isolation."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
from dataclasses import dataclass

from .config import USERS_CONFIG_PATH, USERS_DIR

COOKIE_NAME = "enviz_session"
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

# Initial local accounts. Override with ENVIZ_USERS_JSON on the server:
# {"username":{"display_name":"Name","password_sha256":"..."}}
DEFAULT_USERS = {
    "annotator1": {
        "display_name": "Xuben",
        "password_sha256": "0cce7b6d58e25f4d7c2eaa47d8d8315f46595917bf9d5d99fbb1a24881f1f7fe",
    },
    "annotator2": {
        "display_name": "Sunyandong",
        "password_sha256": "4ee67820a15a485520958d5393ab95c355708b88105f9b46fe3358dfe475c79a",
    },
    "annotator3": {
        "display_name": "Gaojiacheng",
        "password_sha256": "26af5c0cc37e25645e66eb9fe7de9aedf76dd56506e0f8ee21b2f399116e19d3",
    },
    "annotator4": {
        "display_name": "Yangzijiang",
        "password_sha256": "a24522ef6dd13ebfd19f709d54de432321cfc4673f7b716987386d39fc83cf4d",
    },
}


@dataclass(frozen=True)
class User:
    username: str
    display_name: str
    workspace: str | None = None

    @property
    def user_dir(self):
        path = USERS_DIR / safe_workspace(self.workspace or self.username)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def annotation_dir(self):
        path = self.user_dir / "annotations"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def assignments_path(self):
        return self.user_dir / "assignments.json"


def users_config() -> dict:
    if USERS_CONFIG_PATH.is_file():
        try:
            data = json.loads(USERS_CONFIG_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"{USERS_CONFIG_PATH} is not valid JSON") from exc
        if not isinstance(data, dict):
            raise RuntimeError(f"{USERS_CONFIG_PATH} must be a JSON object")
        return data

    raw = os.environ.get("ENVIZ_USERS_JSON", "").strip()
    if not raw:
        return DEFAULT_USERS
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("ENVIZ_USERS_JSON is not valid JSON") from exc
    if not isinstance(data, dict):
        raise RuntimeError("ENVIZ_USERS_JSON must be a JSON object")
    return data


def public_user(user: User) -> dict:
    return {"username": user.username, "display_name": user.display_name, "workspace": user.workspace or user.username}


def verify_credentials(username: str, password: str) -> User | None:
    username = username.strip()
    rec = users_config().get(username)
    if not isinstance(rec, dict):
        return None
    expected = str(rec.get("password_sha256", ""))
    actual = hashlib.sha256(password.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(expected, actual):
        return None
    return _user_from_record(username, rec)


def set_session_cookie(response, user: User) -> None:
    response.set_cookie(
        COOKIE_NAME,
        _sign({"u": user.username, "iat": int(time.time())}),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(COOKIE_NAME)


def user_from_session(enviz_session: str | None) -> User | None:
    if not enviz_session:
        return None
    payload = _unsign(enviz_session)
    if not payload:
        return None
    if int(time.time()) - int(payload.get("iat", 0)) > SESSION_TTL_SECONDS:
        return None
    username = str(payload.get("u", ""))
    rec = users_config().get(username)
    if not isinstance(rec, dict):
        return None
    return _user_from_record(username, rec)


def _user_from_record(username: str, rec: dict) -> User:
    workspace = str(rec.get("workspace") or username)
    safe_workspace(workspace)
    return User(
        username=username,
        display_name=str(rec.get("display_name") or username),
        workspace=workspace,
    )


def safe_workspace(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
        raise RuntimeError(f"Invalid workspace name: {name!r}")
    return name


def _secret() -> bytes:
    secret = os.environ.get("ENVIZ_AUTH_SECRET", "dev-only-change-before-deploy")
    return secret.encode("utf-8")


def _sign(payload: dict) -> str:
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def _unsign(token: str) -> dict | None:
    try:
        body, sig = token.split(".", 1)
    except ValueError:
        return None
    expected = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        return json.loads(base64.urlsafe_b64decode(_pad(body)).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _pad(value: str) -> bytes:
    return (value + "=" * (-len(value) % 4)).encode("ascii")
