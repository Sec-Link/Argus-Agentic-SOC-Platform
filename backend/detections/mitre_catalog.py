"""Load the MITRE ATT&CK catalog (tactics, techniques, links) into the database from a STIX bundle."""
from __future__ import annotations

import ipaddress
import json
import socket
from urllib.parse import urljoin, urlparse

import requests
from django.db import transaction

from .models import MitreAttackTactic, MitreAttackTechnique, MitreAttackTechniqueTactic

MITRE_ATTACK_ENTERPRISE_URL = (
    "https://github.com/mitre-attack/attack-stix-data/raw/refs/heads/master/"
    "enterprise-attack/enterprise-attack.json"
)

FETCH_TIMEOUT_SECONDS = 60
MAX_BUNDLE_BYTES = 100 * 1024 * 1024
MAX_REDIRECTS = 3


class CatalogError(Exception):
    """Raised for invalid sources or bundles; the message is safe to show to the caller."""


def _assert_public_https_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise CatalogError("Only https URLs are allowed.")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise CatalogError(f"Cannot resolve host: {parsed.hostname}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise CatalogError("URL resolves to a non-public address, which is not allowed.")


def fetch_bundle_from_url(url: str) -> dict:
    """Fetch a STIX bundle over https, validating every redirect hop and capping the body size."""
    current = url.strip()
    for _ in range(MAX_REDIRECTS + 1):
        _assert_public_https_url(current)
        try:
            response = requests.get(current, stream=True, timeout=FETCH_TIMEOUT_SECONDS, allow_redirects=False)
        except requests.RequestException as exc:
            raise CatalogError(f"Failed to download bundle: {exc.__class__.__name__}") from exc
        with response:
            if response.is_redirect:
                location = response.headers.get("Location")
                if not location:
                    raise CatalogError("Redirect without a Location header.")
                current = urljoin(current, location)
                continue
            if response.status_code != 200:
                raise CatalogError(f"Download failed with HTTP {response.status_code}.")
            chunks, size = [], 0
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                size += len(chunk)
                if size > MAX_BUNDLE_BYTES:
                    raise CatalogError("Bundle is larger than the 100 MB limit.")
                chunks.append(chunk)
        try:
            bundle = json.loads(b"".join(chunks))
        except ValueError as exc:
            raise CatalogError("Response is not valid JSON.") from exc
        return validate_bundle(bundle)
    raise CatalogError("Too many redirects.")


def validate_bundle(bundle) -> dict:
    if not isinstance(bundle, dict) or not isinstance(bundle.get("objects"), list):
        raise CatalogError("Invalid STIX bundle: missing 'objects' array.")
    return bundle


def extract_external_id(obj: dict) -> str | None:
    for ref in obj.get("external_references", []):
        if ref.get("source_name") == "mitre-attack":
            external_id = str(ref.get("external_id") or "").strip()
            if external_id:
                return external_id
    return None


def build_attack_dicts(bundle: dict) -> dict:
    version = "unknown"
    tactics: dict[str, dict] = {}
    techniques: dict[str, dict] = {}
    technique_tactics: dict[str, list[str]] = {}

    for obj in bundle.get("objects", []):
        if not isinstance(obj, dict):
            continue
        if obj.get("revoked") or obj.get("x_mitre_deprecated"):
            continue

        obj_type = obj.get("type")
        if obj_type == "x-mitre-collection":
            version = str(obj.get("x_mitre_version") or version)
            continue

        external_id = extract_external_id(obj)
        if not external_id:
            continue

        if obj_type == "x-mitre-tactic":
            shortname = str(obj.get("x_mitre_shortname") or "").strip()
            if shortname:
                tactics[external_id] = {
                    "name": str(obj.get("name") or shortname).strip(),
                    "shortname": shortname,
                    "reference_url": f"https://attack.mitre.org/tactics/{external_id}/",
                }
            continue

        if obj_type != "attack-pattern":
            continue

        name = str(obj.get("name") or "").strip()
        if name:
            techniques[external_id] = {
                "name": name,
                "reference_url": f"https://attack.mitre.org/techniques/{external_id.replace('.', '/')}/",
            }

        mapped_tactics = []
        for phase in obj.get("kill_chain_phases", []):
            if not isinstance(phase, dict):
                continue
            if phase.get("kill_chain_name") != "mitre-attack":
                continue
            phase_name = str(phase.get("phase_name") or "").strip()
            if phase_name and phase_name not in mapped_tactics:
                mapped_tactics.append(phase_name)
        technique_tactics[external_id] = mapped_tactics

    return {
        "mitre_attack_version": version,
        "mitre_attack_tactics": dict(sorted(tactics.items())),
        "mitre_attack_techniques": dict(sorted(techniques.items())),
        "mitre_attack_techniques_tactics_mapping": dict(sorted(technique_tactics.items())),
    }


def replace_catalog(data: dict) -> dict:
    """Replace the whole catalog with `data` (from build_attack_dicts); returns counts."""
    if not data["mitre_attack_techniques"] or not data["mitre_attack_tactics"]:
        raise CatalogError("Bundle contains no ATT&CK tactics/techniques; refusing to replace the catalog.")
    with transaction.atomic():
        MitreAttackTechniqueTactic.objects.all().delete()
        MitreAttackTechnique.objects.all().delete()
        MitreAttackTactic.objects.all().delete()

        MitreAttackTactic.objects.bulk_create(
            [
                MitreAttackTactic(
                    tactic_id=tactic_id,
                    name=row["name"],
                    shortname=row["shortname"],
                    reference_url=row["reference_url"],
                )
                for tactic_id, row in data["mitre_attack_tactics"].items()
            ],
            batch_size=1000,
        )
        MitreAttackTechnique.objects.bulk_create(
            [
                MitreAttackTechnique(
                    technique_id=technique_id,
                    name=row["name"],
                    reference_url=row["reference_url"],
                )
                for technique_id, row in data["mitre_attack_techniques"].items()
            ],
            batch_size=1000,
        )

        tactics_by_shortname = {
            row.shortname: row for row in MitreAttackTactic.objects.all().only("id", "shortname")
        }
        techniques_by_id = {
            row.technique_id: row for row in MitreAttackTechnique.objects.all().only("id", "technique_id")
        }
        links = []
        for technique_id, tactic_shortnames in data["mitre_attack_techniques_tactics_mapping"].items():
            technique = techniques_by_id.get(technique_id)
            if technique is None:
                continue
            for shortname in tactic_shortnames:
                tactic = tactics_by_shortname.get(shortname)
                if tactic is not None:
                    links.append(MitreAttackTechniqueTactic(technique=technique, tactic=tactic))
        MitreAttackTechniqueTactic.objects.bulk_create(links, batch_size=1000)

    try:
        # The tag parser caches catalog lookups; drop the cache so new data takes effect immediately.
        from .sigma import _mitre_attack_lookup

        _mitre_attack_lookup.cache_clear()
    except Exception:
        pass

    return {
        "version": data["mitre_attack_version"],
        "tactics": len(data["mitre_attack_tactics"]),
        "techniques": len(data["mitre_attack_techniques"]),
        "links": len(links),
    }


def catalog_status() -> dict:
    return {
        "loaded": MitreAttackTechnique.objects.exists(),
        "tactics": MitreAttackTactic.objects.count(),
        "techniques": MitreAttackTechnique.objects.count(),
    }
