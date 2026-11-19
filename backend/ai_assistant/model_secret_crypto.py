"""Authenticated, domain-separated encryption for saved model API keys."""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings


def _cipher():
    # Keep previous SECRET_KEY values in SECRET_KEY_FALLBACKS during rotation.
    keys = [settings.SECRET_KEY, *getattr(settings, "SECRET_KEY_FALLBACKS", [])]
    return MultiFernet([
        Fernet(base64.urlsafe_b64encode(hashlib.sha256(
            b"argus:ai-assistant:model-api-key:v1\x00" + key.encode("utf-8")
        ).digest())) for key in keys
    ])


def encrypt_model_api_key(value):
    return _cipher().encrypt(value.encode("utf-8")).decode("ascii") if value else ""


def decrypt_model_api_key(value):
    if not value:
        return ""
    try:
        return _cipher().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError, ValueError):
        raise ValueError("Saved model API key cannot be decrypted; re-enter it in AI Assistant settings.") from None
