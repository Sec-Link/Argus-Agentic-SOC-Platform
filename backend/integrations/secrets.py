"""Domain-separated encryption for credentials of new integration connectors."""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings

PREFIX = 'enc:v1:'


def _cipher():
    keys = [settings.SECRET_KEY, *getattr(settings, 'SECRET_KEY_FALLBACKS', [])]
    return MultiFernet([Fernet(base64.urlsafe_b64encode(hashlib.sha256(
        b'argus:integration-secret:v1\x00' + key.encode('utf-8')
    ).digest())) for key in keys])


def encrypt_secret(value):
    return PREFIX + _cipher().encrypt(value.encode('utf-8')).decode('ascii') if value else ''


def decrypt_secret(value):
    if not value:
        return ''
    try:
        if not value.startswith(PREFIX):
            raise ValueError
        return _cipher().decrypt(value[len(PREFIX):].encode('ascii')).decode('utf-8')
    except (InvalidToken, UnicodeError, ValueError):
        raise ValueError('Integration credential cannot be decrypted; re-enter the password.') from None
