import os
import json
import re
import uuid
from functools import lru_cache
from pathlib import Path

import requests
import yaml

from .models import LocalDetectionFieldMapping


ATTACK_TACTIC_MAP = {
    "reconnaissance": {"id": "TA0043", "name": "Reconnaissance", "reference": "https://attack.mitre.org/tactics/TA0043/"},
    "resource-development": {"id": "TA0042", "name": "Resource Development", "reference": "https://attack.mitre.org/tactics/TA0042/"},
    "initial-access": {"id": "TA0001", "name": "Initial Access", "reference": "https://attack.mitre.org/tactics/TA0001/"},
    "execution": {"id": "TA0002", "name": "Execution", "reference": "https://attack.mitre.org/tactics/TA0002/"},
    "persistence": {"id": "TA0003", "name": "Persistence", "reference": "https://attack.mitre.org/tactics/TA0003/"},
    "privilege-escalation": {"id": "TA0004", "name": "Privilege Escalation", "reference": "https://attack.mitre.org/tactics/TA0004/"},
    "defense-evasion": {"id": "TA0005", "name": "Defense Evasion", "reference": "https://attack.mitre.org/tactics/TA0005/"},
    "credential-access": {"id": "TA0006", "name": "Credential Access", "reference": "https://attack.mitre.org/tactics/TA0006/"},
    "discovery": {"id": "TA0007", "name": "Discovery", "reference": "https://attack.mitre.org/tactics/TA0007/"},
    "lateral-movement": {"id": "TA0008", "name": "Lateral Movement", "reference": "https://attack.mitre.org/tactics/TA0008/"},
    "collection": {"id": "TA0009", "name": "Collection", "reference": "https://attack.mitre.org/tactics/TA0009/"},
    "command-and-control": {"id": "TA0011", "name": "Command and Control", "reference": "https://attack.mitre.org/tactics/TA0011/"},
    "exfiltration": {"id": "TA0010", "name": "Exfiltration", "reference": "https://attack.mitre.org/tactics/TA0010/"},
    "impact": {"id": "TA0040", "name": "Impact", "reference": "https://attack.mitre.org/tactics/TA0040/"},
}

MITRE_ATTACK_GITHUB_URL = (
    "https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json"
)

def load_rule_document(yaml_text: str) -> dict:
    try:
        data = yaml.safe_load(yaml_text) or {}
        if not isinstance(data, dict):
            return {}
        return data
    except Exception:
        return {}


def extract_rule_id(yaml_text: str) -> str:
    match = re.search(r"(?mi)^id:\s*(.+?)\s*$", yaml_text or "")
    if match:
        rule_id = match.group(1).strip().strip('"').strip("'")
        if rule_id:
            return rule_id

    match = re.search(r"(?mi)^title:\s*(.+?)\s*$", yaml_text or "")
    base = (match.group(1).strip() if match else "rule") or "rule"
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", base).strip("-").lower()
    return slug or uuid.uuid4().hex


def extract_rule_meta(yaml_text: str) -> dict:
    data = load_rule_document(yaml_text)

    logsource = data.get("logsource") if isinstance(data.get("logsource"), dict) else {}
    product = str(logsource.get("product") or "").strip()
    service = str(logsource.get("service") or "").strip()
    category = str(logsource.get("category") or "").strip()
    parts = [value for value in [product, service, category] if value]
    profile = "_".join(value.lower() for value in parts)
    tags_raw = data.get("tags")
    tags = [str(value).strip() for value in tags_raw if str(value).strip()] if isinstance(tags_raw, list) else []
    return {
        "title": str(data.get("title") or "").strip(),
        "level": str(data.get("level") or "").strip().lower(),
        "status": str(data.get("status") or "").strip().lower(),
        "description": str(data.get("description") or "").strip(),
        "product": product,
        "service": service,
        "category": category,
        "logsource": " / ".join(parts),
        "profile": profile,
        "tags": tags,
    }


def build_rule_detail_metadata(yaml_text: str) -> dict:
    parsed = load_rule_document(yaml_text)
    meta = extract_rule_meta(yaml_text)
    detection = parsed.get("detection") if isinstance(parsed.get("detection"), dict) else {}
    detection_preview = (
        yaml.safe_dump(detection, allow_unicode=True, sort_keys=False).strip() if detection else ""
    )
    mitre_attack = build_kibana_threat_from_tags(meta.get("tags") or [])
    return {
        "title": meta.get("title") or "",
        "level": meta.get("level") or "",
        "status": meta.get("status") or "",
        "description": meta.get("description") or "",
        "product": meta.get("product") or "",
        "service": meta.get("service") or "",
        "category": meta.get("category") or "",
        "logsource": meta.get("logsource") or "",
        "profile": meta.get("profile") or "",
        "tags": meta.get("tags") or [],
        "mitre_attack": mitre_attack,
        "detection_preview": detection_preview,
    }


def build_kibana_threat_from_tags(tags: list[str] | None) -> list[dict]:
    values = [str(value).strip().lower() for value in (tags or []) if str(value).strip()]
    tactic_slugs: list[str] = []
    technique_ids: list[str] = []
    subtechnique_ids: list[str] = []

    for tag in values:
        if not tag.startswith("attack."):
            continue
        suffix = tag.split(".", 1)[1].strip()
        if re.fullmatch(r"t\d{4}", suffix):
            technique_ids.append(suffix.upper())
        elif re.fullmatch(r"t\d{4}\.\d{3}", suffix):
            subtechnique_ids.append(suffix.upper())
        elif suffix in ATTACK_TACTIC_MAP:
            tactic_slugs.append(suffix)

    unique_tactics = []
    seen_tactics = set()
    for slug in tactic_slugs:
        if slug not in seen_tactics:
            seen_tactics.add(slug)
            unique_tactics.append(slug)

    unique_techniques = []
    seen_techniques = set()
    for technique in technique_ids:
        if technique not in seen_techniques:
            seen_techniques.add(technique)
            unique_techniques.append(technique)

    unique_subtechniques = []
    seen_subtechniques = set()
    for subtechnique in subtechnique_ids:
        if subtechnique not in seen_subtechniques:
            seen_subtechniques.add(subtechnique)
            unique_subtechniques.append(subtechnique)

    if not unique_tactics and not unique_techniques and not unique_subtechniques:
        return []

    attack_lookup = _mitre_attack_lookup()
    tactic_names = attack_lookup.get("tactics", {}) if isinstance(attack_lookup.get("tactics"), dict) else {}
    technique_names = attack_lookup.get("techniques", {}) if isinstance(attack_lookup.get("techniques"), dict) else {}
    technique_tactics = attack_lookup.get("technique_tactics", {}) if isinstance(attack_lookup.get("technique_tactics"), dict) else {}

    if not unique_tactics:
        inferred = []
        for technique_id in [*unique_techniques, *unique_subtechniques]:
            for tactic_slug in technique_tactics.get(technique_id, []) or []:
                tactic_slug = str(tactic_slug or "").strip().lower()
                if tactic_slug and tactic_slug in ATTACK_TACTIC_MAP and tactic_slug not in inferred:
                    inferred.append(tactic_slug)
        unique_tactics = inferred

    techniques = []
    for technique_id in unique_techniques:
        children = [
            {
                "id": sub_id,
                "name": str(technique_names.get(sub_id) or sub_id),
                "reference": f"https://attack.mitre.org/techniques/{sub_id.replace('.', '/')}/",
            }
            for sub_id in unique_subtechniques
            if sub_id.startswith(f"{technique_id}.")
        ]
        techniques.append(
            {
                "id": technique_id,
                "name": str(technique_names.get(technique_id) or technique_id),
                "reference": f"https://attack.mitre.org/techniques/{technique_id}/",
                "subtechnique": children,
            }
        )

    orphan_subtechniques = [sub_id for sub_id in unique_subtechniques if not any(sub_id.startswith(f"{tech['id']}.") for tech in techniques)]
    for sub_id in orphan_subtechniques:
        parent_id = sub_id.split(".", 1)[0]
        techniques.append(
            {
                "id": parent_id,
                "name": str(technique_names.get(parent_id) or parent_id),
                "reference": f"https://attack.mitre.org/techniques/{parent_id}/",
                "subtechnique": [
                    {
                        "id": sub_id,
                        "name": str(technique_names.get(sub_id) or sub_id),
                        "reference": f"https://attack.mitre.org/techniques/{sub_id.replace('.', '/')}/",
                    }
                ],
            }
        )

    threats = []
    for slug in unique_tactics:
        tactic = ATTACK_TACTIC_MAP.get(slug)
        if not tactic:
            continue
        threats.append(
            {
                "framework": "MITRE ATT&CK",
                "tactic": {
                    "id": tactic["id"],
                    "name": str(tactic_names.get(tactic["id"]) or tactic["name"]),
                    "reference": tactic["reference"],
                },
                "technique": techniques,
            }
        )

    return threats


def _mapping_candidates(parsed: dict) -> list[str]:
    logsource = parsed.get("logsource") if isinstance(parsed.get("logsource"), dict) else {}
    product = str(logsource.get("product") or "").strip().lower()
    category = str(logsource.get("category") or "").strip().lower()
    service = str(logsource.get("service") or "").strip().lower()
    base = "_".join(value for value in [product, service or category] if value)
    profiles = [
        f"{product}_{service}" if product and service else "",
        f"{product}_{category}" if product and category else "",
        base,
    ]
    profiles = [value for value in profiles if value]
    aliases = {
        "windows_process_creation": ["windows_sysmon_process_creation", "windows_security_generic"],
        "windows_file_event": ["windows_sysmon_file_event"],
        "windows_file_access": ["windows_sysmon_file_access"],
        "windows_file_delete": ["windows_sysmon_file_delete"],
        "windows_registry_set": ["windows_sysmon_registry_set"],
        "windows_registry_add": ["windows_sysmon_registry_add"],
        "windows_registry_delete": ["windows_sysmon_registry_delete"],
        "windows_network_connection": ["windows_sysmon_network_connection"],
        "windows_dns_query": ["windows_sysmon_dns_query", "dns_query"],
        "windows_image_load": ["windows_sysmon_image_load"],
        "windows_driver_load": ["windows_sysmon_driver_load"],
        "windows_pipe_created": ["windows_sysmon_pipe_created"],
        "windows_create_stream_hash": ["windows_sysmon_create_stream_hash"],
        "windows_wmi_event": ["windows_sysmon_wmi_event"],
        "windows_powershell": ["windows_powershell_script_block"],
        "windows_ps_script": ["windows_powershell_script_block"],
        "windows_security": ["windows_security_generic"],
        "windows_logon": ["windows_security_logon"],
        "windows_account_management": ["windows_security_account_management"],
        "windows_object_access": ["windows_security_object_access"],
        "windows_service_install": ["windows_security_service_install"],
        "windows_taskscheduler": ["windows_taskscheduler_task_event"],
        "linux_process_creation": ["linux_auditd_process_creation"],
        "linux_file_event": ["linux_auditd_file_event"],
        "linux_auth": ["linux_auth"],
        "aws_cloudtrail": ["aws_cloudtrail_api_activity"],
        "azure_auditlogs": ["azure_auditlogs_audit"],
        "okta_system": ["okta_system"],
        "m365_audit": ["m365_audit"],
        "google_workspace": ["google_workspace_audit"],
        "proxy_generic": ["proxy_http"],
        "webserver_generic": ["webserver_http"],
        "zeek_dns": ["zeek_dns", "dns_query"],
        "zeek_http": ["zeek_http"],
        "dns_generic": ["dns_query"],
    }
    expanded = []
    for profile in profiles:
        expanded.append(profile)
        expanded.extend(aliases.get(profile, []))
    expanded.append("common")

    unique = []
    seen = set()
    for value in expanded:
        if value and value not in seen:
            seen.add(value)
            unique.append(value)
    return unique


def _pysigma_cache_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "tmp_cache" / "pysigma" / "mitre_attack"


def _pysigma_stub_file() -> Path:
    return Path(__file__).resolve().with_name("mitre_attack_stub.json")


def _remote_attack_dataset_has_objects() -> bool:
    try:
        response = requests.get(MITRE_ATTACK_GITHUB_URL, timeout=(5, 30))
        response.raise_for_status()
        data = response.json()
        return bool(data.get("objects")) if isinstance(data, dict) else False
    except Exception:
        return False


@lru_cache(maxsize=1)
def _sigma_runtime():
    cache_dir = _pysigma_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("XDG_CACHE_HOME", str(cache_dir.parent))

    from sigma.data import mitre_attack

    mitre_attack.set_cache_dir(str(cache_dir))
    if _remote_attack_dataset_has_objects():
        mitre_attack.set_url(MITRE_ATTACK_GITHUB_URL)

    from sigma.backends.elasticsearch.elasticsearch_esql import ESQLBackend
    from sigma.backends.elasticsearch.elasticsearch_lucene import LuceneBackend
    from sigma.collection import SigmaCollection
    from sigma.processing.pipeline import ProcessingItem, ProcessingPipeline
    from sigma.processing.transformations import FieldMappingTransformation

    return {
        "SigmaCollection": SigmaCollection,
        "ESQLBackend": ESQLBackend,
        "LuceneBackend": LuceneBackend,
        "ProcessingItem": ProcessingItem,
        "ProcessingPipeline": ProcessingPipeline,
        "FieldMappingTransformation": FieldMappingTransformation,
    }


@lru_cache(maxsize=1)
def _mitre_attack_lookup() -> dict:
    try:
        from sigma.data import mitre_attack

        if _remote_attack_dataset_has_objects():
            mitre_attack.set_url(MITRE_ATTACK_GITHUB_URL)
        return {
            "tactics": dict(getattr(mitre_attack, "mitre_attack_tactics", {}) or {}),
            "techniques": dict(getattr(mitre_attack, "mitre_attack_techniques", {}) or {}),
            "technique_tactics": dict(getattr(mitre_attack, "mitre_attack_techniques_tactics_mapping", {}) or {}),
        }
    except Exception:
        return {"tactics": {}, "techniques": {}, "technique_tactics": {}}


def _elastic_field_mapping_for_profiles(candidates: list[str]) -> dict[str, str]:
    rows = LocalDetectionFieldMapping.objects.filter(mapping_profile__in=candidates).order_by("id")
    by_profile = {profile: {} for profile in candidates}
    for row in rows:
        by_profile.setdefault(row.mapping_profile, {})
        by_profile[row.mapping_profile][row.sigma_field] = row.elastic_field or row.sigma_field

    mapping = {}
    for profile in candidates:
        for sigma_field, elastic_field in by_profile.get(profile, {}).items():
            if sigma_field not in mapping:
                mapping[sigma_field] = elastic_field
            normalized_field = sigma_field.replace(".", "_")
            if normalized_field not in mapping:
                mapping[normalized_field] = elastic_field
    return mapping


def _elastic_index_patterns_for_profiles(candidates: list[str]) -> list[str]:
    rows = LocalDetectionFieldMapping.objects.filter(mapping_profile__in=candidates).order_by("id")
    patterns = []
    seen = set()
    for row in rows:
        row_patterns = row.elastic_index_patterns if isinstance(row.elastic_index_patterns, list) else []
        for item in row_patterns:
            pattern = str(item or "").strip()
            if pattern and pattern not in seen:
                seen.add(pattern)
                patterns.append(pattern)
    return patterns


def _build_processing_pipeline(candidates: list[str]):
    mapping = _elastic_field_mapping_for_profiles(candidates)
    components = _sigma_runtime()
    ProcessingItem = components["ProcessingItem"]
    ProcessingPipeline = components["ProcessingPipeline"]
    FieldMappingTransformation = components["FieldMappingTransformation"]
    items = []
    if mapping:
        items.append(
            ProcessingItem(
                identifier="local_detection_field_mapping",
                transformation=FieldMappingTransformation(mapping=mapping),
            )
        )
    return ProcessingPipeline(name="Local detection field mappings", items=items)


def _normalize_yaml_for_pysigma(yaml_text: str) -> str:
    parsed = load_rule_document(yaml_text)
    if not parsed:
        return yaml_text

    rule_id = str(parsed.get("id") or "").strip()
    try:
        uuid.UUID(rule_id)
    except Exception:
        stable_name = rule_id or extract_rule_id(yaml_text)
        parsed["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, f"local-detection:{stable_name}"))

    return yaml.safe_dump(parsed, allow_unicode=True, sort_keys=False)


def _render_queries(backend_cls, yaml_text: str, candidates: list[str]) -> list[str]:
    components = _sigma_runtime()
    SigmaCollection = components["SigmaCollection"]
    collection = SigmaCollection.from_yaml(_normalize_yaml_for_pysigma(yaml_text))
    backend = backend_cls(processing_pipeline=_build_processing_pipeline(candidates))
    queries = backend.convert(collection)
    if isinstance(queries, list):
        return [str(query).strip() for query in queries if str(query).strip()]
    query = str(queries).strip()
    return [query] if query else []


def _join_queries(queries: list[str], fallback: str = "*") -> str:
    if not queries:
        return fallback
    if len(queries) == 1:
        return queries[0]
    return "\n\n".join(queries)


def compile_queries_from_yaml(yaml_text: str) -> dict:
    parsed = load_rule_document(yaml_text)
    candidates = _mapping_candidates(parsed)
    index_patterns = _elastic_index_patterns_for_profiles(candidates)
    components = _sigma_runtime()

    try:
        esql_queries = _render_queries(components["ESQLBackend"], yaml_text, candidates)
        esql = _join_queries(esql_queries)
        return {
            "profiles": candidates,
            "elastic_index_patterns": index_patterns,
            "language": "esql",
            "esql": esql,
        }
    except Exception as exc:
        esql_error = str(exc).strip() or "ES|QL compilation failed"

    try:
        lucene_queries = _render_queries(components["LuceneBackend"], yaml_text, candidates)
        lucene = _join_queries(lucene_queries)
        return {
            "profiles": candidates,
            "elastic_index_patterns": index_patterns,
            "language": "lucene",
            "lucene": lucene,
            "error": esql_error,
        }
    except Exception as exc:
        lucene_error = str(exc).strip() or "Lucene compilation failed"
        return {
            "profiles": candidates,
            "elastic_index_patterns": index_patterns,
            "language": "esql",
            "esql": "*",
            "error": f"ES|QL: {esql_error} | Lucene: {lucene_error}",
        }
