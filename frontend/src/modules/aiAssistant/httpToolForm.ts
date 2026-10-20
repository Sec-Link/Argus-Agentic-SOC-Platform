import type { HttpToolWrite } from '../../api';

export type HttpToolFormValues = Omit<HttpToolWrite, 'query_params' | 'body_template'> & {
  query_json: string;
  body_json: string;
};

export function parseToolTemplate(text: string, label: string, scalarOnly = false): Record<string, any> {
  if (text.length > 32768) throw new Error(`${label} must be at most 32 KB.`);
  let value: unknown;
  try { value = JSON.parse(text || '{}'); }
  catch { throw new Error(`${label} must be valid JSON.`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  if (scalarOnly && Object.values(value).some((item) => item !== null && typeof item === 'object')) {
    throw new Error(`${label} values must be strings, numbers, booleans or null.`);
  }
  return value as Record<string, any>;
}

export function buildHttpToolPayload(values: HttpToolFormValues): HttpToolWrite {
  const { query_json, body_json, auth_secret, clear_auth_secret, ...fields } = values;
  if (auth_secret && clear_auth_secret) throw new Error('Choose either a replacement secret or clear the stored secret.');
  return {
    ...fields,
    query_params: parseToolTemplate(query_json, 'Query parameters', true),
    body_template: fields.method === 'POST' && body_json.trim() ? parseToolTemplate(body_json, 'JSON body') : null,
    ...(fields.auth_type === 'none' ? { auth_header: '', auth_prefix: '', clear_auth_secret: true } : {
      ...(fields.auth_type === 'bearer' ? { auth_header: '', auth_prefix: '' } : {}),
      ...(auth_secret ? { auth_secret } : {}),
      ...(clear_auth_secret ? { clear_auth_secret: true } : {}),
    }),
  };
}
