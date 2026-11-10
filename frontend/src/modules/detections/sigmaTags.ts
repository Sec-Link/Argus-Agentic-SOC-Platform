// Read / write the top-level `tags:` list of a Sigma rule YAML without a YAML parser, so the rule
// editor can offer a tag input while the YAML text stays the single source of truth.

interface TagsBlock {
  start: number; // line index of `tags:`
  end: number; // exclusive end line index of the block
  indent: string;
  tags: string[];
}

const stripComment = (value: string) => value.replace(/\s+#.*$/, '').trim();

const unquote = (value: string) => {
  const v = stripComment(value);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
};

const quoteIfNeeded = (tag: string) => (/^[A-Za-z0-9_.\-/]+$/.test(tag) ? tag : JSON.stringify(tag));

/** Index just past the first YAML document (before a `---` separator that follows content). */
const firstDocumentEnd = (lines: string[]) => {
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---\s*$/.test(lines[i]) && lines.slice(0, i).some((l) => l.trim() && l.trim() !== '---')) return i;
  }
  return lines.length;
};

const findBlock = (lines: string[]): TagsBlock | null => {
  const docEnd = firstDocumentEnd(lines);
  for (let i = 0; i < docEnd; i += 1) {
    const m = /^tags\s*:(.*)$/.exec(lines[i]);
    if (!m) continue;
    const rest = stripComment(m[1]);
    if (rest.startsWith('[')) {
      const inner = rest.replace(/^\[/, '').replace(/\]$/, '');
      const tags = inner.split(',').map(unquote).filter(Boolean);
      return { start: i, end: i + 1, indent: '  ', tags };
    }
    const tags: string[] = [];
    let indent = '  ';
    let j = i + 1;
    for (; j < docEnd; j += 1) {
      const item = /^(\s*)-\s*(.*)$/.exec(lines[j]);
      if (item) {
        indent = item[1];
        const tag = unquote(item[2]);
        if (tag) tags.push(tag);
      } else if (lines[j].trim() !== '' && !/^\s*#/.test(lines[j])) {
        break;
      }
    }
    // Do not swallow trailing blank lines into the block.
    while (j > i + 1 && lines[j - 1].trim() === '') j -= 1;
    return { start: i, end: j, indent, tags };
  }
  return null;
};

export const readSigmaTags = (yamlText: string): string[] => findBlock(yamlText.split('\n'))?.tags ?? [];

export const writeSigmaTags = (yamlText: string, tags: string[]): string => {
  const lines = yamlText.split('\n');
  const clean = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
  const block = findBlock(lines);
  const render = (indent: string) => (clean.length ? ['tags:', ...clean.map((t) => `${indent}- ${quoteIfNeeded(t)}`)] : []);

  if (block) {
    lines.splice(block.start, block.end - block.start, ...render(block.indent));
    return lines.join('\n');
  }
  if (!clean.length) return yamlText;

  const docEnd = firstDocumentEnd(lines);
  let at = lines.slice(0, docEnd).findIndex((l) => /^logsource\s*:/.test(l));
  if (at < 0) at = lines.slice(0, docEnd).findIndex((l) => /^detection\s*:/.test(l));
  if (at < 0) {
    at = docEnd;
    while (at > 0 && lines[at - 1].trim() === '') at -= 1;
  }
  lines.splice(at, 0, ...render('  '));
  return lines.join('\n');
};
