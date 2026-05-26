import csv
import io
import json
import re
import uuid

import requests
import yaml
from django.conf import settings
from django.db import transaction
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasDjangoPermissions
from .models import LocalDetectionFieldMapping, LocalDetectionRule, LocalDetectionRuleVersion


def _ea_base() -> str:
    return getattr(settings, "ELASTALERT2_SERVER_BASE_URL", "http://localhost:3030").rstrip("/")


def _proxy(method: str, path: str, payload=None):
    url = f"{_ea_base()}{path}"
    try:
        timeout = 30
        if method == "GET":
            resp = requests.get(url, timeout=timeout)
        elif method == "POST":
            resp = requests.post(url, json=payload or {}, timeout=timeout)
        elif method == "DELETE":
            resp = requests.delete(url, timeout=timeout)
        else:
            return Response({"detail": f"Unsupported method: {method}"}, status=405)
    except requests.RequestException as exc:
        return Response({"detail": f"ElastAlert2 server unavailable: {exc}"}, status=502)

    content_type = (resp.headers.get("Content-Type") or "").lower()
    if "application/json" in content_type:
        try:
            body = resp.json()
        except Exception:
            body = {"detail": resp.text}
    else:
        text = resp.text
        try:
            body = json.loads(text)
        except Exception:
            body = {"raw": text}
    return Response(body, status=resp.status_code)


def _user_name(request) -> str:
    user = getattr(request, "user", None)
    if not user or not getattr(user, "is_authenticated", False):
        return ""
    return str(getattr(user, "username", "") or getattr(user, "email", "") or getattr(user, "id", "") or "")


def _rule_to_legacy_item(rule: LocalDetectionRule) -> dict:
    payload = dict(rule.payload or {})
    yaml_text = payload.get("yaml") or ""
    meta = _extract_rule_meta(yaml_text)
    return {
        "id": rule.rule_uuid,
        "name": meta.get("title") or rule.name,
        "level": meta.get("level") or rule.severity or "low",
        "status": meta.get("status") or "draft",
        "logsource": meta.get("logsource") or "",
        "profile": meta.get("profile") or "",
        "tags": meta.get("tags") or [],
        "type": "file",
        "version": rule.version,
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
    }


def _extract_rule_id(yaml_text: str) -> str:
    m = re.search(r"(?mi)^id:\s*(.+?)\s*$", yaml_text or "")
    if m:
        rid = m.group(1).strip().strip('"').strip("'")
        if rid:
            return rid
    m = re.search(r"(?mi)^title:\s*(.+?)\s*$", yaml_text or "")
    base = (m.group(1).strip() if m else "rule") or "rule"
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", base).strip("-").lower()
    return slug or uuid.uuid4().hex


def _extract_rule_meta(yaml_text: str) -> dict:
    try:
        data = yaml.safe_load(yaml_text) or {}
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}

    logsource = data.get("logsource") if isinstance(data.get("logsource"), dict) else {}
    product = str(logsource.get("product") or "").strip()
    service = str(logsource.get("service") or "").strip()
    category = str(logsource.get("category") or "").strip()
    parts = [x for x in [product, service, category] if x]
    profile = "_".join([x.lower() for x in parts])
    tags_raw = data.get("tags")
    tags = [str(x).strip() for x in tags_raw if str(x).strip()] if isinstance(tags_raw, list) else []
    return {
        "title": str(data.get("title") or "").strip(),
        "level": str(data.get("level") or "").strip().lower(),
        "status": str(data.get("status") or "").strip().lower(),
        "logsource": " / ".join(parts),
        "profile": profile,
        "tags": tags,
    }


def _mapping_candidates(parsed: dict) -> list[str]:
    logsource = parsed.get("logsource") if isinstance(parsed.get("logsource"), dict) else {}
    product = str(logsource.get("product") or "").strip().lower()
    category = str(logsource.get("category") or "").strip().lower()
    service = str(logsource.get("service") or "").strip().lower()
    base = "_".join([x for x in [product, service or category] if x])
    profiles = [f"{product}_{service}" if product and service else "", f"{product}_{category}" if product and category else "", base]
    profiles = [x for x in profiles if x]
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
    for p in profiles:
        expanded.append(p)
        expanded.extend(aliases.get(p, []))
    expanded.append("common")
    uniq = []
    seen = set()
    for x in expanded:
        if x and x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def _build_mapping_lookup(candidates: list[str]) -> dict:
    rows = LocalDetectionFieldMapping.objects.filter(mapping_profile__in=candidates).order_by("id")
    by_profile = {p: {} for p in candidates}
    for r in rows:
        by_profile.setdefault(r.mapping_profile, {})
        by_profile[r.mapping_profile][r.sigma_field] = {"splunk": r.splunk_field or r.sigma_field, "elastic": r.elastic_field or r.sigma_field}
    out = {}
    for p in candidates:
        for k, v in by_profile.get(p, {}).items():
            if k not in out:
                out[k] = v
            nk = k.replace(".", "_")
            if nk not in out:
                out[nk] = v
    return out


def _map_field(field: str, target: str, lookup: dict) -> str:
    found = lookup.get(field) or lookup.get(field.replace(".", "_"))
    if not found:
        return field
    return found.get(target) or field


def _compile_term(field_expr: str, raw_value, target: str, lookup: dict) -> str:
    parts = str(field_expr).split("|")
    field = parts[0]
    ops = set(parts[1:])
    mapped = _map_field(field, target, lookup)
    values = raw_value if isinstance(raw_value, list) else [raw_value]
    joiner = " and " if "all" in ops else " or "
    items = []
    for v in values:
        if v is None:
            items.append(f"not {mapped}:*" if target == "elastic" else f"NOT {mapped}=*")
            continue
        s = str(v)
        if "contains" in ops:
            q = f"*{s}*"
        elif "startswith" in ops:
            q = f"{s}*"
        elif "endswith" in ops:
            q = f"*{s}"
        else:
            q = s
        if target == "elastic":
            items.append(f'{mapped}: "{q}"')
        else:
            items.append(f'{mapped}="{q}"')
    if not items:
        return ""
    return "(" + joiner.join(items) + ")" if len(items) > 1 else items[0]


def _compile_selector(selector: dict, target: str, lookup: dict) -> str:
    if not isinstance(selector, dict):
        return ""
    terms = []
    for key, value in selector.items():
        if isinstance(value, dict):
            for k2, v2 in value.items():
                terms.append(_compile_term(k2, v2, target, lookup))
        else:
            terms.append(_compile_term(key, value, target, lookup))
    terms = [t for t in terms if t]
    if not terms:
        return ""
    return "(" + " and ".join(terms) + ")" if len(terms) > 1 else terms[0]


def _compile_condition(condition: str, compiled: dict, target: str = "splunk") -> str:
    cond = (condition or "").strip()
    if not cond:
        vals = [v for v in compiled.values() if v]
        return " OR ".join(vals) if target == "splunk" else " or ".join(vals) if vals else "*"

    connectors = {
        "splunk": {"and": " AND ", "or": " OR ", "not": " NOT "},
        "elastic": {"and": " and ", "or": " or ", "not": " not "},
    }.get(target, {"and": " AND ", "or": " OR ", "not": " NOT "})

    tokens = [m.group(0) for m in re.finditer(r"\s+|[()]|\b(?:and|or|not|of|all|them)\b|\d+|[A-Za-z0-9_.-]+\*?", cond, flags=re.I)]
    tokens = [t for t in tokens if not t.isspace()]
    pos = 0

    def peek():
        return tokens[pos].lower() if pos < len(tokens) else None

    def take():
        nonlocal pos
        tok = tokens[pos]
        pos += 1
        return tok

    def join_exprs(exprs: list[str], op: str) -> str:
        exprs = [e for e in exprs if e and e != "*"]
        if not exprs:
            return "*"
        if len(exprs) == 1:
            return exprs[0]
        return "(" + op.join(exprs) + ")"

    def parse_expr():
        left = parse_and()
        while peek() == "or":
            take()
            right = parse_and()
            left = join_exprs([left, right], connectors["or"])
        return left

    def parse_and():
        left = parse_not()
        while peek() == "and":
            take()
            right = parse_not()
            left = join_exprs([left, right], connectors["and"])
        return left

    def parse_not():
        if peek() == "not":
            take()
            expr = parse_not()
            return f"{connectors['not'].strip()} ({expr})"
        return parse_atom()

    def parse_group_ref(ref: str, quant: str) -> str:
        ref_l = ref.lower()
        if ref_l == "them":
            keys = list(compiled.keys())
        elif ref.endswith("*"):
            prefix = ref[:-1]
            keys = [k for k in compiled.keys() if k.startswith(prefix)]
        else:
            keys = [ref] if ref in compiled else []
        exprs = [compiled[k] for k in keys if compiled.get(k)]
        if quant.isdigit() and int(quant) <= 0:
            return "*"
        if quant.lower() == "all":
            return join_exprs(exprs, connectors["and"])
        return join_exprs(exprs, connectors["or"])

    def parse_atom():
        tok = peek()
        if tok is None:
            return "*"
        if tok == "(":
            take()
            expr = parse_expr()
            if peek() == ")":
                take()
            return expr
        if re.fullmatch(r"\d+|all", tok or ""):
            quant = take()
            if peek() == "of":
                take()
                ref = take() if pos < len(tokens) else ""
                return parse_group_ref(ref, quant)
            return quant
        if tok in compiled:
            take()
            return f"({compiled[tok]})"
        if re.fullmatch(r"[A-Za-z0-9_.-]+\*?", tok or ""):
            take()
            # Support bare wildcard group references like selection*
            if tok.endswith("*"):
                return parse_group_ref(tok, "1")
            return tok
        return take()

    expr = parse_expr()
    return expr or "*"


def _compile_queries_from_yaml(yaml_text: str) -> dict:
    try:
        parsed = yaml.safe_load(yaml_text) or {}
        if not isinstance(parsed, dict):
            parsed = {}
    except Exception:
        parsed = {}
    detection = parsed.get("detection") if isinstance(parsed.get("detection"), dict) else {}
    condition = str(detection.get("condition") or "").strip()
    candidates = _mapping_candidates(parsed)
    lookup = _build_mapping_lookup(candidates)

    splunk_parts = {}
    elastic_parts = {}
    for key, value in detection.items():
        if key == "condition":
            continue
        splunk_parts[key] = _compile_selector(value, "splunk", lookup)
        elastic_parts[key] = _compile_selector(value, "elastic", lookup)

    splunk_expr = _compile_condition(condition, splunk_parts, "splunk")
    elastic_expr = _compile_condition(condition, elastic_parts, "elastic")
    return {
        "profiles": candidates,
        "splunk": splunk_expr or "*",
        "kql": elastic_expr or "*",
    }


class DetectionRulesView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"GET": "integrations.view_integration"}

    def get(self, request):
        rules = LocalDetectionRule.objects.filter(is_deleted=False).order_by("name", "id")
        return Response([_rule_to_legacy_item(r) for r in rules])


class DetectionRuleDetailView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        "GET": "integrations.view_integration",
        "POST": "integrations.change_integration",
        "DELETE": "integrations.delete_integration",
    }

    def get(self, request, rule_id: str):
        rule = LocalDetectionRule.objects.filter(rule_uuid=rule_id, is_deleted=False).first()
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)
        payload = dict(rule.payload or {})
        yaml_text = payload.get("yaml") or json.dumps(payload, ensure_ascii=False, indent=2)
        compiled = _compile_queries_from_yaml(yaml_text)
        return Response({
            "id": rule.rule_uuid,
            "name": rule.name,
            "version": rule.version,
            "yaml": yaml_text,
            "payload": payload,
            "compiled": compiled,
        })

    def post(self, request, rule_id: str):
        yaml_text = request.data.get("yaml")
        if not isinstance(yaml_text, str) or not yaml_text.strip():
            return Response({"detail": "Field 'yaml' is required."}, status=400)

        actor = _user_name(request)
        with transaction.atomic():
            rule = LocalDetectionRule.objects.filter(rule_uuid=rule_id).first()
            if not rule:
                payload = {
                    "id": rule_id or uuid.uuid4().hex,
                    "rule_id": rule_id or uuid.uuid4().hex,
                    "name": rule_id,
                    "type": "query",
                    "enabled": False,
                    "severity": "low",
                    "risk_score": 50,
                    "yaml": yaml_text,
                }
                rule = LocalDetectionRule.objects.create(
                    rule_uuid=payload["id"],
                    name=payload["name"],
                    enabled=False,
                    rule_type="query",
                    severity="low",
                    risk_score=50,
                    version=1,
                    payload=payload,
                    created_by=actor,
                    updated_by=actor,
                    is_deleted=False,
                )
                LocalDetectionRuleVersion.objects.create(
                    rule=rule,
                    version=1,
                    change_type="create",
                    payload=payload,
                    changed_by=actor,
                )
            else:
                payload = dict(rule.payload or {})
                payload["yaml"] = yaml_text
                payload["id"] = rule.rule_uuid
                payload.setdefault("rule_id", rule.rule_uuid)
                payload.setdefault("name", rule.name)
                payload.setdefault("type", rule.rule_type)
                payload.setdefault("enabled", rule.enabled)
                payload.setdefault("severity", rule.severity)
                payload.setdefault("risk_score", rule.risk_score)
                rule.version += 1
                rule.payload = payload
                rule.is_deleted = False
                rule.updated_by = actor
                rule.save()
                LocalDetectionRuleVersion.objects.create(
                    rule=rule,
                    version=rule.version,
                    change_type="update",
                    payload=payload,
                    changed_by=actor,
                )
        return Response({"saved": True, "id": rule.rule_uuid, "version": rule.version})

    def delete(self, request, rule_id: str):
        rule = LocalDetectionRule.objects.filter(rule_uuid=rule_id, is_deleted=False).first()
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)
        actor = _user_name(request)
        with transaction.atomic():
            rule.is_deleted = True
            rule.version += 1
            rule.updated_by = actor
            rule.save(update_fields=["is_deleted", "version", "updated_by", "updated_at"])
            LocalDetectionRuleVersion.objects.create(
                rule=rule,
                version=rule.version,
                change_type="delete",
                payload=dict(rule.payload or {}),
                changed_by=actor,
            )
        return Response({"deleted": True})


class DetectionRuleUploadView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.change_integration"}

    def post(self, request):
        files = request.FILES.getlist("files")
        if not files:
            return Response({"detail": "No files uploaded. Use field name 'files'."}, status=400)

        actor = _user_name(request)
        created = 0
        updated = 0
        skipped = 0
        results = []

        for f in files:
            filename = str(getattr(f, "name", "") or "")
            lower = filename.lower()
            if not (lower.endswith(".yml") or lower.endswith(".yaml")):
                skipped += 1
                results.append({"file": filename, "status": "skipped", "reason": "not yaml"})
                continue
            try:
                raw = f.read()
                yaml_text = raw.decode("utf-8", errors="ignore")
            except Exception:
                skipped += 1
                results.append({"file": filename, "status": "skipped", "reason": "decode failed"})
                continue
            if not yaml_text.strip():
                skipped += 1
                results.append({"file": filename, "status": "skipped", "reason": "empty file"})
                continue

            rule_id = _extract_rule_id(yaml_text)
            with transaction.atomic():
                rule = LocalDetectionRule.objects.filter(rule_uuid=rule_id).first()
                if not rule:
                    payload = {
                        "id": rule_id,
                        "rule_id": rule_id,
                        "name": rule_id,
                        "type": "query",
                        "enabled": False,
                        "severity": "low",
                        "risk_score": 50,
                        "yaml": yaml_text,
                    }
                    rule = LocalDetectionRule.objects.create(
                        rule_uuid=rule_id,
                        name=rule_id,
                        enabled=False,
                        rule_type="query",
                        severity="low",
                        risk_score=50,
                        version=1,
                        payload=payload,
                        created_by=actor,
                        updated_by=actor,
                        is_deleted=False,
                    )
                    LocalDetectionRuleVersion.objects.create(
                        rule=rule,
                        version=1,
                        change_type="create",
                        payload=payload,
                        changed_by=actor,
                    )
                    created += 1
                    results.append({"file": filename, "id": rule_id, "status": "created"})
                else:
                    payload = dict(rule.payload or {})
                    payload["yaml"] = yaml_text
                    payload["id"] = rule.rule_uuid
                    payload.setdefault("rule_id", rule.rule_uuid)
                    payload.setdefault("name", rule.name)
                    payload.setdefault("type", rule.rule_type)
                    payload.setdefault("enabled", rule.enabled)
                    payload.setdefault("severity", rule.severity)
                    payload.setdefault("risk_score", rule.risk_score)
                    rule.version += 1
                    rule.payload = payload
                    rule.is_deleted = False
                    rule.updated_by = actor
                    rule.save()
                    LocalDetectionRuleVersion.objects.create(
                        rule=rule,
                        version=rule.version,
                        change_type="update",
                        payload=payload,
                        changed_by=actor,
                    )
                    updated += 1
                    results.append({"file": filename, "id": rule_id, "status": "updated"})

        return Response({"created": created, "updated": updated, "skipped": skipped, "total": len(files), "results": results})


class DetectionMappingListView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"GET": "integrations.view_integration"}

    def get(self, request):
        rows = LocalDetectionFieldMapping.objects.order_by("mapping_profile", "sigma_field", "id")
        data = [{
            "id": r.id,
            "category": r.category,
            "data_source": r.data_source,
            "event_category": r.event_category,
            "mapping_profile": r.mapping_profile,
            "sigma": r.sigma_field,
            "splunk": r.splunk_field,
            "elastic": r.elastic_field,
        } for r in rows]
        return Response(data)


class DetectionMappingUploadView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.change_integration"}

    def post(self, request):
        files = request.FILES.getlist("files")
        if not files:
            return Response({"detail": "No files uploaded. Use field name 'files'."}, status=400)

        actor = _user_name(request)
        created = updated = skipped = 0
        results = []

        def upsert_row(row: dict):
            nonlocal created, updated, skipped
            profile = str(row.get("mapping_profile") or row.get("profile") or "").strip()
            sigma = str(row.get("sigma") or row.get("sigma_field") or "").strip()
            if not profile or not sigma:
                skipped += 1
                return "skipped"
            defaults = {
                "category": str(row.get("category") or ""),
                "data_source": str(row.get("data_source") or row.get("datasource") or ""),
                "event_category": str(row.get("event_category") or row.get("event") or ""),
                "splunk_field": str(row.get("splunk") or row.get("splunk_field") or ""),
                "elastic_field": str(row.get("elastic") or row.get("elastic_field") or ""),
                "updated_by": actor,
            }
            obj, is_created = LocalDetectionFieldMapping.objects.update_or_create(mapping_profile=profile, sigma_field=sigma, defaults=defaults)
            if is_created:
                obj.created_by = actor
                obj.save(update_fields=["created_by"])
                created += 1
                return "created"
            updated += 1
            return "updated"

        for f in files:
            filename = str(getattr(f, "name", "") or "")
            try:
                raw = f.read()
                text = raw.decode("utf-8", errors="ignore")
            except Exception:
                skipped += 1
                results.append({"file": filename, "status": "skipped", "reason": "decode failed"})
                continue

            parsed_rows = []
            lower = filename.lower()
            if lower.endswith(".json"):
                try:
                    data = json.loads(text)
                    if isinstance(data, list):
                        parsed_rows = [x for x in data if isinstance(x, dict)]
                    elif isinstance(data, dict):
                        parsed_rows = [data]
                except Exception:
                    parsed_rows = []
            elif lower.endswith(".csv"):
                try:
                    reader = csv.DictReader(io.StringIO(text))
                    parsed_rows = [dict(r) for r in reader]
                except Exception:
                    parsed_rows = []
            else:
                skipped += 1
                results.append({"file": filename, "status": "skipped", "reason": "unsupported file type"})
                continue

            if not parsed_rows:
                skipped += 1
                results.append({"file": filename, "status": "skipped", "reason": "no parsable rows"})
                continue

            file_created = file_updated = file_skipped = 0
            for row in parsed_rows:
                status = upsert_row(row)
                if status == "created":
                    file_created += 1
                elif status == "updated":
                    file_updated += 1
                else:
                    file_skipped += 1
            results.append({"file": filename, "status": "ok", "rows": len(parsed_rows), "created": file_created, "updated": file_updated, "skipped": file_skipped})

        return Response({"created": created, "updated": updated, "skipped": skipped, "total_files": len(files), "results": results})


class DetectionRuleTestView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.change_integration"}

    def post(self, request):
        rule = request.data.get("rule")
        options = request.data.get("options")
        if not isinstance(rule, str) or not rule.strip():
            return Response({"detail": "Field 'rule' is required."}, status=400)
        payload = {"rule": rule}
        if isinstance(options, dict):
            payload["options"] = options
        return _proxy("POST", "/test", payload)


class DetectionRuleCompileView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.view_integration"}

    def post(self, request):
        yaml_text = request.data.get("yaml")
        if not isinstance(yaml_text, str) or not yaml_text.strip():
            return Response({"detail": "Field 'yaml' is required."}, status=400)
        return Response(_compile_queries_from_yaml(yaml_text))
