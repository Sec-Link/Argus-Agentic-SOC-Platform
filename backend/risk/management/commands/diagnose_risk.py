"""Diagnose why risk_objects are not being extracted into alerts.

Usage:
    python manage.py diagnose_risk                 # scan configs + recent alerts
    python manage.py diagnose_risk --rule <uuid>   # focus one rule
    python manage.py diagnose_risk --alert <id>    # replay one alert through the pipeline

Prints a step-by-step verdict so you can see exactly where the pipeline stops.
"""

import json

from django.core.management.base import BaseCommand

from alerts.models import Alert
from risk.models import GlobalRiskConfig, RiskEvent, RiskObjectProfile, RiskRuleConfig
from risk.services import _extract_risk_objects, _resolve_field_config, process_alert_for_risk


def _p(ok, msg):
    print(f"  [{'OK ' if ok else 'XX '}] {msg}")


class Command(BaseCommand):
    help = "Diagnose the risk_object extraction pipeline."

    def add_arguments(self, parser):
        parser.add_argument("--rule", dest="rule", default=None, help="RiskRuleConfig.rule_uuid to inspect")
        parser.add_argument("--alert", dest="alert", default=None, help="Alert.alert_id to replay through the pipeline")

    def handle(self, *args, **opts):
        print("\n=== 1. Global config ===")
        gcfg = GlobalRiskConfig.objects.order_by("id").first()
        if gcfg:
            _p(bool(gcfg.risk_object_fields), f"GlobalRiskConfig fields={gcfg.risk_object_fields} aliases={gcfg.field_aliases}")
        else:
            _p(False, "No GlobalRiskConfig row exists (rule-level config is then the only source).")

        print("\n=== 2. Rule configs ===")
        rq = RiskRuleConfig.objects.all()
        if opts["rule"]:
            rq = rq.filter(rule_uuid=opts["rule"])
        if not rq.exists():
            _p(False, "No RiskRuleConfig rows found. Did you press Save on the Risk Object Fields panel?")
        for c in rq:
            _p(c.enabled, f"rule_uuid={c.rule_uuid} enabled={c.enabled} "
                          f"fields={[f.get('field') for f in c.risk_object_fields]} "
                          f"aliases={c.field_aliases}")
            if not c.enabled:
                print("        -> RBA is OFF for this rule; _resolve_field_config() will ignore its "
                      "fields+aliases (only enabled=True is matched). Toggle RBA ON and Save.")

        print("\n=== 3. Recent alerts (do their rule_id / fields line up?) ===")
        aq = Alert.objects.order_by("-timestamp")
        if opts["alert"]:
            aq = aq.filter(alert_id=opts["alert"])
        for a in aq[:5]:
            has_rid = bool((a.rule_id or "").strip())
            _p(has_rid, f"alert_id={a.alert_id} rule_id={a.rule_id!r} risk_objects={a.risk_objects}")
            src = a.source_data if isinstance(a.source_data, dict) else {}
            # Show whether a matching config resolves for this alert's rule_id
            fields, aliases = _resolve_field_config((a.rule_id or "").strip())
            if not fields:
                print("        -> _resolve_field_config returned NO fields for this rule_id "
                      "(no enabled rule config AND no global fields). Nothing will be extracted.")
                continue
            extracted = _extract_risk_objects(src, fields, aliases)
            _p(bool(extracted), f"would extract: {json.dumps(extracted, ensure_ascii=False)}")
            if not extracted:
                print(f"        -> configured fields {[f.get('field') for f in fields]} + aliases {aliases} "
                      f"found nothing in source_data. Top-level keys present: {sorted(src.keys())[:20]}")

        if opts["alert"]:
            print("\n=== 4. Live replay through process_alert_for_risk ===")
            a = Alert.objects.filter(alert_id=opts["alert"]).first()
            if not a:
                _p(False, f"alert_id={opts['alert']} not found")
                return
            doc = dict(a.source_data or {})
            doc.setdefault("alert_id", a.alert_id)
            doc.setdefault("rule_id", a.rule_id)
            doc.setdefault("severity", a.severity)
            events = process_alert_for_risk(doc)
            _p(bool(events), f"process_alert_for_risk created {len(events)} RiskEvent(s)")
            a.refresh_from_db()
            _p(bool(a.risk_objects), f"Alert.risk_objects after replay = {a.risk_objects}")

        print("\n=== summary counts ===")
        print(f"  RiskRuleConfig={RiskRuleConfig.objects.count()} "
              f"RiskObjectProfile={RiskObjectProfile.objects.count()} "
              f"RiskEvent={RiskEvent.objects.count()}")
        print()
