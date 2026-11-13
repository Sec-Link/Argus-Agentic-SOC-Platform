"""Validated, credential-free tool templates and bounded public HTTPS queries."""

import http.client
import ipaddress
import json
import math
import re
import socket
import ssl
from threading import Event, Thread
from time import monotonic
from urllib.parse import quote, urlencode, urlsplit, urlunsplit


MAX_RESPONSE_BYTES = 64 * 1024
MAX_TEMPLATE_BYTES = 16 * 1024
MAX_ARGUMENT_LENGTH = 2048
_NAME = re.compile(r"^[a-z][a-z0-9_]{0,47}$")
_PARAM_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,47}$")
_PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
_HEADER = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_BLOCKED_HEADERS = {"host", "content-length", "content-type", "connection", "transfer-encoding",
                    "accept", "accept-encoding", "cookie", "proxy-authorization", "te", "trailer", "upgrade"}
_MISSING = object()


class HttpToolError(ValueError):
    """Safe, credential-free error suitable for an agent tool result."""


def _text(value, label, limit, *, allow_blank=True):
    if not isinstance(value, str) or len(value) > limit or _CONTROL.search(value):
        raise ValueError(f"{label} is invalid or too long.")
    if not allow_blank and not value:
        raise ValueError(f"{label} is required.")
    return value


def _json_size(value, label):
    try:
        size = len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"))
    except (TypeError, ValueError, RecursionError, UnicodeError):
        raise ValueError(f"{label} must contain valid JSON values.") from None
    if size > MAX_TEMPLATE_BYTES:
        raise ValueError(f"{label} exceeds the size limit.")


def _url_parts(url):
    _text(url, "Tool URL", 2000, allow_blank=False)
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
                or parsed.password is not None or parsed.fragment or parsed.query
                or "\\" in url or "{" in parsed.netloc or "}" in parsed.netloc):
            raise ValueError
        hostname = parsed.hostname.encode("idna").decode("ascii").lower().rstrip(".")
        if not hostname or len(hostname) > 253 or "%" in hostname or any(c.isspace() for c in hostname):
            raise ValueError
        port = 443 if parsed.port is None else parsed.port
        if not 1 <= port <= 65535:
            raise ValueError
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError:
            address = None
        if address is not None and not _public_address(address):
            raise ValueError
        if hostname in {"localhost", "metadata", "metadata.google.internal", "instance-data",
                        "metadata.tencentyun.com"} or hostname.endswith((".localhost", ".local", ".internal")):
            raise ValueError
    except (ValueError, UnicodeError):
        raise ValueError("Tool URL must use a fixed public HTTPS host without credentials, query or fragment.") from None
    netloc = f"[{hostname}]" if ":" in hostname else hostname
    if port != 443:
        netloc += f":{port}"
    return parsed._replace(netloc=netloc), hostname, port


def _public_address(address):
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped or address.sixtofour or address.teredo:
            return False
    return address.is_global and not (address.is_multicast or address.is_unspecified or address.is_reserved)


def _template_parameters(value, names, *, depth=0):
    if depth > 8:
        raise ValueError("Tool templates cannot exceed eight levels of nesting.")
    if isinstance(value, str):
        _text(value, "Template value", MAX_TEMPLATE_BYTES)
        matches = set(_PLACEHOLDER.findall(value))
        if matches - names or "{" in _PLACEHOLDER.sub("", value) or "}" in _PLACEHOLDER.sub("", value):
            raise ValueError("Tool templates contain an unknown or invalid parameter placeholder.")
        return matches
    if isinstance(value, dict):
        matches = set()
        for key, item in value.items():
            _text(key, "Template key", 128, allow_blank=False)
            if "{" in key or "}" in key:
                raise ValueError("Template object keys must be fixed strings.")
            matches.update(_template_parameters(item, names, depth=depth + 1))
        return matches
    if isinstance(value, list):
        return set().union(*(_template_parameters(item, names, depth=depth + 1) for item in value))
    if value is None or isinstance(value, (bool, int)) or isinstance(value, float) and math.isfinite(value):
        return set()
    raise ValueError("Tool templates must contain JSON values.")


def validate_tool_config(config):
    """Normalize configuration without DNS, credentials, database or HTTP access."""
    if not isinstance(config, dict):
        raise ValueError("Tool configuration must be an object.")
    name = _text(config.get("name"), "Tool name", 48, allow_blank=False)
    if not _NAME.fullmatch(name):
        raise ValueError("Tool name must start with a lowercase letter and contain lowercase letters, numbers or underscores.")
    description = _text(config.get("description", ""), "Tool description", 1000)
    method = config.get("method", "GET")
    if not isinstance(method, str) or method not in {"GET", "POST"}:
        raise ValueError("Tool method must be GET or POST.")
    parsed, _, _ = _url_parts(config.get("url"))
    parameters = config.get("parameters", [])
    if not isinstance(parameters, list) or len(parameters) > 20:
        raise ValueError("Tools accept at most 20 parameters.")
    normalized, names = [], set()
    for parameter in parameters:
        if not isinstance(parameter, dict) or set(parameter) - {"name", "type", "description", "required"}:
            raise ValueError("Tool parameter definition is invalid.")
        parameter_name = parameter.get("name")
        if not isinstance(parameter_name, str) or not _PARAM_NAME.fullmatch(parameter_name) or parameter_name in names:
            raise ValueError("Parameter names must be unique ASCII identifiers of at most 48 characters.")
        parameter_type = parameter.get("type", "string")
        if not isinstance(parameter_type, str) or parameter_type not in {"string", "integer", "number", "boolean"}:
            raise ValueError("Parameter type must be string, integer, number or boolean.")
        required = parameter.get("required", True)
        if not isinstance(required, bool):
            raise ValueError("Parameter required must be a boolean.")
        names.add(parameter_name)
        normalized.append({"name": parameter_name, "type": parameter_type, "required": required,
                           "description": _text(parameter.get("description", ""), "Parameter description", 500)})
    query = config.get("query_params", {})
    if not isinstance(query, dict) or len(query) > 30 or any(isinstance(v, (dict, list)) for v in query.values()):
        raise ValueError("Query parameters must be an object with at most 30 scalar values.")
    body = config.get("body_template")
    if body is not None and (method != "POST" or not isinstance(body, dict)):
        raise ValueError("A JSON body object is supported only for POST tools.")
    _json_size({"query": query, "body": body}, "Tool templates")
    path_parameters = _template_parameters(parsed.path, names)
    if path_parameters - {p["name"] for p in normalized if p["required"]}:
        raise ValueError("Parameters used in the URL path must be required.")
    _template_parameters(query, names)
    _template_parameters(body, names)
    auth_type = config.get("auth_type", "none")
    if not isinstance(auth_type, str) or auth_type not in {"none", "bearer", "header"}:
        raise ValueError("Authentication must be none, bearer or header.")
    auth_header = _text(config.get("auth_header", ""), "Authentication header", 100)
    auth_prefix = _text(config.get("auth_prefix", ""), "Authentication prefix", 40)
    if auth_type == "header" and (not _HEADER.fullmatch(auth_header) or auth_header.lower() in _BLOCKED_HEADERS):
        raise ValueError("Authentication header is invalid or reserved.")
    timeout = config.get("timeout_seconds", 15)
    if type(timeout) is not int or not 1 <= timeout <= 30:
        raise ValueError("Tool timeout must be between 1 and 30 seconds.")
    return {"name": name, "description": description, "method": method, "url": parsed.geturl(),
            "parameters": normalized, "query_params": query, "body_template": body, "auth_type": auth_type,
            "auth_header": auth_header, "auth_prefix": auth_prefix, "timeout_seconds": timeout}


def tool_input_schema(config):
    config = validate_tool_config(config)
    properties = {}
    for parameter in config["parameters"]:
        prop = {"type": parameter["type"], "description": parameter["description"]}
        if parameter["type"] == "string":
            prop["maxLength"] = MAX_ARGUMENT_LENGTH
        properties[parameter["name"]] = prop
    return {"type": "object", "properties": properties, "additionalProperties": False,
            "required": [p["name"] for p in config["parameters"] if p["required"]]}


def _scalar_text(value):
    return json.dumps(value, allow_nan=False) if not isinstance(value, str) else value


def _render(value, arguments):
    if isinstance(value, str):
        match = _PLACEHOLDER.fullmatch(value)
        if match:
            return arguments.get(match[1], _MISSING)
        def replace(match):
            if match[1] not in arguments:
                raise ValueError("An optional parameter used inside a template string was not supplied.")
            return _scalar_text(arguments[match[1]])
        return _PLACEHOLDER.sub(replace, value)
    if isinstance(value, dict):
        rendered = {key: _render(item, arguments) for key, item in value.items()}
        return {key: item for key, item in rendered.items() if item is not _MISSING}
    if isinstance(value, list):
        rendered = [_render(item, arguments) for item in value]
        return [item for item in rendered if item is not _MISSING]
    return value


def build_tool_request(config, arguments):
    config = validate_tool_config(config)
    if not isinstance(arguments, dict):
        raise ValueError("Tool arguments must be an object.")
    definitions = {p["name"]: p for p in config["parameters"]}
    if set(arguments) - definitions.keys():
        raise ValueError("Tool arguments contain an unknown parameter.")
    for name, definition in definitions.items():
        if name not in arguments:
            if definition["required"]:
                raise ValueError("A required tool parameter was not supplied.")
            continue
        value, kind = arguments[name], definition["type"]
        valid = {"string": isinstance(value, str), "integer": type(value) is int,
                 "number": type(value) in {int, float}, "boolean": type(value) is bool}[kind]
        if not valid or type(value) is float and not math.isfinite(value):
            raise ValueError("Tool argument type does not match its definition.")
        if isinstance(value, str):
            _text(value, "Tool argument", MAX_ARGUMENT_LENGTH)
    _json_size(arguments, "Tool arguments")
    parsed, _, _ = _url_parts(config["url"])
    def path_value(match):
        value = _scalar_text(arguments[match[1]])
        if not value or value in {".", ".."} or "/" in value or "\\" in value:
            raise ValueError("URL path parameters must be nonempty single path segments.")
        return quote(value, safe="")
    path = quote(_PLACEHOLDER.sub(path_value, parsed.path), safe="/%:@!$&'()*+,;=-._~")
    url = urlunsplit((parsed.scheme, parsed.netloc, path or "/", "", ""))
    query = _render(config["query_params"], arguments)
    body = _render(config["body_template"], arguments)
    _json_size({"query": query, "body": body}, "Rendered tool request")
    return {"method": config["method"], "url": url, "query_params": query, "json_body": body}


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname, port, resolved, timeout):
        super().__init__(hostname, port, timeout=timeout, context=ssl.create_default_context())
        self._resolved = resolved

    def connect(self):
        family, socktype, protocol, _, sockaddr = self._resolved
        connection = socket.socket(family, socktype, protocol)
        self.sock = connection
        try:
            connection.settimeout(self.timeout)
            connection.connect(sockaddr)
            self.sock = self._context.wrap_socket(connection, server_hostname=self.host, do_handshake_on_connect=False)
            self.sock.do_handshake()
        except BaseException:
            connection.close()
            raise


def _resolve_public(hostname, port):
    try:
        resolved = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
        if not resolved or any(not _public_address(ipaddress.ip_address(item[4][0])) for item in resolved):
            raise ValueError
    except (OSError, ValueError):
        raise ValueError("Tool target could not be resolved to public IP addresses.") from None
    return resolved[0]


def _remove_secret(value, secret, depth=0):
    if depth > 24:
        return "[nested data omitted]"
    if isinstance(value, str):
        return value.replace(secret, "[credential omitted]") if secret else value
    if isinstance(value, dict):
        return {_remove_secret(k, secret, depth + 1): _remove_secret(v, secret, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [_remove_secret(v, secret, depth + 1) for v in value]
    return value


def execute_http_tool(config, arguments, auth_secret, cancel_event=None):
    """Execute once; the caller owns actor authorization, approval and audit."""
    try:
        config = validate_tool_config(config)
        request = build_tool_request(config, arguments)
        _text(auth_secret, "Tool authentication secret", 8192, allow_blank=config["auth_type"] == "none")
    except ValueError as exc:
        raise HttpToolError(str(exc)) from None
    return _perform_request(config, request, auth_secret, cancel_event)


def _perform_request(config, request, auth_secret, cancel_event):
    deadline = monotonic() + config["timeout_seconds"]
    def check_running():
        if cancel_event is not None and cancel_event.is_set():
            raise HttpToolError("HTTP tool execution was cancelled.")
        if monotonic() >= deadline:
            raise HttpToolError("HTTP tool execution timed out.")
    check_running()
    parsed, hostname, port = _url_parts(request["url"])
    headers = {"Accept": "application/json", "Accept-Encoding": "identity", "Host": parsed.netloc}
    if config["auth_type"] != "none":
        if config["auth_type"] == "bearer":
            headers["Authorization"] = f"Bearer {auth_secret}"
        else:
            headers[config["auth_header"]] = config["auth_prefix"] + auth_secret
    query = urlencode({key: _scalar_text(value) for key, value in request["query_params"].items() if value is not None})
    target = parsed.path + ("?" + query if query else "")
    body = None
    if request["json_body"] is not None:
        body = json.dumps(request["json_body"], ensure_ascii=False, allow_nan=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    try:
        resolved = _resolve_public(hostname, port)
    except ValueError as exc:
        raise HttpToolError(str(exc)) from None
    check_running()
    connection = _PinnedHTTPSConnection(hostname, port, resolved, max(0.01, deadline - monotonic()))
    finished, expired = Event(), Event()
    response = None
    active_socket = None
    def watch_deadline():
        while not finished.wait(min(0.1, max(0.001, deadline - monotonic()))):
            if monotonic() >= deadline or cancel_event is not None and cancel_event.is_set():
                expired.set()
                sock = active_socket or connection.sock
                if sock is not None:
                    try:
                        sock.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                return
    watcher = Thread(target=watch_deadline, name="ai-http-tool-deadline", daemon=True)
    watcher.start()
    try:
        connection.connect()
        active_socket = connection.sock
        check_running()
        connection.request(request["method"], target, body=body, headers=headers)
        response = connection.getresponse()
        check_running()
        if not 200 <= response.status < 300:
            raise HttpToolError(f"HTTP tool returned HTTP {response.status}; redirects are not followed.")
        if response.getheader("Content-Encoding", "identity").strip().lower() not in {"", "identity"}:
            raise HttpToolError("HTTP tool returned an unsupported compressed response.")
        chunks, size = [], 0
        while size <= MAX_RESPONSE_BYTES:
            check_running()
            chunk = response.read1(min(8192, MAX_RESPONSE_BYTES + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        check_running()
        if expired.is_set():
            raise HttpToolError("HTTP tool execution stopped before completion.")
        raw = b"".join(chunks)
        truncated = len(raw) > MAX_RESPONSE_BYTES
        text = raw[:MAX_RESPONSE_BYTES].decode("utf-8", errors="replace")
        if truncated and auth_secret:
            # Do not expose a credential prefix cut by the response size limit.
            for length in range(min(len(auth_secret) - 1, len(text)), 0, -1):
                if text.endswith(auth_secret[:length]):
                    text = text[:-length] + "[credential omitted]"
                    break
        text = _remove_secret(text, auth_secret)
        payload = text
        if not truncated:
            try:
                payload = json.loads(text)
            except (ValueError, RecursionError):
                pass
        return {"status_code": response.status, "body": _remove_secret(payload, auth_secret), "truncated": truncated}
    except HttpToolError:
        raise
    except (OSError, http.client.HTTPException, ValueError, UnicodeError):
        check_running()
        raise HttpToolError("HTTP tool request failed. Check the configured endpoint and credentials.") from None
    finally:
        finished.set()
        if response is not None:
            response.close()
        connection.close()
        watcher.join(timeout=0.2)
