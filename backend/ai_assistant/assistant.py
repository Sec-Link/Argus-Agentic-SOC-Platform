import json
import logging
import os
import re
from typing import Any, Dict, List

import requests
from django.conf import settings

from ai_assistant.mcp_gateway import (
    fetch_cmdb_assets,
    fetch_observables,
    fetch_similar_cases,
    fetch_ticket_context,
    get_mcp_tools_catalog,
    invoke_mcp_tool_explicit,
    record_mcp_monitor_event,
)
from ai_assistant.skills import apply_local_skills
from ai_assistant.skill_library import read_skill
from tickets.models import EventTicket, TicketWorkLog

logger = logging.getLogger(__name__)


class AIAssistantError(RuntimeError):
    pass


def _get_setting(name: str, default: Any = None) -> Any:
    return getattr(settings, name, os.getenv(name, default))


def _extract_response_text(payload: Dict[str, Any]) -> str:
    if isinstance(payload, dict):
        if payload.get("output_text"):
            return str(payload["output_text"])
        output = payload.get("output") or []
        for item in output:
            for content in item.get("content") or []:
                ctype = content.get("type")
                if ctype in ("output_text", "text"):
                    return str(content.get("text") or content.get("content") or "")
    return ""


def _json_dumps_safe(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=True, sort_keys=True)
    except Exception:
        return str(value)


def _normalize_ai_assistant(assistant: Any, ticket: EventTicket, raw_text: str = '') -> tuple[Dict[str, Any], Dict[str, str]]:
    """Return the stable DTO consumed by the UI, regardless of model output quality."""
    candidate = assistant if isinstance(assistant, dict) else {}
    raw = str(raw_text or '')
    sources: Dict[str, str] = {}

    model_header = candidate.get('header') if isinstance(candidate.get('header'), dict) else {}
    score = model_header.get('score')
    if not isinstance(score, (int, float)) or score <= 0:
        score_match = re.search(r'(?i)risk\s+score\s*[:=]\s*(\d+)', raw or str(getattr(ticket, 'alert_message', '') or ''))
        score = int(score_match.group(1)) if score_match else getattr(ticket, 'event_risk_score', None)
        sources['header.score'] = 'derived' if score_match else 'ticket'
    else:
        sources['header.score'] = 'model'

    risk_level = str(model_header.get('risk_level') or getattr(ticket, 'priority', '') or 'medium').lower()
    if risk_level not in {'critical', 'high', 'medium', 'low', 'info'}:
        risk_level = 'medium'
    sources['header.risk_level'] = 'model' if model_header.get('risk_level') else 'ticket'
    confidence = model_header.get('ai_confidence')
    if confidence in (None, ''):
        confidence = None
        sources['header.ai_confidence'] = 'unavailable'
    else:
        sources['header.ai_confidence'] = 'model'

    header = {
        **model_header,
        'risk_level': risk_level,
        'ai_confidence': confidence,
        'score': score,
        'summary_title': str(model_header.get('summary_title') or getattr(ticket, 'title', '') or 'SOC incident analysis'),
        'status': str(getattr(ticket, 'status', '') or 'new'),
        'platform': model_header.get('platform') or getattr(ticket, 'event_platform', '') or '',
        'source': model_header.get('source') or getattr(ticket, 'event_sources', '') or '',
    }
    sources['header.status'] = 'ticket'

    case_summary = candidate.get('case_summary') if isinstance(candidate.get('case_summary'), dict) else {}
    summary = case_summary.get('incident_summary') or candidate.get('alert_explanation') or getattr(ticket, 'description', '') or getattr(ticket, 'title', '') or 'No summary available yet.'
    sources['summary'] = 'model' if case_summary.get('incident_summary') or candidate.get('alert_explanation') else 'ticket'

    def normalize_tasks(value: Any) -> List[Dict[str, str]]:
        if not isinstance(value, list):
            return []
        result = []
        for item in value:
            if isinstance(item, dict):
                title = str(item.get('title') or '').strip()
                detail = str(item.get('detail') or '').strip()
            else:
                title, detail = str(item).strip(), ''
            if title or detail:
                result.append({'title': title or detail, 'detail': detail})
        return result

    completed_tasks = normalize_tasks(candidate.get('completed_tasks'))
    suggested_tasks = normalize_tasks(candidate.get('next_tasks'))
    if not completed_tasks:
        completed_tasks = [{'title': 'AI incident triage', 'detail': 'Generated an incident summary and extracted key indicators.'}]
        sources['completed_tasks'] = 'system'
    else:
        sources['completed_tasks'] = 'model'
    if suggested_tasks:
        sources['suggested_tasks'] = 'model_or_extracted'
    else:
        sources['suggested_tasks'] = 'unavailable'

    normalized = {
        **candidate,
        'header': header,
        'alert_explanation': str(summary),
        'risk_level_recommendation': candidate.get('risk_level_recommendation') if isinstance(candidate.get('risk_level_recommendation'), dict) else {'level': risk_level, 'rationale': 'Derived from available ticket and AI context.'},
        'completed_tasks': completed_tasks,
        'next_tasks': suggested_tasks,
        'case_summary': {**case_summary, 'incident_summary': str(summary)},
    }
    return normalized, sources

def _extract_iocs(text: str) -> Dict[str, List[str]]:
    if not text:
        return {"ips": [], "hashes": [], "users": [], "commands": []}

    ips = re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", text)
    hashes = re.findall(r"\b[a-fA-F0-9]{32}\b|\b[a-fA-F0-9]{40}\b|\b[a-fA-F0-9]{64}\b", text)

    users = []
    user_matches = re.findall(r"(?i)\buser(?:name)?\s*[:=]\s*([A-Za-z0-9_.@-]+)", text)
    users.extend(user_matches)

    commands = []
    cmd_matches = re.findall(r"(?i)(?:cmdline|command\s*line)\s*[:=]\s*(.+)", text)
    for c in cmd_matches:
        commands.append(c.strip())

    return {
        "ips": sorted(set(ips)),
        "hashes": sorted(set(hashes)),
        "users": sorted(set(users)),
        "commands": sorted(set(commands)),
    }


def _extract_hostnames(text: str) -> List[str]:
    if not text:
        return []
    hosts = re.findall(r"\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b", text)
    names = re.findall(r"(?i)\bhost(?:name)?\s*[:=]\s*([A-Za-z0-9_.-]+)", text)
    values = [v.strip().lower() for v in (hosts + names) if v and v.strip()]
    return sorted(set(values))


def _build_similar_cases(
    ticket: EventTicket,
    alert_json: Any,
    trigger_rule: str,
    related_logs: List[str],
    limit: int = 5,
) -> List[Dict[str, Any]]:
    inputs = []
    if alert_json is not None:
        inputs.append(_json_dumps_safe(alert_json))
    if trigger_rule:
        inputs.append(trigger_rule)
    if related_logs:
        inputs.extend(related_logs)
    combined = "\n".join([i for i in inputs if i])

    iocs = _extract_iocs(combined)
    keywords = iocs["ips"] + iocs["hashes"] + iocs["users"] + iocs["commands"]
    if not keywords:
        return []

    candidates = (
        EventTicket.objects.filter(is_deleted=False)
        .exclude(ticket_number=ticket.ticket_number)
        .order_by("-created_time")[:200]
    )

    scored: List[Dict[str, Any]] = []
    for c in candidates:
        hay = " ".join(
            [
                c.title or "",
                c.description or "",
                c.alert_message or "",
                c.ticket_records or "",
                c.event_sources or "",
                c.event_platform or "",
            ]
        ).lower()
        matched = [k for k in keywords if k and k.lower() in hay]
        if not matched:
            continue
        scored.append(
            {
                "ticket_number": c.ticket_number,
                "title": c.title,
                "verdict": c.event_result or "",
                "matched_on": sorted(set(matched)),
                "status": c.status,
                "score": len(set(matched)),
            }
        )

    scored.sort(key=lambda x: (-x["score"], x.get("ticket_number", "")))
    return scored[:limit]


def _build_prompt(
    ticket: EventTicket,
    alert_json: Any,
    trigger_rule: str,
    related_logs: List[str],
    similar_cases: List[Dict[str, Any]],
    timeline: List[Dict[str, Any]],
    mcp_context: Dict[str, Any] | None = None,
    user_prompt: str | None = None,
) -> str:
    ticket_ctx = {
        "ticket_number": ticket.ticket_number,
        "title": ticket.title,
        "status": ticket.status,
        "priority": ticket.priority,
        "event_category": ticket.event_category,
        "event_result": ticket.event_result,
        "event_platform": ticket.event_platform,
        "event_scope": ticket.event_scope,
        "event_impact": ticket.event_impact,
        "event_risk_score": ticket.event_risk_score,
        "created_time": str(ticket.created_time),
        "alert_message": ticket.alert_message,
    }

    payload = {
        "user_prompt": user_prompt,
        "alert_json": alert_json,
        "trigger_rule": trigger_rule,
        "related_logs": related_logs,
        "ticket_context": ticket_ctx,
        "similar_cases": similar_cases,
        "timeline": timeline,
        "mcp_context": mcp_context or {},
    }

    if user_prompt:
        return (
            "You are a SOC analyst assistant. Answer the user's request clearly and concisely.\n"
            f"User prompt: {user_prompt}\n"
            "Context (JSON):\n"
            f"{_json_dumps_safe(payload)}"
        )

    return (
        "You are a SOC analyst assistant. Return STRICT JSON only with keys:\n"
        "header (object: risk_level, ai_confidence, score, summary_title),\n"
        "alert_explanation (string),\n"
        "risk_level_recommendation (object: level, rationale),\n"
        "mitre_attack_mapping (array of {tactic, technique, id}),\n"
        "completed_tasks (array of {title, detail}),\n"
        "next_tasks (array of {title, detail}),\n"
        "similar_cases (array of {ticket_number, title, verdict, matched_on, reason}),\n"
        "case_summary (object: incident_summary, timeline, impact_assessment, root_cause, remediation_recommendations).\n"
        "Use provided similar_cases and timeline. Timeline should be array of {time, event}.\n"
        "For tasks: completed_tasks are tasks already done by AI; next_tasks are recommended follow-up tasks.\n"
        "Data:\n"
        f"{_json_dumps_safe(payload)}"
    )


def _parse_structured_json(text: str) -> Dict[str, Any]:
    """Parse the small JSON object requested for one assistant section."""
    value = str(text or '').strip()
    if value.startswith('```'):
        value = re.sub(r'^```(?:json)?\s*|\s*```$', '', value, flags=re.IGNORECASE | re.DOTALL).strip()
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _parse_section_markdown(section: str, text: str) -> Dict[str, Any]:
    """Extract only the requested section when a provider ignores JSON-only instructions."""
    body = str(text or '').strip()

    def field(name: str) -> str:
        match = re.search(rf'(?im)^\s*\**{re.escape(name)}\**\s*:\s*(.+?)\s*$', body)
        return re.sub(r'[*_`]', '', match.group(1)).strip() if match else ''

    def clean(value: str) -> str:
        return re.sub(r'\s+', ' ', re.sub(r'[*_`]', '', value)).strip()

    def heading(name: str) -> str:
        match = re.search(
            rf'(?is)(?:^|\n)###\s+\**{re.escape(name)}\**\s*\n(.*?)(?=\n###\s|\Z)',
            body,
        )
        return (match.group(1) if match else '').strip()

    if section == 'header':
        score_match = re.search(r'(?i)\brisk\s+score\s*:\s*(\d+)', body)
        confidence_match = re.search(r'(?i)(?:\bconfidence\s*:\s*(\d{1,3})\s*%|(\d{1,3})\s*%\s*confidence)', body)
        score = int(score_match.group(1)) if score_match else 0
        priority = (field('Priority') or 'medium').lower()
        level = 'critical' if score >= 90 else 'high' if score >= 70 else priority
        if level not in {'critical', 'high', 'medium', 'low', 'info'}:
            level = 'medium'
        return {'header': {
            'risk_level': level,
            'ai_confidence': f'{confidence_match.group(1) or confidence_match.group(2)}%' if confidence_match else '70%',
            'score': score,
            'summary_title': field('Title') or 'SOC incident analysis',
            'status': field('Status') or 'new',
            'platform': '',
            'source': '',
        }}

    if section == 'summary':
        summary = clean(heading('Summary')) or clean(body[:1200])
        return {
            'alert_explanation': summary,
            'risk_level_recommendation': {
                'level': 'high' if re.search(r'(?i)risk score\s*:\s*[7-9]\d|risk score\s*:\s*100', body) else 'medium',
                'rationale': 'Derived from the AI incident analysis.',
            },
            'case_summary': {
                'incident_summary': summary,
                'impact_assessment': 'Pending validation.',
                'root_cause': 'Under investigation.',
                'remediation_recommendations': [],
            },
        }

    if section == 'tasks':
        action_section = heading('Recommended Actions') or heading('Immediate Actions')
        actions = []
        for line in action_section.splitlines():
            match = re.match(r'^\s*\d+\.\s+(.+?)\s*$', line)
            if match:
                title = clean(match.group(1))
                if title:
                    actions.append({'title': title, 'detail': 'Recommended follow-up action from the AI analysis.'})
        return {
            'completed_tasks': [
                {'title': 'AI incident triage', 'detail': 'Generated an incident summary and extracted key indicators.'}
            ],
            'next_tasks': actions,
        }
    return {}

def _generate_structured_sections(prompt: str, overrides: Dict[str, Any] | None = None) -> tuple[Dict[str, Any], List[str]]:
    """Request each UI section independently so one long answer cannot erase others."""
    specs = [
        (
            'header',
            'Return STRICT JSON only with exactly this shape: '
            '{"header":{"risk_level":"critical|high|medium|low|info",'
            '"ai_confidence":"string","score":0,"summary_title":"string",'
            '"status":"string","platform":"string","source":"string"}}',
        ),
        (
            'summary',
            'Return STRICT JSON only with exactly this shape: '
            '{"alert_explanation":"string",'
            '"risk_level_recommendation":{"level":"string","rationale":"string"},'
            '"case_summary":{"incident_summary":"string","impact_assessment":"string",'
            '"root_cause":"string","remediation_recommendations":["string"]}}',
        ),
        (
            'tasks',
            'Return STRICT JSON only with exactly this shape: '
            '{"completed_tasks":[{"title":"string","detail":"string"}],'
            '"next_tasks":[{"title":"string","detail":"string"}]}',
        ),
    ]
    assistant: Dict[str, Any] = {}
    raw_failures: List[str] = []
    for name, schema in specs:
        section_prompt = (
            'You are a SOC analyst. Generate only the requested section. '
            'Do not use Markdown, commentary, or code fences.\n'
            f'Requested section: {name}\n{schema}\n'
            'Use the following ticket context:\n'
            f'{prompt}'
        )
        response = _call_openai(section_prompt, overrides=overrides)
        response_text = _extract_response_text(response)
        parsed = _parse_structured_json(response_text)
        fallback = _parse_section_markdown(name, response_text)
        if parsed and fallback:
            if name == 'header':
                parsed_header = parsed.get('header') if isinstance(parsed.get('header'), dict) else {}
                fallback_header = fallback.get('header') if isinstance(fallback.get('header'), dict) else {}
                if not parsed_header.get('score') and fallback_header.get('score'):
                    parsed_header['score'] = fallback_header['score']
                if not parsed_header.get('ai_confidence') or parsed_header.get('ai_confidence') == '70%':
                    parsed_header['ai_confidence'] = fallback_header.get('ai_confidence', parsed_header.get('ai_confidence'))
                parsed['header'] = {**fallback_header, **parsed_header}
            if name == 'tasks':
                if not isinstance(parsed.get('completed_tasks'), list) or not parsed.get('completed_tasks'):
                    parsed['completed_tasks'] = fallback.get('completed_tasks', [])
                if not isinstance(parsed.get('next_tasks'), list) or not parsed.get('next_tasks'):
                    parsed['next_tasks'] = fallback.get('next_tasks', [])
        elif not parsed:
            parsed = fallback
        if parsed:
            assistant.update(parsed)
        else:
            raw_failures.append(f'{name}: {response_text[:4000]}')
    return assistant, raw_failures

def _parse_responses_stream(res: requests.Response) -> Dict[str, Any]:
    text_buffer: List[str] = []
    last_response: Dict[str, Any] | None = None
    for raw in res.iter_lines(decode_unicode=True):
        if not raw:
            continue
        line = raw.strip()
        if line.startswith("data:"):
            line = line[len("data:"):].strip()
        if not line or line == "[DONE]":
            if line == "[DONE]":
                break
            continue
        try:
            payload = json.loads(line)
        except Exception:
            continue
        if isinstance(payload, dict):
            if isinstance(payload.get("response"), dict):
                last_response = payload.get("response")
            if isinstance(payload.get("output_text"), str):
                text_buffer.append(payload.get("output_text"))
            if payload.get("type") == "response.output_text.delta":
                delta = payload.get("delta")
                if isinstance(delta, str):
                    text_buffer.append(delta)
    if last_response:
        return last_response
    return {"output_text": "".join(text_buffer)}


def _normalize_base_url(raw: str) -> str:
    base = (raw or "").strip()
    if not base:
        return base
    if "/v1" in base:
        return base.rstrip("/")
    if base.rstrip("/").endswith("/openai"):
        return f"{base.rstrip('/')}/v1"
    return base.rstrip("/")


def _call_openai(prompt: str, overrides: Dict[str, Any] | None = None) -> Dict[str, Any]:
    overrides = overrides or {}
    api_key = overrides.get("api_key") or _get_setting("OPENAI_API_KEY")
    if not api_key:
        raise AIAssistantError("OPENAI_API_KEY is not configured")

    base_url = overrides.get("base_url") or _get_setting("OPENAI_BASE_URL", "https://api.openai.com/v1")
    base_url = _normalize_base_url(base_url)
    model = overrides.get("model") or _get_setting("OPENAI_MODEL", "gpt-5.1-codex")
    timeout_value = overrides.get("timeout_seconds")
    if timeout_value in (None, ""):
        timeout_value = _get_setting("OPENAI_TIMEOUT_SECONDS", 45)
    try:
        timeout = int(timeout_value or 45)
    except Exception:
        timeout = 45

    url = f"{base_url.rstrip('/')}/responses"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt}
                ],
            }
        ],
        "temperature": 0.2,
        "max_output_tokens": 1200,
        "stream": True,
    }

    res = requests.post(url, headers=headers, json=payload, timeout=timeout, stream=True)
    if res.status_code >= 400:
        logger.error("OpenAI API error: %s %s", res.status_code, res.text[:2000])
        raise AIAssistantError(f"OpenAI API error: {res.status_code}")
    content_type = str(res.headers.get("content-type") or "")
    if "text/event-stream" in content_type:
        return _parse_responses_stream(res)
    try:
        return res.json()
    except Exception:
        return _parse_responses_stream(res)


def test_openai_connectivity(overrides: Dict[str, Any] | None = None) -> Dict[str, Any]:
    probe_prompt = (
        "Return STRICT JSON only: {\"ok\": true, \"message\": \"pong\"}"
    )
    response = _call_openai(probe_prompt, overrides=overrides)
    text = _extract_response_text(response)
    return {
        "ok": True,
        "model": (overrides or {}).get("model") or _get_setting("OPENAI_MODEL", "gpt-5.1-codex"),
        "response_preview": (text or "")[:120],
    }


def _decide_mcp_target_by_ai(
    user_prompt: str,
    overrides: Dict[str, Any] | None = None,
) -> Dict[str, Any] | None:
    overrides = overrides or {}
    mcp = overrides.get("mcp") if isinstance(overrides.get("mcp"), dict) else {}
    servers = mcp.get("servers") if isinstance(mcp.get("servers"), list) else []
    options: List[Dict[str, str]] = []
    for item in servers:
        if not isinstance(item, dict):
            continue
        endpoint = str(item.get("endpoint") or "").strip()
        title = str(item.get("title") or "").strip()
        if endpoint:
            options.append({"title": title, "endpoint": endpoint})
    if not options:
        base_url = str((mcp or {}).get("base_url") or "").strip()
        if base_url:
            options.append({"title": "", "endpoint": base_url})
    if not options:
        return None

    route_prompt = (
        "You are an MCP router. Choose ONE best MCP target for the user request.\n"
        "Return STRICT JSON only with keys: target_mcp (string), confidence (0..1), reason (string).\n"
        f"User request: {user_prompt}\n"
        f"Available MCP targets: {_json_dumps_safe(options)}\n"
        "target_mcp must be a substring from title or endpoint."
    )
    try:
        response = _call_openai(route_prompt, overrides=overrides)
        text = _extract_response_text(response)
        data = json.loads(text) if text else {}
        target_mcp = str((data or {}).get("target_mcp") or "").strip()
        confidence = float((data or {}).get("confidence") or 0)
        reason = str((data or {}).get("reason") or "").strip()
        if not target_mcp:
            return None
        if confidence < 0.45:
            return None
        return {"target_mcp": target_mcp, "confidence": confidence, "reason": reason}
    except Exception:
        return None


def _decide_mcp_tool_and_args_by_ai(
    user_prompt: str,
    tools_catalog: List[Dict[str, Any]],
    ticket_number: str,
    alert_json: Any,
    raw_message: str,
    related_logs: List[str],
    overrides: Dict[str, Any] | None = None,
) -> Dict[str, Any] | None:
    if not tools_catalog:
        return None
    planner_prompt = (
        "You are an MCP tool planner. Choose ONE tool and arguments.\n"
        "Return STRICT JSON only with keys: endpoint, tool_name, arguments, confidence, reason.\n"
        "Rules:\n"
        "- endpoint must be exactly one endpoint from catalog.\n"
        "- tool_name must be exactly one tool from that endpoint.\n"
        "- arguments must satisfy required inputSchema fields.\n"
        "- Include ticket_number when schema allows it.\n"
        f"User request: {user_prompt}\n"
        f"Catalog: {_json_dumps_safe(tools_catalog)}\n"
        f"Context: {_json_dumps_safe({'ticket_number': ticket_number, 'alert_json': alert_json, 'raw_message': raw_message, 'related_logs': related_logs[:5]})}"
    )
    try:
        response = _call_openai(planner_prompt, overrides=overrides)
        text = _extract_response_text(response)
        data = json.loads(text) if text else {}
        endpoint = str((data or {}).get("endpoint") or "").strip()
        tool_name = str((data or {}).get("tool_name") or "").strip()
        arguments = (data or {}).get("arguments")
        confidence = float((data or {}).get("confidence") or 0)
        reason = str((data or {}).get("reason") or "").strip()
        if not endpoint or not tool_name or not isinstance(arguments, dict):
            return None
        if confidence < 0.45:
            return None
        return {
            "endpoint": endpoint,
            "tool_name": tool_name,
            "arguments": arguments,
            "confidence": confidence,
            "reason": reason,
        }
    except Exception:
        return None


def generate_ai_assistant_output(
    ticket: EventTicket,
    alert_json: Any,
    trigger_rule: str,
    related_logs: List[str],
    user_prompt: str | None = None,
    overrides: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    mcp_context: Dict[str, Any] | None = None
    observables_payload: Dict[str, Any] | None = {}
    cmdb_assets: List[Dict[str, Any]] = []
    similar_cases: List[Dict[str, Any]] = []

    if user_prompt:
        route_decision = _decide_mcp_target_by_ai(user_prompt=user_prompt, overrides=overrides)
        record_mcp_monitor_event(
            tool="dynamic-route-decision",
            status="completed" if route_decision else "failed",
            request_payload={"user_prompt": user_prompt},
            response_payload=route_decision or {},
            error=None if route_decision else "ai route decision unavailable",
        )
        tools_catalog = get_mcp_tools_catalog(
            prompt=user_prompt,
            target_mcp=(route_decision or {}).get("target_mcp"),
            overrides=overrides,
        )
        record_mcp_monitor_event(
            tool="dynamic-tools-catalog",
            status="completed" if tools_catalog else "failed",
            request_payload={"target_mcp": (route_decision or {}).get("target_mcp"), "prompt": user_prompt},
            response_payload={"catalog_size": len(tools_catalog or []), "catalog": tools_catalog or []},
            error=None if tools_catalog else "no tools discovered for target mcp",
        )
        tool_plan = _decide_mcp_tool_and_args_by_ai(
            user_prompt=user_prompt,
            tools_catalog=tools_catalog,
            ticket_number=ticket.ticket_number,
            alert_json=alert_json if isinstance(alert_json, dict) else None,
            raw_message=str(ticket.alert_message or ""),
            related_logs=[str(v) for v in (related_logs or []) if v is not None],
            overrides=overrides,
        )
        record_mcp_monitor_event(
            tool="dynamic-tool-plan",
            status="completed" if tool_plan else "failed",
            request_payload={"user_prompt": user_prompt, "target_mcp": (route_decision or {}).get("target_mcp")},
            response_payload=tool_plan or {},
            error=None if tool_plan else "ai tool planning unavailable",
        )
        dynamic_call = None
        if tool_plan:
            args = dict(tool_plan.get("arguments") or {})
            if "ticket_number" not in args:
                args["ticket_number"] = ticket.ticket_number
            dynamic_call = invoke_mcp_tool_explicit(
                tool_name=str(tool_plan.get("tool_name") or ""),
                arguments=args,
                target_mcp=(route_decision or {}).get("target_mcp"),
                overrides=overrides,
            )
        if dynamic_call is None:
            record_mcp_monitor_event(
                tool="dynamic-tool-execution",
                status="failed",
                request_payload=tool_plan or {},
                error="tool execution failed or no callable tool",
            )
        mcp_context = {
            "dynamic_tool_call": dynamic_call or {},
            "route_decision": route_decision or {},
            "tool_plan": tool_plan or {},
        }
    else:
        mcp_context = fetch_ticket_context(ticket.ticket_number, overrides=overrides)

        inputs_for_iocs: List[str] = []
        if alert_json is not None:
            inputs_for_iocs.append(_json_dumps_safe(alert_json))
        if trigger_rule:
            inputs_for_iocs.append(trigger_rule)
        if related_logs:
            inputs_for_iocs.extend([str(v) for v in related_logs if v is not None])
        ioc_source_text = "\n".join(inputs_for_iocs)
        observables_payload = fetch_observables(
            ticket.ticket_number,
            raw_message=str(ticket.alert_message or ""),
            alert_json=alert_json if isinstance(alert_json, dict) else None,
            text=ioc_source_text,
            overrides=overrides,
        ) or {}
        observables = observables_payload.get("observables") if isinstance(observables_payload, dict) else {}
        if not isinstance(observables, dict):
            observables = {}

        iocs = _extract_iocs(ioc_source_text)
        mcp_ips = observables.get("ip") if isinstance(observables.get("ip"), list) else []
        mcp_hashes = observables.get("hash") if isinstance(observables.get("hash"), list) else []
        mcp_users = observables.get("user") if isinstance(observables.get("user"), list) else []
        iocs["ips"] = sorted(set(iocs.get("ips", []) + [str(v).strip() for v in mcp_ips if str(v).strip()]))
        iocs["hashes"] = sorted(set(iocs.get("hashes", []) + [str(v).strip() for v in mcp_hashes if str(v).strip()]))
        iocs["users"] = sorted(set(iocs.get("users", []) + [str(v).strip() for v in mcp_users if str(v).strip()]))

        hostnames = _extract_hostnames(ioc_source_text)
        mcp_domains = observables.get("domain") if isinstance(observables.get("domain"), list) else []
        hostnames = sorted(set(hostnames + [str(v).strip().lower() for v in mcp_domains if str(v).strip()]))
        cmdb_assets = fetch_cmdb_assets(
            ticket.ticket_number,
            indicators={
                "ips": iocs.get("ips", []),
                "hostnames": hostnames,
                "asset_numbers": observables.get("asset_number") if isinstance(observables.get("asset_number"), list) else [],
            },
            limit=10,
            overrides=overrides,
        ) or []

        similar_cases = fetch_similar_cases(ticket.ticket_number, iocs=iocs, limit=5, overrides=overrides) or []
        if not similar_cases:
            similar_cases = _build_similar_cases(ticket, alert_json, trigger_rule, related_logs)

    work_logs = (
        TicketWorkLog.objects.filter(ticket=ticket)
        .order_by("created_at")
        .values_list("created_at", "log_entry")
    )
    timeline = [{"time": str(t), "event": e} for t, e in work_logs[:10]]
    if isinstance(mcp_context, dict):
        mcp_timeline = mcp_context.get("timeline")
        if isinstance(mcp_timeline, list) and mcp_timeline:
            normalized: List[Dict[str, Any]] = []
            for item in mcp_timeline[:20]:
                if not isinstance(item, dict):
                    continue
                t = item.get("time") or item.get("created_at") or item.get("timestamp") or ""
                e = item.get("event") or item.get("message") or item.get("log_entry") or ""
                if t or e:
                    normalized.append({"time": str(t), "event": str(e)})
            if normalized:
                timeline = normalized

    prompt = _build_prompt(
        ticket,
        alert_json,
        trigger_rule,
        related_logs,
        similar_cases,
        timeline,
        mcp_context=mcp_context,
        user_prompt=user_prompt,
    )
    enabled_skills = (overrides or {}).get("skills") if isinstance((overrides or {}).get("skills"), list) else []
    ticket_hint = " ".join([
        str(getattr(ticket, "event_category", "") or ""),
        str(getattr(ticket, "ticket_category", "") or ""),
        str(getattr(ticket, "title", "") or ""),
    ]).lower()
    skill_items = []
    for item in enabled_skills:
        skill_name = str(item.get("name") or item.get("route") or "").strip() if isinstance(item, dict) else str(item).strip()
        if skill_name and skill_name.lower() in ticket_hint:
            skill_items.append(item)
    selected_skills = skill_items or enabled_skills
    skill_instructions = []
    selected_skill_names = []
    for item in selected_skills:
        skill_name = str(item.get("name") or item.get("route") or "").strip() if isinstance(item, dict) else str(item).strip()
        skill_doc = read_skill(skill_name)
        if skill_doc and skill_doc.content:
            selected_skill_names.append(skill_name)
            skill_instructions.append(f"SKILL: {skill_doc.name}\n{skill_doc.content[:12000]}")
    if skill_instructions:
        prompt += "\n\nEnabled skill instructions (follow only when supported by ticket evidence):\n" + "\n\n".join(skill_instructions)
    raw_failures: List[str] = []
    if user_prompt:
        response = _call_openai(prompt, overrides=overrides)
        text = _extract_response_text(response)
        parsed = _parse_structured_json(text)
    else:
        parsed, raw_failures = _generate_structured_sections(prompt, overrides=overrides)
        text = '\n\n'.join(raw_failures)

    parsed = apply_local_skills(
        assistant=parsed,
        ticket=ticket,
        timeline=timeline,
        skills=(overrides or {}).get("skills"),
    )
    normalized_assistant, field_sources = _normalize_ai_assistant(parsed, ticket=ticket, raw_text=text)

    return {
        "model": (overrides or {}).get("model") or _get_setting("OPENAI_MODEL", "gpt-5.1-codex"),
        "input_snapshot": {
            "user_prompt": user_prompt,
            "alert_json": alert_json,
            "trigger_rule": trigger_rule,
            "related_logs": related_logs,
        },
        "similar_cases": similar_cases,
        "cmdb_assets": cmdb_assets,
        "observables": observables_payload,
        "timeline": timeline,
        "mcp_context": {
            **(mcp_context or {}),
            "cmdb_assets": cmdb_assets,
            "observables": observables_payload,
        },
        "assistant": normalized_assistant,
        "skills_used": selected_skill_names,
        "field_sources": field_sources,
        "raw_response": text if text else None,
        "assistant_raw": text if text else None,
    }
