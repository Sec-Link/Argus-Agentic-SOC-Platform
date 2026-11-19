export type PageContext = {
  path: string;
  title: string;
  content: string;
};

const EXCLUDED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'INPUT', 'TEXTAREA', 'SELECT', 'FORM',
  'FIELDSET', 'PRE', 'CODE', 'IFRAME', 'SVG', 'CANVAS',
]);
const STRUCTURAL_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BUTTON', 'TH', 'LABEL']);
const PRIVATE_ROUTES = /^\/(?:profile|settings\/(?:ai-assistant|integrations|system|permissions|registration-approvals|audit-logs))(?:\/|$)/i;
const SECRET_LABEL = '(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|token|password|passwd|secret|client[ _-]?secret|authorization|cookie|private[ _-]?key|密码|口令|密钥|令牌)';

export function redactPageText(value: string): string {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, url => url.split(/[?#]/, 1)[0].replace(/^(https?:\/\/)[^/]*@/i, '$1'))
    .replace(new RegExp(`(^|[\\s{,])["']?${SECRET_LABEL}["']?\\s*(?::|=|\\n)\\s*[^\\n]*`, 'gi'), '$1[redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}/g, '[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]');
}

/** Collect only the supplied page subtree; never inspect browser storage or form values. */
export function collectPageContext(
  root: HTMLElement | null,
  pathname: string,
  includePageContent = false,
): PageContext {
  const route = pathname.split(/[?#]/, 1)[0];
  const path = redactPageText(route)
    .replace(/\/(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,})(?=\/|$)/gi, '/[id]')
    .slice(0, 300);
  if (!root) return { path, title: path.slice(0, 200), content: '' };

  const includeText = includePageContent && !PRIVATE_ROUTES.test(route);
  const chunks: string[] = [];
  const titleChunks: string[] = [];
  let firstHeading: Element | null = null;
  let visited = 0;
  let characters = 0;
  const stack: { node: Node; structural: boolean; heading: boolean }[] = [
    { node: root, structural: false, heading: false },
  ];

  while (stack.length && visited++ < 6000 && characters < 24000) {
    const item = stack.pop()!;
    if (item.node.nodeType === 3) {
      if (!includeText && !item.structural) continue;
      const raw = item.node.textContent;
      if (!raw) continue;
      // Keep labels and values intact until assembled; a partial node could expose a secret fragment.
      if (raw.length + 1 > 24000 - characters) break;
      characters += raw.length + 1;
      const text = raw.trim().replace(/[\t\r ]+/g, ' ');
      if (!text) continue;
      chunks.push(text);
      if (item.heading) titleChunks.push(text);
      continue;
    }
    if (item.node.nodeType !== 1) continue;
    const element = item.node as HTMLElement;
    if (EXCLUDED_TAGS.has(element.tagName) || element.hidden || element.isContentEditable
      || element.getAttribute('aria-hidden') === 'true'
      || element.hasAttribute('data-ai-context-exclude')
      || element.hasAttribute('contenteditable')) continue;

    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (style?.display === 'none' || style?.visibility === 'hidden'
      || style?.visibility === 'collapse' || style?.opacity === '0'
      || style?.getPropertyValue('content-visibility') === 'hidden') continue;
    if (style?.display !== 'contents' && element.getClientRects().length === 0) continue;

    const isHeading = /^H[1-6]$/.test(element.tagName);
    if (isHeading && !firstHeading) firstHeading = element;
    const structural = item.structural || STRUCTURAL_TAGS.has(element.tagName)
      || element.getAttribute('role') === 'tab';
    const heading = item.heading || element === firstHeading;
    // Bound pending work as well as the number of visited nodes on very large tables.
    for (let index = Math.min(element.childNodes.length, 6000 - visited) - 1; index >= 0; index--) {
      if (stack.length >= 6000) break;
      stack.push({ node: element.childNodes[index], structural, heading });
    }
  }

  return {
    path,
    title: redactPageText(titleChunks.join('\n')).replace(/\s+/g, ' ').slice(0, 200) || path.slice(0, 200),
    content: redactPageText(chunks.join('\n')).replace(/\n{3,}/g, '\n\n').slice(0, 12000),
  };
}
