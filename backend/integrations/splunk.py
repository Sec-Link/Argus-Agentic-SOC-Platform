"""Read-only Splunk management API access for alert ingestion."""

import json
import re
import time

import requests

from .http_client import ConnectorHttpError, connector_request


class SplunkError(ValueError):
    pass


def request_options(config):
    headers = {'Accept': 'application/json'}
    auth = None
    if config['auth_type'] == 'token':
        headers['Authorization'] = f"Splunk {config['token']}"
    else:
        auth = requests.auth.HTTPBasicAuth(config['username'], config['password'])
    return {'auth': auth, 'headers': headers, 'verify': config['verify_certs'], 'timeout': (5, 20)}


def read_results(config, path, *, data=None, limit=1000):
    """Bound streamed JSON results before parsing or retaining upstream data."""
    started = time.monotonic()
    try:
        with connector_request(
            'POST' if data is not None else 'GET', config['host'] + path,
            data=data, stream=True, **request_options(config),
        ) as response:
            if not 200 <= response.status_code < 300:
                raise SplunkError(f'Splunk returned HTTP {response.status_code}.')
            buffer = b''
            total = 0
            results = []
            for chunk in response.iter_content(chunk_size=65536):
                total += len(chunk)
                if total > 8 * 1024 * 1024 or time.monotonic() - started > 25:
                    raise SplunkError('Splunk response exceeded the size or time limit.')
                buffer += chunk
                if data is None:
                    if len(buffer) > 1024 * 1024:
                        raise SplunkError('Splunk returned an oversized result.')
                    continue
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    if len(line) > 1024 * 1024:
                        raise SplunkError('Splunk returned an oversized result.')
                    if line.strip():
                        results.append(json.loads(line))
                    if len(results) > limit:
                        raise SplunkError('Splunk returned too many result records.')
                if len(buffer) > 1024 * 1024:
                    raise SplunkError('Splunk returned an oversized result.')
            if buffer.strip():
                results.append(json.loads(buffer))
            if len(results) > limit:
                raise SplunkError('Splunk returned too many result records.')
            return results
    except ConnectorHttpError as exc:
        raise SplunkError(str(exc)) from exc
    except requests.exceptions.SSLError as exc:
        raise SplunkError('TLS certificate verification failed. Configure a trusted certificate or review Verify TLS certificate.') from exc
    except requests.Timeout as exc:
        raise SplunkError('Splunk request timed out.') from exc
    except (requests.RequestException, OSError) as exc:
        raise SplunkError('Could not connect to Splunk.') from exc
    except (ValueError, UnicodeError) as exc:
        if isinstance(exc, SplunkError):
            raise
        raise SplunkError('Splunk returned an invalid JSON response.') from exc


def test_connection(config):
    records = read_results(config, '/services/server/info?output_mode=json', limit=1)
    try:
        content = records[0]['entry'][0]['content']
        if not isinstance(content, dict):
            raise ValueError
    except (IndexError, KeyError, TypeError, ValueError) as exc:
        raise SplunkError('Splunk returned an unexpected server-info response.') from exc
    info = {}
    for key in ('version', 'build'):
        value = content.get(key)
        if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', value):
            info[key] = value
    if content.get('product_type') in {'enterprise', 'cloud', 'hunk'}:
        info['product_type'] = content['product_type']
    return {'ok': True, 'status': 200, 'server_info': info}


def fetch_events(config, size):
    # Only literal index names are accepted; no caller-controlled SPL commands.
    index = config['index']
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', index):
        raise SplunkError('Invalid Splunk index.')
    records = read_results(config, '/services/search/v2/jobs/export', data={
        'search': f'search index="{index}" | head {size}',
        'earliest_time': f"-{config['lookback_hours']}h",
        'latest_time': 'now', 'output_mode': 'json', 'preview': 'false',
    }, limit=size + 100)
    events = []
    for record in records:
        if not isinstance(record, dict):
            raise SplunkError('Splunk returned an unexpected search result.')
        messages = record.get('messages') or []
        if any(isinstance(item, dict) and item.get('type') in {'ERROR', 'FATAL'} for item in messages):
            raise SplunkError('Splunk search failed. Check index access and search permissions.')
        if record.get('preview') in (True, 'true', '1', 1):
            continue
        if isinstance(record.get('result'), dict):
            events.append(record['result'])
        elif 'result' in record:
            raise SplunkError('Splunk returned an unexpected search result.')
    return events[:size]
