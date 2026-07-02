"""
Prefect flow: send email when a manually created critical alert is received.

This sample uses the existing workflows ActionRegistry so it stays aligned
with the Django-side action definitions.
"""
from __future__ import annotations

from typing import Any, Dict

from prefect import flow, task, get_run_logger


def _ensure_django_ready() -> None:
    import os
    import sys

    backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    if backend_root not in sys.path:
        sys.path.insert(0, backend_root)
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'siem_project.settings')
    import django

    if not django.apps.apps.ready:
        django.setup()


@task
def should_notify(trigger_data: Dict[str, Any], trigger_source: str) -> bool:
    severity = str(trigger_data.get('severity') or '').lower().strip()
    source = str(trigger_data.get('source') or trigger_source or '').lower().strip()
    return severity == 'critical' and source == 'manual'


@task
def send_critical_email(trigger_data: Dict[str, Any], dry_run: bool = False) -> Dict[str, Any]:
    _ensure_django_ready()
    from workflows.actions import ActionRegistry

    if dry_run:
        return {
            'sent_to': ['achen@seclink.info'],
            'subject': '[DRY RUN] Critical alert received',
            'dry_run': True,
        }

    action = ActionRegistry.get_action('send_email')
    config = {
        'to': ['achen@seclink.info'],
        'subject': 'Critical alert received',
        'body': (
            'A critical alert was manually created.\n\n'
            'Alert title: {{trigger_data.title}}\n'
            'Severity: {{trigger_data.severity}}\n'
            'Source: {{trigger_data.source}}\n'
            'Created at: {{trigger_data.created_at}}\n'
        ),
        'is_html': False,
    }
    context = {
        'trigger_data': trigger_data or {},
        'trigger_source': 'manual',
    }
    result = action.execute(config, context)
    return result.to_dict()


@flow(name='critical-alert-email')
def main(
    trigger_data: Dict[str, Any],
    trigger_source: str = 'manual',
    dry_run: bool = False,
) -> Dict[str, Any]:
    logger = get_run_logger()

    if not should_notify(trigger_data, trigger_source):
        logger.info('Alert does not meet critical/manual criteria. Skipping.')
        return {'status': 'skipped', 'reason': 'not critical manual alert'}

    result = send_critical_email(trigger_data, dry_run)
    return {'status': 'sent', 'result': result}


if __name__ == '__main__':
    main.serve(name='critical-alert-email')

