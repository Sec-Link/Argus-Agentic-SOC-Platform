from __future__ import annotations

import json
from typing import Any, Dict
from urllib.parse import urlsplit

import requests

from .base import ActionResult, BaseAction


MAX_RESPONSE_BYTES = 16 * 1024
PROVIDERS = {"slack", "feishu", "wecom"}


class SendNotificationAction(BaseAction):
    name = "Send Notification"
    description = "Send a workflow notification to Slack, Feishu, or Wecom using an incoming webhook"
    category = "notification"
    config_schema = {
        "type": "object",
        "properties": {
            "provider": {
                "type": "string",
                "enum": ["slack", "feishu", "wecom"],
                "x-enum-labels": {
                    "slack": "Slack",
                    "feishu": "Feishu",
                    "wecom": "Wecom",
                },
                "default": "feishu",
                "description": "Notification provider",
            },
            "webhook_url": {
                "type": "string",
                "description": "Incoming bot webhook URL for the selected provider",
                "writeOnly": True,
                "x-sensitive": True,
                "x-secret-bindings": ["provider"],
            },
            "title": {
                "type": "string",
                "description": "Notification title. Supports {{variable.path}} placeholders.",
            },
            "message": {
                "type": "string",
                "description": "Notification message. Supports {{variable.path}} placeholders.",
            },
            "format": {
                "type": "string",
                "enum": ["text", "markdown"],
                "x-enum-labels": {
                    "text": "Text",
                    "markdown": "Markdown",
                },
                "default": "markdown",
                "description": "Message format",
            },
            "mention_all": {
                "type": "boolean",
                "default": False,
                "description": "Mention everyone when supported by the provider",
            },
            "include_context_payload": {
                "type": "boolean",
                "default": False,
                "description": "Append selected workflow context data to the message",
            },
            "context_source": {
                "type": "string",
                "enum": ["previous_step", "trigger_data", "variables"],
                "x-enum-labels": {
                    "previous_step": "Previous Step Output",
                    "trigger_data": "Trigger Data",
                    "variables": "Workflow Variables",
                },
                "default": "previous_step",
                "description": "Workflow context data appended when include_context_payload is enabled",
            },
            "timeout": {
                "type": "integer",
                "minimum": 1,
                "maximum": 60,
                "default": 15,
            },
        },
        "required": ["provider", "webhook_url", "message"],
    }

    @staticmethod
    def _bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    @staticmethod
    def _provider(value: Any) -> str:
        provider = str(value or "feishu").strip().lower()
        aliases = {
            "wechat_work": "wecom",
            "wechat": "wecom",
            "enterprise_wechat": "wecom",
            "lark": "feishu",
        }
        return aliases.get(provider, provider)

    @staticmethod
    def _compose(title: str, message: str) -> str:
        title = title.strip()
        message = message.strip()
        if title and message:
            return f"{title}\n{message}"
        return title or message

    @staticmethod
    def _validated_webhook_url(raw_url: str) -> str:
        parsed = urlsplit(raw_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or not parsed.hostname:
            raise ValueError("Webhook URL must be an absolute HTTP or HTTPS URL.")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("Webhook URL cannot contain embedded credentials.")
        if parsed.fragment:
            raise ValueError("Webhook URL cannot contain a URL fragment.")
        return raw_url

    @staticmethod
    def _truncate_response(response: requests.Response) -> str:
        raw = response.content or b""
        try:
            return raw[:MAX_RESPONSE_BYTES].decode(response.encoding or "utf-8", errors="replace")
        except LookupError:
            return raw[:MAX_RESPONSE_BYTES].decode("utf-8", errors="replace")

    def _context_payload(self, context: Dict[str, Any], source: str) -> Any:
        if source == "trigger_data":
            return context.get("trigger_data") or {}
        if source == "variables":
            return context.get("variables") or {}
        previous = context.get("previous_step") or {}
        return previous.get("output") or {}

    def _format_context_payload(self, payload: Any, fmt: str) -> str:
        if payload in (None, "", {}, []):
            return ""
        if isinstance(payload, dict):
            compact = {
                key: value
                for key, value in payload.items()
                if key not in {"raw_response", "response_body", "response_json"}
            }
            payload = compact or payload
        rendered = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
        if fmt == "markdown":
            return f"\n\nContext Payload:\n```json\n{rendered}\n```"
        return f"\n\nContext Payload:\n{rendered}"

    def _message(self, config: Dict[str, Any], context: Dict[str, Any], fmt: str) -> tuple[str, str]:
        title = str(self.resolve_variables(config.get("title", ""), context) or "")
        message = str(self.resolve_variables(config.get("message", ""), context) or "")
        content = self._compose(title, message)
        if self._bool(config.get("include_context_payload")):
            source = str(config.get("context_source") or "previous_step")
            content += self._format_context_payload(self._context_payload(context, source), fmt)
        return title, content

    def _slack_payload(self, title: str, content: str, fmt: str, mention_all: bool) -> Dict[str, Any]:
        prefix = "<!channel>\n" if mention_all else ""
        if fmt == "markdown" and title.strip():
            body = content
            if body.startswith(title.strip()):
                body = body[len(title.strip()):].lstrip("\n")
            text = f"{prefix}*{title.strip()}*"
            if body:
                text += f"\n{body}"
        else:
            text = prefix + content
        return {"text": text, "mrkdwn": fmt == "markdown"}

    def _feishu_payload(self, title: str, content: str, fmt: str, mention_all: bool) -> Dict[str, Any]:
        mention = '<at user_id="all">All</at>\n' if mention_all else ""
        if fmt == "markdown":
            return {
                "msg_type": "interactive",
                "card": {
                    "config": {"wide_screen_mode": True},
                    "header": {
                        "template": "blue",
                        "title": {
                            "tag": "plain_text",
                            "content": title.strip() or "Workflow Notification",
                        },
                    },
                    "elements": [
                        {
                            "tag": "div",
                            "text": {"tag": "lark_md", "content": mention + content},
                        }
                    ],
                },
            }
        return {"msg_type": "text", "content": {"text": mention + content}}

    def _wecom_payload(self, content: str, fmt: str, mention_all: bool) -> Dict[str, Any]:
        if fmt == "markdown":
            mention = "<@all>\n" if mention_all else ""
            return {"msgtype": "markdown", "markdown": {"content": mention + content}}
        payload: Dict[str, Any] = {"msgtype": "text", "text": {"content": content}}
        if mention_all:
            payload["text"]["mentioned_list"] = ["@all"]
        return payload

    def _payload(self, provider: str, title: str, content: str, fmt: str, mention_all: bool) -> Dict[str, Any]:
        if provider == "slack":
            return self._slack_payload(title, content, fmt, mention_all)
        if provider == "feishu":
            return self._feishu_payload(title, content, fmt, mention_all)
        return self._wecom_payload(content, fmt, mention_all)

    def _provider_error(self, provider: str, response: requests.Response) -> str:
        if not response.content:
            return ""
        try:
            payload = response.json()
        except ValueError:
            return ""
        if not isinstance(payload, dict):
            return ""
        if provider == "feishu" and int(payload.get("code", 0) or 0) != 0:
            return str(payload.get("msg") or payload.get("message") or "Feishu webhook returned an error.")
        if provider == "wecom" and int(payload.get("errcode", 0) or 0) != 0:
            return str(payload.get("errmsg") or payload.get("message") or "Wecom webhook returned an error.")
        return ""

    def execute(self, config: Dict[str, Any], context: Dict[str, Any]) -> ActionResult:
        provider = self._provider(config.get("provider"))
        if provider not in PROVIDERS:
            return ActionResult(False, error=f"Unsupported notification provider: {provider}", logs="Notification validation failed.")
        fmt = str(config.get("format") or "markdown").strip().lower()
        if fmt not in {"text", "markdown"}:
            fmt = "markdown"
        try:
            timeout = int(config.get("timeout") or 15)
            if not 1 <= timeout <= 60:
                raise ValueError("Notification timeout must be between 1 and 60 seconds.")
            webhook_url = self._validated_webhook_url(str(config.get("webhook_url") or "").strip())
            title, content = self._message(config, context, fmt)
            if not content.strip():
                raise ValueError("Notification message is empty after variable resolution.")
            payload = self._payload(provider, title, content, fmt, self._bool(config.get("mention_all")))
            response = requests.post(
                webhook_url,
                headers={"Content-Type": "application/json"},
                json=payload,
                timeout=timeout,
                allow_redirects=False,
            )
            provider_error = self._provider_error(provider, response)
            success = response.ok and not provider_error
            return ActionResult(
                success,
                {
                    "provider": provider,
                    "status_code": response.status_code,
                    "response_body": self._truncate_response(response),
                    "format": fmt,
                },
                provider_error or ("" if response.ok else f"Notification webhook returned HTTP {response.status_code}."),
                f"Notification request to {provider} returned HTTP {response.status_code}.",
            )
        except requests.RequestException as exc:
            return ActionResult(False, error=f"Notification request failed ({type(exc).__name__}).", logs=f"Notification to {provider} failed.")
        except (TypeError, ValueError) as exc:
            return ActionResult(False, error=str(exc), logs="Notification validation failed.")
