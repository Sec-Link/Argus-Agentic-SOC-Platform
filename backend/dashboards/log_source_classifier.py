"""Heuristic classification of ES log sources into the SOC's log source categories.

Pure functions only (no ES / DB access) so the rules can be exercised in isolation. The result is
a *suggestion*: admins can override it per source through `LogSourceMapping`.
"""
import re

UNCLASSIFIED = "Unclassified"

# Elastic data stream naming: <type>-<dataset>-<namespace>, e.g. logs-okta.system-default.
_DATA_STREAM_RE = re.compile(r"^(logs|metrics|traces|synthetics)-([^-]+)-[^-]+$")
# Date / rollover / version suffixes appended to classic time-based indices.
_SUFFIX_RES = [
    re.compile(r"-\d{4}[.\-]\d{2}[.\-]\d{2}(-\d+)?$"),  # -2026.10.27 / -2026-10-27 / -2026.10.27-000001
    re.compile(r"-\d{4}[.\-]\d{2}$"),  # -2026.10
    re.compile(r"_\d{8}$"),  # _20261027
    re.compile(r"-\d{6}$"),  # -000001
    re.compile(r"-\d+\.\d+\.\d+$"),  # -8.11.0 (beat version)
]


def normalize_source_key(index_name):
    """Collapse a concrete index / backing index / data stream name to its logical source key.

    `.ds-logs-okta.system-default-2026.10.01-000001` -> `logs-okta.system-*`
    `winlogbeat-8.11.0-2026.10.27`                   -> `winlogbeat-*`
    `fw-logs`                                        -> `fw-logs`
    """
    name = index_name.strip()
    if name.startswith(".ds-"):
        name = name[4:]
    stripped = name
    changed = True
    while changed:
        changed = False
        for rx in _SUFFIX_RES:
            new = rx.sub("", stripped)
            if new != stripped and new:
                stripped, changed = new, True
    m = _DATA_STREAM_RE.match(stripped)
    if m:
        return f"{m.group(1)}-{m.group(2)}-*"
    if stripped != name:
        return f"{stripped}-*"
    return name


def is_internal_source(index_name):
    """System / hidden indices (.kibana, .alerts-*, .internal.*, ...) are never log sources."""
    name = index_name[4:] if index_name.startswith(".ds-") else index_name
    return name.startswith(".")


# Ordered: the first matching rule wins, so specific classes precede generic ones.
# (category, confidence, pattern over "<source_key> <modules> <datasets>")
_NAME_RULES = [
    ("EDR", "high", r"crowdstrike|sentinel_?one|sentinelone|carbon_?black|cortex_?xdr|cylance|trellix|"
                    r"defender_endpoint|microsoft_defender|m365_defender|elastic_endpoint|(?<![a-z0-9])logs-endpoint\."),
    ("Email", "high", r"mimecast|proofpoint|gmail|abnormal_security|tessian|o365\.(message|email)|"
                      r"(?<![a-z0-9])(e-?mail|exchange|smtp)(?![a-z0-9])"),
    ("DNS", "high", r"(?<![a-z0-9])dns(?![a-z0-9])|infoblox|umbrella|bind9|pihole"),
    ("Firewall", "high", r"panw|panos|palo_?alto|fortinet|fortigate|check_?point|cisco[._]?(asa|ftd|meraki)|"
                         r"firewall|pfsense|opnsense|sonicwall|juniper|zscaler|iptables|netscreen"),
    ("Firewall", "medium", r"suricata|zeek|snort|(?<![a-z0-9])ids(?![a-z0-9])|netflow|packetbeat"),
    ("Identity", "high", r"okta|signinlogs|azure[._]auditlogs|entra|azure_ad|active_?directory|ldap|(?<![a-z0-9])duo(?![a-z0-9])|"
                         r"onelogin|auth0|keycloak|o365\.audit|ping_?identity|cyberark"),
    ("Cloud", "high", r"cloudtrail|guardduty|cloudwatch|vpcflow|(?<![a-z0-9])aws(?![a-z0-9])|azure[._](activitylogs|platformlogs)|"
                      r"googlecloud|(?<![a-z0-9])gcp(?![a-z0-9])|kubernetes|(?<![a-z0-9])azure(?![a-z0-9])"),
    ("Endpoint", "high", r"winlogbeat|sysmon|auditbeat|osquery|auditd|(?<![a-z0-9])windows(?![a-z0-9])|"
                         r"(?<![a-z0-9])logs-system\.|(?<![a-z0-9])system\.(syslog|auth|security)"),
]
_COMPILED_NAME_RULES = [(c, conf, re.compile(p)) for c, conf, p in _NAME_RULES]

# ECS event.category fallbacks (weaker signal).
_ECS_CATEGORY_RULES = [
    ("Identity", {"authentication", "iam"}),
    ("Endpoint", {"process", "file", "registry", "host"}),
    ("Firewall", {"network"}),
]


def classify_source(source_key, modules=(), datasets=(), categories=()):
    """Return {"category", "confidence", "reason"}; category is UNCLASSIFIED when nothing matches."""
    haystack = " ".join([source_key, *modules, *datasets]).lower()
    for category, confidence, rx in _COMPILED_NAME_RULES:
        m = rx.search(haystack)
        if m:
            return {"category": category, "confidence": confidence, "reason": f"name/module matches '{m.group(0)}'"}
    ecs = {c.lower() for c in categories}
    for category, wanted in _ECS_CATEGORY_RULES:
        hit = ecs & wanted
        if hit:
            return {"category": category, "confidence": "medium", "reason": f"event.category = {sorted(hit)[0]}"}
    return {"category": UNCLASSIFIED, "confidence": "none", "reason": "no rule matched"}
