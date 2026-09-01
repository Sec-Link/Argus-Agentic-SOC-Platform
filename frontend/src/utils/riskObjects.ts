// Safe, shape-tolerant parsing of the `risk_object(s)` field carried on alerts.
//
// The value may arrive in several forms depending on the source:
//   - a JSON string injected by the ELK alert action            → '[{"field":"source.ip",...}]'
//   - the RBA pipeline array  [{ field, type, value, ... }]      (Alert.risk_objects)
//   - a Splunk-style array    [{ risk_object, risk_object_type }]
//   - an object map           { ip: "1.2.3.4", user: "root" }
//   - a single entity object / plain string
//
// Anything invalid (null, malformed JSON, unexpected shape) degrades to [] so
// callers never throw and the existing UI keeps working.

export type RiskEntity = { type: string; value: string; field?: string };

const TYPE_HINTS: Record<string, string> = {
  ip: 'ip', 'source.ip': 'ip', 'destination.ip': 'ip', src_ip: 'ip', client_ip: 'ip',
  user: 'user', 'user.name': 'user', 'user.id': 'user',
  host: 'host', 'host.name': 'host', 'host.id': 'host', hostname: 'host',
  hash: 'hash', 'file.hash.sha256': 'hash',
};

const inferType = (field?: string, explicit?: string): string => {
  const e = String(explicit || '').trim().toLowerCase();
  if (e) return e;
  const f = String(field || '').trim().toLowerCase();
  return TYPE_HINTS[f] || (f.split('.')[0] || 'other');
};

const pushEntity = (out: RiskEntity[], field: string | undefined, type: string | undefined, value: unknown) => {
  if (value === null || value === undefined) return;
  const values = Array.isArray(value) ? value : [value];
  for (const v of values) {
    const val = String(v ?? '').trim();
    if (!val) continue;
    out.push({ type: inferType(field, type), value: val, field: field || undefined });
  }
};

/** Parse an arbitrary risk_object(s) value into a normalized entity list. Never throws. */
export function parseRiskObjects(input: unknown): RiskEntity[] {
  if (input === null || input === undefined || input === '') return [];

  // Unwrap JSON strings (possibly double-encoded).
  let data: unknown = input;
  for (let i = 0; i < 2 && typeof data === 'string'; i++) {
    const s = (data as string).trim();
    if (!s || (s[0] !== '[' && s[0] !== '{')) break;
    try {
      data = JSON.parse(s);
    } catch {
      return [];
    }
  }

  const out: RiskEntity[] = [];
  try {
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const field = (o.field ?? o.risk_object_field ?? o.name) as string | undefined;
          const type = (o.type ?? o.risk_object_type) as string | undefined;
          const value = o.value ?? o.risk_object ?? o.entity ?? o.id;
          if (value !== undefined) pushEntity(out, field, type, value);
          else for (const [k, v] of Object.entries(o)) pushEntity(out, k, undefined, v);
        } else {
          pushEntity(out, undefined, undefined, item);
        }
      }
    } else if (data && typeof data === 'object') {
      const o = data as Record<string, unknown>;
      const value = o.value ?? o.risk_object ?? o.entity;
      if (value !== undefined) pushEntity(out, (o.field ?? o.name) as string, (o.type ?? o.risk_object_type) as string, value);
      else for (const [k, v] of Object.entries(o)) pushEntity(out, k, undefined, v);
    }
  } catch {
    return [];
  }

  // De-dupe on type+value.
  const seen = new Set<string>();
  return out.filter((e) => {
    const key = `${e.type}:${e.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Pull the risk_object(s) value from an alert row regardless of where it sits. */
export function getRiskObjects(row: any): RiskEntity[] {
  const raw =
    row?.risk_objects ?? row?.risk_object ?? row?.body?.risk_objects ?? row?.body?.risk_object ?? null;
  return parseRiskObjects(raw);
}

export const riskTagColor = (type: string): string =>
  ({ ip: 'blue', user: 'purple', host: 'cyan', hash: 'orange' } as Record<string, string>)[type] || 'default';
