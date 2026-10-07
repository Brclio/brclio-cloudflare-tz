// Copyright (C) 2026 Brclio. GPL-2.0-only.
const healthTypes = new Set(['url-test', 'fallback', 'load-balance']);
const known204URLs = new Set(['www.gstatic.com', 'www.google.com', 'cp.cloudflare.com']
  .flatMap(host => ['http', 'https'].map(scheme => `${scheme}://${host}/generate_204`)));

// Locate flow delimiters without interpreting quoted strings or nested values.
function delimiters(text, delimiter) {
  const found = [];
  let quote = '', depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (quote === '"' && char === '\\') { index++; continue; }
      if (char === quote) {
        if (quote === "'" && text[index + 1] === "'") index++;
        else quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (index === 0 || /\s/.test(text[index - 1]))) return null;
    if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') { if (--depth < 0) return null; }
    else if (char === delimiter && depth === 0) found.push(index);
  }
  return quote || depth ? null : found;
}

function scalar(text) {
  text = text.trim();
  if (!text) return null;
  if (text[0] === '"') {
    const match = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/s.exec(text);
    if (!match) return null;
    try { return JSON.parse(match[1]); } catch { return null; }
  }
  if (text[0] === "'") {
    const match = /^'((?:[^']|'')*)'\s*(?:#.*)?$/s.exec(text);
    return match ? match[1].replaceAll("''", "'") : null;
  }
  text = text.replace(/\s+#.*$/s, '').trim();
  return !text || /[\r\n\[\]{}&*!|>]/.test(text) ? null : text;
}

function property(text) {
  const positions = delimiters(text.replace(/\s+#.*$/, ''), ':');
  if (!positions?.length) return null;
  const colon = positions[0];
  if (!/\s/.test(text[colon + 1] || ' ')) return null;
  const key = scalar(text.slice(0, colon));
  return key && /^[\w-]+$/.test(key) ? [key, text.slice(colon + 1)] : null;
}

function eligible(properties) {
  return !properties.has('expected-status') && !properties.has('<<')
    && healthTypes.has(scalar(properties.get('type') || ''))
    && known204URLs.has(scalar(properties.get('url') || ''));
}

function patchFlow(text) {
  const open = text.indexOf('{');
  // The final brace may be followed only by whitespace or a YAML comment.
  const end = /}(\s*(?:#.*)?\s*)$/s.exec(text);
  if (open < 0 || !end) return text;
  const close = end.index, inner = text.slice(open + 1, close);
  const commas = delimiters(inner, ',');
  if (!commas) return text;
  const parts = [], properties = new Map();
  let start = 0;
  for (const comma of [...commas, inner.length]) {
    const part = inner.slice(start, comma).trim();
    start = comma + 1;
    if (!part && comma === inner.length) continue;
    const entry = property(part);
    if (!entry || properties.has(entry[0])) return text;
    properties.set(...entry); parts.push(part);
  }
  if (!parts.length || !eligible(properties)) return text;
  const insertion = open + 1 + inner.trimEnd().length;
  const addition = inner.trimEnd().endsWith(',') ? ' expected-status: 204,' : ', expected-status: 204';
  return text.slice(0, insertion) + addition + text.slice(insertion);
}

function patchBlock(lines, indent) {
  const properties = new Map();
  let urlLine = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = index === 0 ? lines[index].slice(indent + 2) : lines[index];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/\t/.test(line)) return lines;
    if (index && line.search(/\S/) !== indent + 2) continue;
    if (index && /^ *- /.test(line)) continue; // YAML permits indentless child sequences.
    const entry = property(index ? line.trimStart() : line);
    if (!entry || properties.has(entry[0])) return lines;
    properties.set(...entry);
    if (entry[0] === 'url') urlLine = index;
  }
  if (!eligible(properties) || urlLine < 0) return lines;
  return [...lines.slice(0, urlLine + 1), `${' '.repeat(indent + 2)}expected-status: 204`, ...lines.slice(urlLine + 1)];
}

// Patch only ordinary group mappings. Unknown YAML forms remain byte-for-byte
// unchanged; custom URLs and every explicit expected-status retain their meaning.
export function patchClashHealthChecks(yaml) {
  if (typeof yaml !== 'string') return yaml;
  const eol = yaml.includes('\r\n') ? '\r\n' : '\n';
  const lines = yaml.split(eol), header = lines.findIndex(line => /^proxy-groups:\s*(?:#.*)?$/.test(line));
  if (header < 0) return yaml;
  let end = header + 1;
  while (end < lines.length && (!lines[end].trim() || /^\s*#/.test(lines[end]) || /^\s/.test(lines[end]) || /^-\s/.test(lines[end]))) end++;
  const first = lines.slice(header + 1, end).find(line => line.trim() && !/^\s*#/.test(line));
  if (!first || !/^ *- /.test(first)) return yaml;
  const indent = first.search(/\S/), starts = [];
  for (let index = header + 1; index < end; index++) {
    if (lines[index].search(/\S/) === indent && /^ *- /.test(lines[index])) starts.push(index);
  }
  for (let index = starts.length - 1; index >= 0; index--) {
    const start = starts[index], stop = starts[index + 1] ?? end;
    const group = lines.slice(start, stop);
    const patched = /^ *- \{/.test(group[0])
      ? patchFlow(group.join(eol)).split(eol)
      : patchBlock(group, indent);
    lines.splice(start, stop - start, ...patched);
  }
  return lines.join(eol);
}
