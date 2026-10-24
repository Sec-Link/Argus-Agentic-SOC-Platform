"""Guardrails for outbound requests to user-configured connector targets."""

from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import urlsplit

import requests
from requests.adapters import HTTPAdapter
from django.conf import settings


class ConnectorHttpError(ValueError):
    pass


_METADATA_NETWORKS = (
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("100.100.100.200/32"),
    ipaddress.ip_network("fd00:ec2::254/128"),
)


def _allowlist() -> list[str]:
    return [item.strip().lower().rstrip(".") for item in os.getenv("CONNECTOR_HTTP_ALLOWED_HOSTS", "").split(",") if item.strip()]


def _is_allowlisted(hostname: str, addresses: list[ipaddress.IPv4Address | ipaddress.IPv6Address]) -> bool:
    host = hostname.lower().rstrip(".")
    for entry in _allowlist():
        if entry == host:
            return True
        try:
            network = ipaddress.ip_network(entry, strict=False)
        except ValueError:
            continue
        if all(address in network for address in addresses):
            return True
    return False


def _resolve_target(url: str):
    parsed = urlsplit(str(url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        raise ConnectorHttpError("Connector target must use HTTP or HTTPS.")
    if parsed.username or parsed.password:
        raise ConnectorHttpError("Connector target must not contain URL credentials.")
    if not parsed.hostname:
        raise ConnectorHttpError("Connector target host is required.")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise ConnectorHttpError("Connector target port is invalid.") from exc

    try:
        records = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ConnectorHttpError("Connector target DNS resolution failed.") from exc

    addresses: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for record in records:
        try:
            address = ipaddress.ip_address(record[4][0])
            addresses.append(getattr(address, 'ipv4_mapped', None) or address)
        except ValueError:
            continue
    if not addresses:
        raise ConnectorHttpError("Connector target did not resolve to an IP address.")
    if any(
        address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
        or any(address in network for network in _METADATA_NETWORKS)
        for address in addresses
    ):
        raise ConnectorHttpError("Connector target resolves to a blocked address.")

    allowlisted = _is_allowlisted(parsed.hostname, addresses)
    if not getattr(settings, "DEBUG", False) and not allowlisted:
        raise ConnectorHttpError("Connector target must be listed in CONNECTOR_HTTP_ALLOWED_HOSTS.")
    return parsed, addresses


def validate_connector_url(url: str) -> None:
    _resolve_target(url)


class _PinnedAdapter(HTTPAdapter):
    def __init__(self, address, hostname):
        self.address = str(address)
        self.hostname = hostname
        super().__init__(max_retries=0)

    def get_connection_with_tls_context(self, request, verify, proxies=None, cert=None):
        host_params, pool_kwargs = self.build_connection_pool_key_attributes(request, verify, cert)
        host_params['host'] = self.address
        if host_params['scheme'] == 'https':
            pool_kwargs['server_hostname'] = self.hostname
            pool_kwargs['assert_hostname'] = self.hostname if verify else False
        return self.poolmanager.connection_from_host(**host_params, pool_kwargs=pool_kwargs)


def connector_request(method: str, url: str, **kwargs):
    parsed, addresses = _resolve_target(url)
    kwargs['allow_redirects'] = False
    kwargs.setdefault("timeout", (5, 30))
    headers = dict(kwargs.pop('headers', {}) or {})
    headers['Host'] = parsed.netloc
    # Pin the checked address while retaining the hostname for TLS verification.
    # Disabling ambient proxies prevents bypassing the target policy via env vars.
    with requests.Session() as session:
        session.trust_env = False
        session.mount(f'{parsed.scheme}://', _PinnedAdapter(addresses[0], parsed.hostname))
        return session.request(method, url, headers=headers, **kwargs)
