"""Encrypt or rotate workflow secret variables and sensitive action configuration."""
from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction

from workflows.models import ActionTemplate, SavedWorkflowNode, StepExecution, Workflow, WorkflowRevision, WorkflowStep
from workflows.publisher import publish_workflow
from workflows.prefect.secrets import decrypt_secret_variable, encrypt_payload
from workflows.secret_config import (
    SecretConfigError,
    prepare_config_for_storage,
    prepare_secret_variables,
    rotate_config,
)


class Command(BaseCommand):
    help = (
        "Encrypt plaintext workflow secrets in database rows and Prefect manifests. "
        "The command is a dry-run unless --apply is supplied."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Persist the validated changes. Without this flag no writes occur.",
        )
        parser.add_argument(
            "--rotate",
            action="store_true",
            help="Re-encrypt existing ciphertext with the first WORKFLOW_ENCRYPTION_KEYS key.",
        )
        parser.add_argument(
            "--skip-publish",
            action="store_true",
            help="Do not publish a fresh version of currently published Prefect workflows.",
        )

    @staticmethod
    def _secure(action_type, config, rotate):
        secured = prepare_config_for_storage(action_type or "", config or {})
        return rotate_config(action_type or "", secured) if rotate else secured

    @staticmethod
    def _secure_variables(variables, rotate):
        secured = prepare_secret_variables(variables or {})
        if not rotate:
            return secured
        keys = getattr(settings, "WORKFLOW_ENCRYPTION_KEYS", None) or []
        return {
            name: encrypt_payload({
                "version": 1, "kind": "workflow_variable", "name": name,
                "value": decrypt_secret_variable(name, value, keys),
            }, keys)
            for name, value in secured.items()
        }

    def _collect_database_changes(self, rotate):
        changes = []
        for item in Workflow.objects.select_for_update().order_by('pk').iterator():
            secured = self._secure_variables(item.secret_variables, rotate)
            if secured != (item.secret_variables or {}):
                changes.append((Workflow, item.pk, "secret_variables", secured))

        for item in ActionTemplate.objects.select_for_update().iterator():
            secured = self._secure(item.action_type, item.default_config, rotate)
            if secured != (item.default_config or {}):
                changes.append((ActionTemplate, item.pk, "default_config", secured))

        for item in WorkflowStep.objects.select_for_update().iterator():
            secured = self._secure(item.action_type, item.action_config, rotate)
            if secured != (item.action_config or {}):
                changes.append((WorkflowStep, item.pk, "action_config", secured))

        for item in SavedWorkflowNode.objects.select_for_update().iterator():
            secured = self._secure(item.action_type, item.action_config, rotate)
            if secured != (item.action_config or {}):
                changes.append((SavedWorkflowNode, item.pk, "action_config", secured))

        for item in StepExecution.objects.select_for_update().iterator():
            current = item.input_data or {}
            if not isinstance(current, dict):
                continue
            if isinstance(current.get("action_config"), dict):
                secured = dict(current)
                secured["action_config"] = self._secure(
                    item.action_type, current["action_config"], rotate
                )
            else:
                secured = self._secure(item.action_type, current, rotate)
            if secured != current:
                changes.append((StepExecution, item.pk, "input_data", secured))
        return changes

    def _collect_manifest_changes(self, rotate):
        changes = []
        for revision in WorkflowRevision.objects.select_for_update().iterator():
            payload = revision.manifest
            secured_payload = dict(payload)
            secured_steps = []
            variables = payload.get("secret_variables") or {}
            secured_variables = self._secure_variables(variables, rotate)
            changed = secured_variables != variables
            if "secret_variables" in payload:
                secured_payload["secret_variables"] = secured_variables
            for step in payload.get("steps") or []:
                secured_step = dict(step)
                config = step.get("action_config") or {}
                secured_config = self._secure(step.get("action_type") or "", config, rotate)
                secured_step["action_config"] = secured_config
                secured_steps.append(secured_step)
                changed = changed or secured_config != config
            secured_payload["steps"] = secured_steps
            if changed:
                changes.append((revision.pk, secured_payload))
        return changes

    @transaction.atomic
    def handle(self, *args, **options):
        apply_changes = bool(options["apply"])
        rotate = bool(options["rotate"])
        try:
            database_changes = self._collect_database_changes(rotate)
            manifest_changes = self._collect_manifest_changes(rotate)
        except (SecretConfigError, ImproperlyConfigured, ValueError) as exc:
            raise CommandError(str(exc)) from exc

        published_workflows = list(
            Workflow.objects.filter(execution_engine="prefect", is_draft=False, published_revision__isnull=False)
        ) if (database_changes or manifest_changes) else []
        self.stdout.write(
            f"Database rows to rewrite: {len(database_changes)}; "
            f"published snapshots to rewrite: {len(manifest_changes)}; "
            f"workflows to republish: {0 if options['skip_publish'] else len(published_workflows)}"
        )

        if not apply_changes:
            self.stdout.write(self.style.WARNING("Dry-run only; no data was changed."))
            return

        for model, pk, field, value in database_changes:
            model.objects.filter(pk=pk).update(**{field: value})
        for pk, payload in manifest_changes:
            WorkflowRevision.objects.filter(pk=pk).update(manifest=payload)

        republished = 0
        if not options["skip_publish"]:
            for workflow in published_workflows:
                workflow.refresh_from_db()
                publish_workflow(workflow, register_deployment=False)
                republished += 1

        mode = "rotated" if rotate else "encrypted"
        self.stdout.write(
            self.style.SUCCESS(
                f"Workflow secrets {mode}: {len(database_changes)} database rows, "
                f"{len(manifest_changes)} manifests; republished {republished} workflows."
            )
        )
