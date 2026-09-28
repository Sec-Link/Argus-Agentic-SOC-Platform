"""SMTP email backend that skips TLS certificate verification.

For SMTP relays that present a self-signed certificate (common in on-prem /
dev mail gateways) Django's default backend fails the STARTTLS handshake with
``CERTIFICATE_VERIFY_FAILED``. Enable this backend only via
``EMAIL_SSL_NO_VERIFY=true`` — do not use it against public mail providers.
"""

import ssl

from django.core.mail.backends.smtp import EmailBackend
from django.utils.functional import cached_property


class UnverifiedSMTPBackend(EmailBackend):
    @cached_property
    def ssl_context(self):
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context
