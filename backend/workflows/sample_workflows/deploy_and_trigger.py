"""
Automate Prefect deployment and trigger a Django workflow execution.

This script uses only the Python standard library and supports a dry-run mode.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from typing import Any, Dict
from urllib import request


def run_command(command: list[str], dry_run: bool) -> None:
    if dry_run:
        print("[dry-run]", " ".join(command))
        return
    subprocess.run(command, check=True)


def trigger_django(
    *,
    base_url: str,
    token: str,
    workflow_id: str,
    trigger_data: Dict[str, Any],
    dry_run: bool,
) -> None:
    url = base_url.rstrip("/") + f"/api/v1/workflows/workflows/{workflow_id}/execute/"
    payload = json.dumps(
        {
            "trigger_data": trigger_data,
            "trigger_source": "manual",
            "confirm_mass_update": False,
        }
    ).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Token {token}",
    }

    if dry_run:
        print("[dry-run] POST", url)
        print(payload.decode("utf-8"))
        return

    req = request.Request(url, data=payload, headers=headers, method="POST")
    with request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
        print(body)


def parse_trigger_data(raw: str) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON for --trigger-data: {exc}") from exc
    if not isinstance(parsed, dict):
        raise SystemExit("--trigger-data must be a JSON object")
    return parsed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--deploy", action="store_true", help="Deploy the Prefect flow")
    parser.add_argument("--trigger", action="store_true", help="Trigger a Django execution")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without executing")

    parser.add_argument(
        "--flow",
        default="backend/workflows/sample_workflows/critical_alert_email_workflow.py:main",
        help="Prefect flow entrypoint",
    )
    parser.add_argument("--name", default="critical-alert-email", help="Deployment name")
    parser.add_argument("--pool", default="default-process", help="Work pool name")

    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Django base URL")
    parser.add_argument("--token", default="", help="Django API token")
    parser.add_argument("--workflow-id", default="", help="Workflow ID to execute")
    parser.add_argument(
        "--trigger-data",
        default=(
            "{\"title\":\"Manual critical alert\","
            "\"severity\":\"critical\","
            "\"source\":\"manual\","
            "\"created_at\":\"2026-05-29T12:00:00Z\"}"
        ),
        help="JSON object for trigger_data",
    )

    args = parser.parse_args()

    if args.deploy:
        run_command([
            "prefect",
            "deploy",
            args.flow,
            "--name",
            args.name,
            "--pool",
            args.pool,
        ], args.dry_run)

    if args.trigger:
        if not args.token or not args.workflow_id:
            raise SystemExit("--token and --workflow-id are required for --trigger")
        trigger_data = parse_trigger_data(args.trigger_data)
        trigger_django(
            base_url=args.base_url,
            token=args.token,
            workflow_id=args.workflow_id,
            trigger_data=trigger_data,
            dry_run=args.dry_run,
        )

    if not args.deploy and not args.trigger:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
