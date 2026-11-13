"""Authenticated encryption for HTTP tool credentials stored in the database."""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings


def _cipher():
    # Domain separation keeps this application's encryption keys distinct from
    # other uses of SECRET_KEY. Keep old keys in SECRET_KEY_FALLBACKS on rotation.
    keys = [settings.SECRET_KEY, *getattr(settings, "SECRET_KEY_FALLBACKS", [])]
    return MultiFernet([
        Fernet(base64.urlsafe_b64encode(hashlib.sha256(
            b"argus:ai-assistant:http-tool-secret:v1\x00" + key.encode("utf-8")
        ).digest())) for key in keys
    ])


def encrypt_http_tool_secret(value: str) -> str:
    return _cipher().encrypt(value.encode("utf-8")).decode("ascii") if value else ""


def decrypt_http_tool_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return _cipher().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError, ValueError):
        raise ValueError("HTTP tool credential cannot be decrypted; re-enter it in AI Assistant settings.") from None
