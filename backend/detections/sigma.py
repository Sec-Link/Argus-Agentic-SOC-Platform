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

ATTACK_TACTIC_ALIASES = {
    value["id"].lower(): slug for slug, value in ATTACK_TACTIC_MAP.items()
}
ATTACK_TACTIC_ALIASES.update({slug: slug for slug in ATTACK_TACTIC_MAP})
ATTACK_TACTIC_ALIASES.update(
    {
        # Newer pySigma MITRE STIX loader returns x_mitre_shortname for TA0005.
        "stealth": "defense-evasion",
    }
)

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


def _normalize_attack_tactic_slug(value: str) -> str:
    key = str(value or "").strip().lower()
    key = key.replace("_", "-").replace(" ", "-")
    return ATTACK_TACTIC_ALIASES.get(key, key)


def _technique_name(technique_names: dict, technique_id: str) -> str:
    return str(technique_names.get(technique_id) or technique_id)


def _normalize_attack_technique_id(value: str) -> str:
    key = str(value or "").strip().lower()
    key = key.replace("/", ".").replace("\\", ".").replace("_", ".").replace("-", ".")
    key = re.sub(r"\.+", ".", key)
    return key.upper()


def parse_mitre_attack_tags(tags: list[str] | None) -> list[dict]:
    values = [str(value).strip().lower() for value in (tags or []) if str(value).strip()]
    attack_lookup = _mitre_attack_lookup()
    technique_names = attack_lookup.get("techniques", {}) if isinstance(attack_lookup.get("techniques"), dict) else {}
    technique_tactics = attack_lookup.get("technique_tactics", {}) if isinstance(attack_lookup.get("technique_tactics"), dict) else {}

    rows: list[dict] = []
    seen = set()
    current_tactic_slug = ""

    def add_row(tactic_slug: str, technique_id: str) -> None:
        tactic_slug = _normalize_attack_tactic_slug(tactic_slug)
        tactic = ATTACK_TACTIC_MAP.get(tactic_slug)
        if not tactic or not technique_id:
            return
        key = (tactic["id"], technique_id)
        if key in seen:
            return
        seen.add(key)
        rows.append(
            {
                "tactic_id": tactic["id"],
                "tactic_name": tactic["name"],
                "technique_id": technique_id,
                "technique_name": _technique_name(technique_names, technique_id),
            }
        )

    for tag in values:
        if not tag.startswith("attack."):
            continue
        suffix = tag.split(".", 1)[1].strip()
        tactic_slug = _normalize_attack_tactic_slug(suffix)
        if tactic_slug in ATTACK_TACTIC_MAP:
            current_tactic_slug = tactic_slug
            continue
        technique_id = _normalize_attack_technique_id(suffix)
        if not re.fullmatch(r"T\d{4}(?:\.\d{3})?", technique_id):
            continue

        if current_tactic_slug:
            add_row(current_tactic_slug, technique_id)
            continue

        for inferred_slug in technique_tactics.get(technique_id, []) or []:
            add_row(str(inferred_slug or ""), technique_id)

    return rows


def build_kibana_threat_from_tags(tags: list[str] | None) -> list[dict]:
    rows = parse_mitre_attack_tags(tags)
    if not rows:
        return []

    grouped: dict[str, dict] = {}
    technique_seen: dict[str, set] = {}
    subtechniques_by_parent: dict[tuple[str, str], list[dict]] = {}

    for row in rows:
        tactic_id = row["tactic_id"]
        if tactic_id not in grouped:
            grouped[tactic_id] = {
                "framework": "MITRE ATT&CK",
                "tactic": {
                    "id": tactic_id,
                    "name": row["tactic_name"],
                    "reference": f"https://attack.mitre.org/tactics/{tactic_id}/",
                },
                "technique": [],
            }
            technique_seen[tactic_id] = set()

        technique_id = row["technique_id"]
        if "." in technique_id:
            parent_id = technique_id.split(".", 1)[0]
            subtechniques_by_parent.setdefault((tactic_id, parent_id), []).append(
                {
                    "id": technique_id,
                    "name": row["technique_name"],
                    "reference": f"https://attack.mitre.org/techniques/{technique_id.replace('.', '/')}/",
                }
            )
            if parent_id in technique_seen[tactic_id]:
                continue
            technique_id = parent_id
            technique_name = _technique_name(_mitre_attack_lookup().get("techniques", {}), parent_id)
        else:
            technique_name = row["technique_name"]

        if technique_id in technique_seen[tactic_id]:
            continue
        technique_seen[tactic_id].add(technique_id)
        grouped[tactic_id]["technique"].append(
            {
                "id": technique_id,
                "name": technique_name,
                "reference": f"https://attack.mitre.org/techniques/{technique_id}/",
            }
        )

    for tactic_id, threat in grouped.items():
        for technique in threat["technique"]:
            subtechniques = subtechniques_by_parent.get((tactic_id, technique["id"]), [])
            if subtechniques:
                technique["subtechnique"] = subtechniques

    return list(grouped.values())

def _mapping_candidates(parsed: dict) -> list[str]:
    logsource = parsed.get("logsource") if isinstance(parsed.get("logsource"), dict) else {}
    product = str(logsource.get("product") or "").strip().lower()
    category = str(logsource.get("category") or "").strip().lower()
    service = str(logsource.get("service") or "").strip().lower()
    profiles = [
        f"{product}_{service}" if product and service else "",
        f"{product}_{category}" if product and category else "",
    ]
    profiles = [value for value in profiles if value]
    unique = []
    seen = set()
    for value in profiles:
        if value and value not in seen:
            seen.add(value)
            unique.append(value)
    return unique


def _pysigma_cache_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "tmp_cache" / "pysigma" / "mitre_attack"


def _pysigma_stub_file() -> Path:
    return Path(__file__).resolve().with_name("mitre_attack_stub.json")


def _pysigma_attack_bundle_file() -> Path:
    return _pysigma_cache_dir() / "enterprise-attack.json"


def _mitre_bundle_has_objects(path: Path) -> bool:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return bool(data.get("objects")) if isinstance(data, dict) else False
    except Exception:
        return False


def _download_mitre_attack_bundle(target: Path) -> bool:
    try:
        response = requests.get(MITRE_ATTACK_GITHUB_URL, timeout=(5, 120))
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict) or not data.get("objects"):
            return False

        target.parent.mkdir(parents=True, exist_ok=True)
        temp_path = target.with_suffix(".json.tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False)
        temp_path.replace(target)
        return True
    except Exception:
        return False


@lru_cache(maxsize=1)
def _mitre_attack_data_source() -> str:
    bundle_path = _pysigma_attack_bundle_file()
    if _mitre_bundle_has_objects(bundle_path):
        return str(bundle_path)
    if _download_mitre_attack_bundle(bundle_path) and _mitre_bundle_has_objects(bundle_path):
        return str(bundle_path)
    return str(_pysigma_stub_file())


def _configure_mitre_attack_data(mitre_attack) -> None:
    cache_dir = _pysigma_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    mitre_attack.set_cache_dir(str(cache_dir))
    mitre_attack.set_url(_mitre_attack_data_source())


@lru_cache(maxsize=1)
def _sigma_runtime():
    cache_dir = _pysigma_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("XDG_CACHE_HOME", str(cache_dir.parent))

    from sigma.data import mitre_attack

    _configure_mitre_attack_data(mitre_attack)

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
        from .models import MitreAttackTactic, MitreAttackTechnique, MitreAttackTechniqueTactic

        tactics = {
            row.tactic_id: row.shortname
            for row in MitreAttackTactic.objects.all().only("tactic_id", "shortname")
        }
        techniques = {
            row.technique_id: row.name
            for row in MitreAttackTechnique.objects.all().only("technique_id", "name")
        }
        technique_tactics: dict[str, list[str]] = {}
        for row in MitreAttackTechniqueTactic.objects.select_related("technique", "tactic").all():
            technique_tactics.setdefault(row.technique.technique_id, []).append(row.tactic.shortname)

        if tactics or techniques or technique_tactics:
            return {
                "tactics": tactics,
                "techniques": techniques,
                "technique_tactics": technique_tactics,
            }
    except Exception:
        pass

    try:
        from sigma.data import mitre_attack

        _configure_mitre_attack_data(mitre_attack)
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
        if isinstance(row.elastic_index_patterns, list):
            row_patterns = row.elastic_index_patterns
        else:
            row_patterns = re.split(r"[\r\n,]+", str(row.elastic_index_patterns or ""))
        for item in row_patterns:
            pattern = str(item or "").strip()
            if pattern and pattern not in seen:
                seen.add(pattern)
                patterns.append(pattern)
    return patterns


def _apply_index_patterns_to_esql(query: str, index_patterns: list[str]) -> str:
    source = str(query or "").strip()
    patterns = [str(item or "").strip() for item in index_patterns if str(item or "").strip()]
    if not source or not patterns:
        return source

    next_from = ", ".join(patterns)

    def replace_from(match):
        prefix = match.group("prefix")
        from_body = match.group("body").strip()
        metadata_match = re.search(r"(?i)\s+metadata\s+", from_body)
        metadata = from_body[metadata_match.start() :] if metadata_match else ""
        return f"{prefix}{next_from}{metadata} "

    return re.sub(
        r"(?im)^(?P<prefix>\s*from\s+)(?P<body>[^\|\r\n]+)",
        replace_from,
        source,
        count=1,
    )


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
        esql = _apply_index_patterns_to_esql(_join_queries(esql_queries), index_patterns)
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

