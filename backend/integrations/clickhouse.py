"""Bounded, parameterized, read-only ClickHouse HTTP queries."""

import json
import re
import time

import requests

from .http_client import ConnectorHttpError, connector_request


class ClickHouseError(ValueError):
    pass


class ClickHouseFetchInProgress(ClickHouseError):
    pass


def _response_error(response):
    value = response.headers.get('X-ClickHouse-Exception-Code', '')
    if value and (not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,5}', value)):
        return 'ClickHouse returned an invalid exception header.'
    code = int(value) if value else 0
    if response.status_code == 200 and code == 0:
        return None
    reasons = {
        60: ('UNKNOWN_TABLE', 'The configured alert table was not found. Check the database and table names.'),
        81: ('UNKNOWN_DATABASE', 'The configured database was not found. Check the database name.'),
        16: ('NO_SUCH_COLUMN_IN_TABLE', 'A mapped column was not found. Check the alert field mapping.'),
        47: ('UNKNOWN_IDENTIFIER', 'A query identifier could not be resolved. Check the alert field mapping.'),
    }
    name, hint = reasons.get(code, ('', 'Check credentials, table access and mappings.'))
    if response.status_code == 404 and not code:
        hint = ('Verify the ClickHouse HTTP API origin and reverse-proxy routing, not the ClickStack UI URL. '
                'A configured database or table may also be missing; no ClickHouse exception code was provided.')
    detail = f', exception {code}' + (f' ({name})' if name else '') if code else ''
    return f'ClickHouse returned HTTP {response.status_code}{detail}. {hint}'


def _query(config, query, parameters, limit):
    started = time.monotonic()
    params = {'database': config['database'], 'readonly': '1', 'wait_end_of_query': '1',
              'max_execution_time': '20', 'max_result_rows': str(limit),
              'max_result_bytes': str(8 * 1024 * 1024), 'result_overflow_mode': 'throw',
              'timeout_overflow_mode': 'throw', 'max_memory_usage': str(256 * 1024 * 1024),
              **{f'param_{key}': value for key, value in parameters.items()}}
    try:
        with connector_request('POST', config['host'] + '/', params=params, data=query.encode('utf-8'),
                headers={'Content-Type': 'text/plain; charset=utf-8', 'Accept': 'application/x-ndjson'},
                auth=requests.auth.HTTPBasicAuth(config['username'], config['password']),
                verify=config['verify_certs'], timeout=(5, 25), stream=True) as response:
            error = _response_error(response)
            if error:
                raise ClickHouseError(error)
            buffer = b''
            rows = []
            total = 0

            def parse(line):
                if not line.strip():
                    return
                if len(line) > 1024 * 1024:
                    raise ClickHouseError('ClickHouse returned an oversized row.')
                row = json.loads(line)
                if not isinstance(row, dict):
                    raise ClickHouseError('ClickHouse returned an invalid row.')
                rows.append(row)
                if len(rows) > limit:
                    raise ClickHouseError('ClickHouse exceeded the row limit.')

            for chunk in response.iter_content(chunk_size=65536):
                total += len(chunk)
                if total > 8 * 1024 * 1024 or time.monotonic() - started > 30:
                    raise ClickHouseError('ClickHouse exceeded the response size or time limit.')
                buffer += chunk
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    parse(line)
                if len(buffer) > 1024 * 1024:
                    raise ClickHouseError('ClickHouse returned an oversized row.')
            parse(buffer)
            return rows
    except ConnectorHttpError as exc:
        raise ClickHouseError(str(exc)) from None
    except requests.exceptions.SSLError:
        raise ClickHouseError('ClickHouse TLS certificate verification failed.') from None
    except requests.Timeout:
        raise ClickHouseError('ClickHouse request timed out.') from None
    except (requests.RequestException, OSError):
        raise ClickHouseError('Could not connect to ClickHouse.') from None
    except (ValueError, UnicodeError) as exc:
        if isinstance(exc, ClickHouseError):
            raise
        raise ClickHouseError('ClickHouse returned an invalid or incomplete JSON response.') from None


def _selection(config):
    fields = config['field_mapping']
    columns = []
    for field in fields:
        expression = 'src.{field_' + field + ':Identifier}'
        if field == 'timestamp':
            expression = f'toUnixTimestamp64Milli(toDateTime64({expression}, 3))'
        columns.append(f'{expression} AS `{field}`')
    query = f'SELECT {", ".join(columns)} FROM {{database:Identifier}}.{{table:Identifier}} AS src'
    params = {'database': config['database'], 'table': config['table'],
              **{f'field_{key}': value for key, value in fields.items()}}
    return query, params


def test_connection(config):
    query, params = _selection(config)
    # LIMIT 0 validates the selected table, columns and SELECT permission without returning events.
    _query(config, query + ' LIMIT 0 FORMAT JSONEachRow', params, 1)
    rows = _query(config, 'SELECT version() AS version FORMAT JSONEachRow', {}, 1)
    version = rows[0].get('version') if len(rows) == 1 else None
    if not isinstance(version, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', version):
        raise ClickHouseError('ClickHouse returned an invalid server version.')
    return {'ok': True, 'status': 200, 'server_info': {'version': version}}


def fetch_events(config, size):
    query, params = _selection(config)
    params.update(lookback=config['lookback_hours'], limit=size)
    query += (' WHERE src.{field_timestamp:Identifier} >= now() - toIntervalHour({lookback:UInt16})'
              ' AND src.{field_timestamp:Identifier} <= now()'
              ' ORDER BY src.{field_timestamp:Identifier} DESC, src.{field_alert_id:Identifier} ASC'
              ' LIMIT {limit:UInt32} FORMAT JSONEachRow')
    return _query(config, query, params, size)
