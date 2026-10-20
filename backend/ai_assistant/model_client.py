"""LangChain model access; business code keeps plain text and JSON results."""

import json
import os
import re
import socket
import ssl
from contextlib import contextmanager
from urllib.parse import urlsplit

from django.conf import settings
from langchain_core.messages import AIMessage
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from openai import APIConnectionError, APIStatusError, APITimeoutError, DefaultHttpxClient, OpenAIError

from .model_validation import extract_model_validation


_MINIMAX_HOSTS = {"api.minimax.io", "api.minimaxi.com", "api.minimax.cn"}
_VALUE_SHAPE = r"(?:absent|null|boolean|number|other|(?:string|array|object):[0-9]{1,7})"
_MESSAGE_SHAPE = (
    rf"[0-9]{{1,7}}:(?:system|developer|user|assistant|tool|function|other)"
    rf"/content={_VALUE_SHAPE}/reasoning={_VALUE_SHAPE}/calls=(?:[0-9]{{1,7}}|other)"
)
_REQUEST_SUMMARY = re.compile(
    r"Request structure: adapter=(?:minimax|openai); tool_choice=(?:auto|none|required|named|other|absent); "
    r"messages=[0-9]{1,7}; calls=[0-9]{1,7}; results=[0-9]{1,7}; "
    r"ids_unique=(?:true|false); results_match=(?:true|false); tail="
    rf"(?:{_MESSAGE_SHAPE}(?:,{_MESSAGE_SHAPE}){{0,5}})?\."
)


def model_request_summary_text(value):
    """Revalidate fixed diagnostic metadata before it reaches a log or response."""
    if not isinstance(value, str) or len(value) > 1500:
        return ""
    if value == "Request structure: unavailable." or _REQUEST_SUMMARY.fullmatch(value):
        return value
    return ""


def safe_model_request_summary(content, *, url=""):
    """Describe only JSON types, counts and ID relationships, never request values."""
    if not isinstance(content, bytes) or len(content) > 2 * 1024 * 1024:
        return "Request structure: unavailable."
    try:
        payload = json.loads(content)
        parsed_url = urlsplit(url)
    except (TypeError, ValueError, UnicodeError, RecursionError):
        return "Request structure: unavailable."
    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list):
        return ""
    messages = payload["messages"]
    choice = payload.get("tool_choice")
    if isinstance(choice, str) and choice in {"auto", "none", "required"}:
        choice_type = choice
    elif isinstance(choice, dict) and choice.get("type") == "function":
        choice_type = "named"
    else:
        choice_type = "other" if "tool_choice" in payload else "absent"
    adapter = "minimax" if parsed_url.hostname in _MINIMAX_HOSTS and parsed_url.path.endswith("/chat/completions") else "openai"

    def shape(message, field):
        if field not in message:
            return "absent"
        value = message[field]
        if value is None:
            return "null"
        if isinstance(value, bool):
            return "boolean"
        if isinstance(value, (int, float)):
            return "number"
        for kind, label in ((str, "string"), (list, "array"), (dict, "object")):
            if isinstance(value, kind):
                return f"{label}:{len(value)}"
        return "other"

    call_ids, result_ids, tail = [], [], []
    ids_valid = True
    for index, message in enumerate(messages):
        message = message if isinstance(message, dict) else {}
        role = message.get("role")
        if not isinstance(role, str) or role not in {"system", "developer", "user", "assistant", "tool", "function"}:
            role = "other"
        calls = message.get("tool_calls", [])
        if role == "assistant":
            if not isinstance(calls, list):
                ids_valid = False
            else:
                for call in calls:
                    call_id = call.get("id") if isinstance(call, dict) else None
                    ids_valid = ids_valid and isinstance(call_id, str) and bool(call_id)
                    call_ids.append(call_id)
        if role == "tool":
            result_id = message.get("tool_call_id")
            ids_valid = ids_valid and isinstance(result_id, str) and bool(result_id)
            result_ids.append(result_id)
        if index >= len(messages) - 6:
            count = len(calls) if isinstance(calls, list) else "other"
            tail.append(f"{index}:{role}/content={shape(message, 'content')}/reasoning={shape(message, 'reasoning_content')}/calls={count}")
    unique = ids_valid and len(set(call_ids)) == len(call_ids)
    matched = unique and sorted(call_ids) == sorted(result_ids)
    return model_request_summary_text(
        f"Request structure: adapter={adapter}; tool_choice={choice_type}; messages={len(messages)}; "
        f"calls={len(call_ids)}; results={len(result_ids)}; ids_unique={str(unique).lower()}; "
        f"results_match={str(matched).lower()}; tail={','.join(tail)}."
    )


class ModelCallError(RuntimeError):
    def __init__(self, message, *, code="model_error", status_code=None, validation=None, request_summary=""):
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.validation = validation or []
        self.request_summary = model_request_summary_text(request_summary)


class _MiniMaxChatOpenAI(ChatOpenAI):
    """Keep MiniMax's required reasoning replay in private model history."""

    def _convert_chunk_to_generation_chunk(self, chunk, default_chunk_class, base_generation_info):
        generation = super()._convert_chunk_to_generation_chunk(
            chunk, default_chunk_class, base_generation_info,
        )
        choices = chunk.get("choices") or chunk.get("chunk", {}).get("choices") or []
        delta = (choices[0].get("delta") or {}) if choices else {}
        reasoning = delta.get("reasoning_content")
        if generation is not None and isinstance(generation.message, AIMessage) and isinstance(reasoning, str):
            # LangChain concatenates string metadata when assembling streamed chunks.
            generation.message.additional_kwargs["reasoning_content"] = reasoning
        return generation

    def _get_request_payload(self, input_, *, stop=None, **kwargs):
        messages = self._convert_input(input_).to_messages()
        payload = super()._get_request_payload(messages, stop=stop, **kwargs)
        for message, serialized in zip(messages, payload.get("messages", [])):
            if isinstance(message, AIMessage):
                # MiniMax's content schema excludes the null used by OpenAI for tool-only turns.
                if serialized.get("tool_calls") and serialized.get("content") is None:
                    serialized["content"] = ""
                reasoning = message.additional_kwargs.get("reasoning_content")
                if isinstance(reasoning, str):
                    serialized["reasoning_content"] = reasoning
        return payload


def _http_error_code(status_code, *, body=None, url=""):
    if status_code in (401, 403):
        return "model_auth_error"
    if status_code == 429:
        return "model_rate_limited"
    if status_code == 404:
        return "model_not_found"
    if status_code in (400, 422):
        # Match only the confirmed provider signature; never expose error prose.
        if urlsplit(url).hostname in _MINIMAX_HOSTS and isinstance(body, dict):
            error = body.get("error", body)
            if (
                isinstance(error, dict)
                and error.get("type") == "unprocessable_entity_error"
                and error.get("message") == "input new_sensitive (1026)"
            ):
                return "model_content_rejected"
        return "model_bad_request"
    if 500 <= status_code <= 599:
        return "model_upstream_error"
    return "model_http_error"


def _connection_error_code(exc):
    # Only typed causes identify DNS/TLS failures; provider text is untrusted.
    seen = set()
    for _ in range(12):
        if exc is None or id(exc) in seen:
            break
        seen.add(id(exc))
        if isinstance(exc, socket.gaierror):
            return "model_dns_error"
        if isinstance(exc, ssl.SSLError):
            return "model_tls_error"
        exc = exc.__cause__ or exc.__context__
    return "model_connection_error"


class _ModelHTTPClient(DefaultHttpxClient):
    """Accept gateways returning JSON to a streaming request, without a retry."""

    def send(self, request, **kwargs):
        response = super().send(request, **kwargs)
        if (
            response.is_error
            or "text/event-stream" in response.headers.get("content-type", "")
            or not request.url.path.endswith(("/chat/completions", "/responses"))
            or not json.loads(request.content).get("stream")
        ):
            return response
        # Only normalize a complete JSON response; SSE decoding stays in the SDK.
        try:
            response.read()
            payload = response.json()
        finally:
            response.close()
        if not isinstance(payload, dict) or payload.get("error"):
            raise ModelCallError("Invalid model API response", code="model_response_invalid")
        events = []
        if request.url.path.endswith("/chat/completions"):
            for index, choice in enumerate(payload.get("choices") or []):
                delta = dict(choice.get("message") or {})
                if delta.get("tool_calls"):
                    delta["tool_calls"] = [{**call, "index": i} for i, call in enumerate(delta["tool_calls"])]
                events.append({
                    "id": payload.get("id", ""), "model": payload.get("model", ""),
                    "choices": [{"index": index, "delta": delta, "finish_reason": choice.get("finish_reason")}],
                })
        else:
            text = payload.get("output_text")
            if not isinstance(text, str):
                text = "".join(
                    str(content.get("text") or content.get("content") or "")
                    for item in payload.get("output") or []
                    for content in item.get("content") or []
                    if content.get("type") in ("text", "output_text")
                )
            events.append({
                "type": "response.output_text.delta", "output_index": 0,
                "content_index": 0, "item_id": payload.get("id", ""), "delta": text,
            })
        body = "".join(f"data: {json.dumps(event, ensure_ascii=False)}\n\n" for event in events) + "data: [DONE]\n\n"
        headers = {key: value for key, value in response.headers.items()
                   if key.lower() not in {"content-type", "content-length", "content-encoding", "transfer-encoding"}}
        headers["content-type"] = "text/event-stream"
        return type(response)(response.status_code, headers=headers, content=body.encode("utf-8"), request=request)


def normalize_base_url(raw: str) -> str:
    base = (raw or "").strip().rstrip("/")
    if "/v1" not in base and base.endswith("/openai"):
        return f"{base}/v1"
    return base


def chat_config(overrides=None, *, use_responses_api=False):
    overrides = overrides or {}

    def setting(name, default):
        # Ticket analysis historically falls back to environment variables;
        # chat uses Django settings (or request overrides) only.
        fallback = os.getenv(name, default) if use_responses_api else default
        return getattr(settings, name, fallback)

    timeout = overrides.get("timeout_seconds")
    if timeout in (None, ""):
        timeout = setting("OPENAI_TIMEOUT_SECONDS", 45)
    try:
        timeout = int(timeout or 45)
    except (TypeError, ValueError):
        timeout = 45
    return {
        "api_key": overrides.get("api_key") or setting("OPENAI_API_KEY", ""),
        "base_url": normalize_base_url(overrides.get("base_url") or setting("OPENAI_BASE_URL", "https://api.openai.com/v1")),
        "model": overrides.get("model") or setting("OPENAI_MODEL", "gpt-5.1-codex"),
        "timeout": timeout,
    }


@contextmanager
def _model_http_client():
    # Preserve Requests' explicit CA bundle override for existing deployments.
    ca_bundle = os.getenv("REQUESTS_CA_BUNDLE") or os.getenv("CURL_CA_BUNDLE")
    options = {}
    if ca_bundle:
        try:
            options["verify"] = ssl.create_default_context(
                capath=ca_bundle if os.path.isdir(ca_bundle) else None,
                cafile=None if os.path.isdir(ca_bundle) else ca_bundle,
            )
        except OSError as exc:
            raise ModelCallError("Invalid model CA bundle configuration", code="model_ca_invalid") from exc
    try:
        with _ModelHTTPClient(**options) as client:
            yield client
    except APITimeoutError as exc:
        raise ModelCallError("Model request timed out", code="model_timeout") from exc
    except APIStatusError as exc:
        validation, request_summary = [], ""
        if exc.status_code in (400, 422):
            validation = extract_model_validation(exc.body)
            # The SDK may unwrap `error` and discard structured validation alongside it.
            if not validation and len(exc.response.content) <= 16 * 1024:
                try:
                    validation = extract_model_validation(exc.response.json())
                except (ValueError, UnicodeError, RecursionError):
                    pass
            request_summary = safe_model_request_summary(exc.request.content, url=str(exc.request.url))
        raise ModelCallError(
            f"Model API error: {exc.status_code}",
            code=_http_error_code(exc.status_code, body=exc.body, url=str(exc.request.url)),
            status_code=exc.status_code,
            validation=validation, request_summary=request_summary,
        ) from exc
    except APIConnectionError as exc:
        raise ModelCallError("Model connection failed", code=_connection_error_code(exc)) from exc
    except OpenAIError as exc:
        raise ModelCallError("Invalid model API response", code="model_response_invalid") from exc
    except ValueError as exc:
        # The integration raises ValueError for empty streams and HTTP 200
        # Responses error events, rather than an SDK HTTP exception.
        raise ModelCallError("Invalid model request or response", code="model_response_invalid") from exc


@contextmanager
def open_chat_model(overrides=None, *, use_responses_api=False):
    config = chat_config(overrides, use_responses_api=use_responses_api)
    if not config["api_key"]:
        raise ModelCallError("OPENAI_API_KEY is not configured", code="model_key_missing")
    with _model_http_client() as client:
        model_class = ChatOpenAI
        if not use_responses_api and urlsplit(config["base_url"]).hostname in _MINIMAX_HOSTS:
            model_class = _MiniMaxChatOpenAI
        yield model_class(
            **config,
            use_responses_api=use_responses_api,
            max_retries=0,
            streaming=True,
            stream_usage=False,
            max_tokens=1200 if use_responses_api else None,
            temperature=0.2,
            # Keep the existing wire parameter even for gateway model aliases
            # for which the integration otherwise strips temperature by name.
            extra_body={"temperature": 0.2},
            http_client=client,
        )


def message_text(message: AIMessage) -> str:
    return str(message.text)


def chat_response(message: AIMessage) -> dict:
    """Keep the plain choices/message shape consumed by chat and Skills."""
    result = {"role": "assistant", "content": message_text(message)}
    tool_calls = message.additional_kwargs.get("tool_calls")
    if not tool_calls and message.tool_calls:
        tool_calls = [
            {
                "id": call["id"], "type": "function",
                "function": {"name": call["name"], "arguments": json.dumps(call["args"], ensure_ascii=False)},
            }
            for call in message.tool_calls
        ]
    if tool_calls:
        result["tool_calls"] = tool_calls
    return {"choices": [{"message": result, "finish_reason": message.response_metadata.get("finish_reason")}]}


def call_responses(prompt: str, overrides=None) -> dict:
    with open_chat_model(overrides, use_responses_api=True) as model:
        message = model.invoke([{"role": "user", "content": prompt}])
    return {"output_text": message_text(message)}


def embed_text(text: str, config: dict) -> list[float]:
    if not config["api_key"]:
        raise ModelCallError("Embedding API key is not configured", code="model_key_missing")
    with _model_http_client() as client:
        model = OpenAIEmbeddings(
            **config,
            max_retries=0,
            check_embedding_ctx_length=False,
            model_kwargs={"encoding_format": "float"},
            http_client=client,
        )
        try:
            return [float(value) for value in model.embed_query(text)]
        except (IndexError, KeyError, TypeError, ValueError) as exc:
            raise ModelCallError("Invalid embedding response", code="model_response_invalid") from exc
