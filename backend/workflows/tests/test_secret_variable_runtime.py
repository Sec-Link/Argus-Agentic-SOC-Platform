import base64
import json
import os
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import quote, quote_plus
from uuid import uuid4

from cryptography.fernet import Fernet
from django.test import SimpleTestCase, override_settings

from workflows.prefect.actions import ActionResult, ApiCallAction, BlockIPAction
from workflows.prefect.executor import execute_action
from workflows.prefect.flow import run_soar_workflow
from workflows.prefect.secrets import (
    RuntimeSecretError,
    decrypt_secret_variable,
    encrypt_payload,
    validate_secret_context_path,
    validate_secret_variable_references,
)
from workflows.secret_config import prepare_config_for_storage


class SecretVariableRuntimeTests(SimpleTestCase):
    def setUp(self):
        self.key = Fernet.generate_key().decode("ascii")
        self.secret = "private+/key {{literal}} 中文"
        self.encrypted = encrypt_payload({
            "version": 1, "kind": "workflow_variable", "name": "token", "value": self.secret,
        }, [self.key])
        self.enterContext(override_settings(WORKFLOW_ENCRYPTION_KEYS=[self.key]))
        self.enterContext(patch.dict(os.environ, {"WORKFLOW_ENCRYPTION_KEYS": self.key}))

    def config(self, **changes):
        return prepare_config_for_storage("block_ip", {
            "ip_address": "{{variables.ip}}", "api_url": "https://firewall.example/block",
            "api_key": "{{variables.token}}", **changes,
        }, require_sensitive=True)

    def context(self):
        return {"variables": {"ip": "192.0.2.8", "token": "must-not-shadow", "literal": "changed"},
                "_secret_variables": {"token": self.encrypted}}

    def test_secret_payload_is_bound_to_name_and_requires_correct_key_and_nonempty_value(self):
        self.assertEqual(decrypt_secret_variable("token", self.encrypted), self.secret)
        with self.assertRaises(RuntimeSecretError):
            decrypt_secret_variable("other", self.encrypted)
        with self.assertRaises(RuntimeSecretError):
            decrypt_secret_variable("token", self.encrypted, [Fernet.generate_key().decode("ascii")])
        for value in ("", None, 1, {}):
            token = encrypt_payload({"version": 1, "kind": "workflow_variable", "name": "token", "value": value}, [self.key])
            with self.assertRaises(RuntimeSecretError):
                decrypt_secret_variable("token", token)

    @patch("workflows.prefect.actions.block_ip.requests.post")
    def test_actual_action_receives_opaque_secret_and_public_variables_still_resolve(self, post):
        post.return_value = Mock(ok=True, status_code=200, text=self.secret)
        config, context = self.config(), self.context()
        original = deepcopy((config, context))
        result = execute_action("block_ip", config, context)
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer " + self.secret)
        self.assertEqual(post.call_args.kwargs["json"]["ip"], "192.0.2.8")
        self.assertEqual(result["data"]["response_body"], "[REDACTED]")
        self.assertEqual((config, context), original)

    def test_action_context_omits_encrypted_map_and_secret_names_and_redacts_errors(self):
        with patch.object(BlockIPAction, "execute", return_value=ActionResult(True)) as action:
            execute_action("block_ip", self.config(), self.context())
        self.assertNotIn("_secret_variables", action.call_args.args[1])
        self.assertNotIn("token", action.call_args.args[1]["variables"])
        with patch.object(BlockIPAction, "execute", side_effect=RuntimeError("upstream echoed " + self.secret)):
            with self.assertRaises(RuntimeError) as error:
                execute_action("block_ip", self.config(), self.context())
        self.assertNotIn(self.secret, str(error.exception))
        self.assertIsNone(error.exception.__cause__)
        self.assertIsNone(error.exception.__context__)

    def test_only_sensitive_fields_accept_secret_references_and_target_binding_is_preserved(self):
        for action_type, config in (
            ("log", {"message": "{{variables.token}}"}),
            ("log", {"message": "{{variables}}"}),
            ("block_ip", {"api_key": "{{variables.token.nested}}"}),
            ("block_ip", {"reason": {"{{variables.token}}": "hidden in a key"}}),
            ("api_call", {"headers": [{"key": "X-Token", "value": "{{variables.token}}", "sensitive": False}]}),
        ):
            with self.subTest(config=config), self.assertRaises(RuntimeSecretError):
                validate_secret_variable_references(action_type, config, ["token"])
        for field in ("variables.token", "context.variables.token", "workflow.variables.token", "variables"):
            with self.assertRaises(RuntimeSecretError):
                validate_secret_context_path(field, ["token"])
        with patch.object(BlockIPAction, "execute") as action:
            changed_target = self.config()
            changed_target["api_url"] = "https://other.example/block"
            with self.assertRaises(RuntimeSecretError):
                execute_action("block_ip", changed_target, self.context())
            action.assert_not_called()
        with self.assertRaisesRegex(RuntimeSecretError, "require fixed action target"):
            execute_action("block_ip", self.config(api_url="{{variables.target}}"), self.context())
        with self.assertRaisesRegex(RuntimeSecretError, "require fixed action target"):
            validate_secret_variable_references("api_call", {
                "url": "https://api.example/{{variables.path}}",
                "headers": [{"key": "X-Token", "value": "{{variables.token}}", "sensitive": True}],
            }, ["token"])

    @patch("workflows.prefect.actions.api_call.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 443))])
    @patch("workflows.prefect.actions.api_call.requests.request")
    def test_api_auth_headers_query_and_encoded_response_echoes_are_redacted(self, request, _dns):
        config = prepare_config_for_storage("api_call", {
            "url": "https://api.example/check", "auth_type": "basic", "auth_username": "user",
            "auth_secret": "{{variables.token}}",
            "headers": [{"key": "X-Token", "value": "Bearer {{variables.token}}", "sensitive": True}],
            "query_params": [{"key": "token", "value": "{{variables.token}}", "sensitive": True}],
        }, require_sensitive=True)
        encoded = [quote(self.secret, safe=""), quote_plus(self.secret), base64.b64encode(self.secret.encode()).decode(),
                   base64.b64encode(("user:" + self.secret).encode()).decode()]
        body = json.dumps({self.secret: "echo " + self.secret, "encoded": encoded}).encode()
        request.return_value = Mock(status_code=200, content=body, encoding="utf-8")
        context = self.context()
        context["_runtime_policy"] = {"workflow_http_allowlist": ["api.example"]}
        result = execute_action("api_call", config, context)
        self.assertEqual(request.call_args.kwargs["auth"], ("user", self.secret))
        self.assertEqual(request.call_args.kwargs["headers"]["X-Token"], "Bearer " + self.secret)
        self.assertEqual(request.call_args.kwargs["params"]["token"], self.secret)
        for secret in [self.secret, *encoded]:
            self.assertNotIn(secret, str(result))
        self.assertIn("[REDACTED]", result["data"]["response_json"])

    def test_flow_task_parameters_events_and_results_never_contain_plaintext(self):
        workflow_id, step_id = str(uuid4()), str(uuid4())
        definition = {"id": workflow_id, "name": "Secret workflow", "variables": {"ip": "192.0.2.8"},
                      "secret_variables": {"token": self.encrypted}, "steps": [{
                          "id": step_id, "order": 0, "name": "Block", "node_type": "action",
                          "action_type": "block_ip", "action_config": self.config(), "on_failure": "stop",
                      }]}
        run = {"schema_version": 1, "workflow": {"id": workflow_id, "version": 1, "definition": definition},
               "trigger": {"source": "manual", "data": {}}}
        original = deepcopy(run)
        task_inputs = []

        def task(action_type, config, context):
            task_inputs.append(deepcopy((config, context)))
            return execute_action(action_type, config, context)

        with (
            patch("workflows.prefect.flow.flow_run", SimpleNamespace(id=uuid4())),
            patch("workflows.prefect.flow.get_run_logger", return_value=Mock()),
            patch("workflows.prefect.flow.emit_event") as emit,
            patch("workflows.prefect.flow.execute_action_task", SimpleNamespace(with_options=lambda **kwargs: task)),
            patch.object(BlockIPAction, "execute", return_value=ActionResult(True, {"echo": self.secret}, logs=self.secret)),
        ):
            result = run_soar_workflow.fn(run)
            self.assertEqual(run, original)
            self.assertNotIn(self.secret, str((run, task_inputs, emit.call_args_list, result)))
            for event in emit.call_args_list:
                self.assertNotIn("_secret_variables", event.kwargs["payload"]["context"])
            definition["steps"][0].update(node_type="condition", condition={"field": "context.variables.token", "operator": "is_not_empty"})
            with self.assertRaisesRegex(RuntimeError, "only be used in sensitive action fields"):
                run_soar_workflow.fn(run)
