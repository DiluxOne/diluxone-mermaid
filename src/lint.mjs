// Layer 1 · deterministic lint on the source text, before parsing.
// Catches what breaks the parser (or breaks it in another version) and what
// parses but renders wrong: invisible characters, mojibake, smart quotes,
// unquoted labels with symbols, `end` as an ID, unclosed blocks, invalid
// %%{init}%% JSON. With fix: true it returns the corrected code; it only fixes
// what is mechanical and does not change the meaning.

export const KNOWN_TYPES = [
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'classDiagram-v2',
  'stateDiagram', 'stateDiagram-v2', 'erDiagram', 'journey', 'gantt', 'pie',
  'quadrantChart', 'requirementDiagram', 'gitGraph', 'C4Context', 'C4Container',
  'C4Component', 'C4Dynamic', 'C4Deployment', 'mindmap', 'timeline', 'zenuml',
  'sankey', 'sankey-beta', 'xychart', 'xychart-beta', 'block', 'block-beta',
  'packet', 'packet-beta', 'kanban', 'architecture', 'architecture-beta',
  'radar-beta', 'treemap', 'treemap-beta',
];

const INVISIBLE = {
  '\u00A0': ' ', '\u2007': ' ', '\u202F': ' ', '\u3000': ' ',
  '\u200B': '', '\u200C': '', '\u200D': '', '\u2060': '', '\uFEFF': '', '\u00AD': '',
};
const INVISIBLE_RE = /[\u00A0\u2007\u202F\u3000\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const LINE_SEP_RE = /[\u2028\u2029]/g;

// UTF-8 read as Windows-1252: "Ã¡" instead of "á", "â€œ" instead of "“".
const MOJIBAKE_RE = /Ã[\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]|Â[\u00A0-¿]|â€/;
const CP1252 = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91,
  '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98,
  '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
};

function unmojibake(s) {
  const bytes = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c <= 0xFF) bytes.push(c);
    else if (CP1252[ch] !== undefined) bytes.push(CP1252[ch]);
    else return null;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

// Characters that break an unquoted label, and the ones that break it depending
// on the version or the destination. Quoted labels accept anything but `"`.
const BREAKING = /[()[\]{}"|;]/;
const RISKY = /[<>:#&@`%'\\/]|[^\x00-\x7F]/;
const ALLOWED_TAGS = new Set(['br', 'b', 'i', 'strong', 'em', 'sub', 'sup', 'u', 'small', 'span']);
const TAG_RE = /<\/?([a-zA-Z][\w-]*)[^>]*>/g;

const SHAPES = [
  ['(((', [')))']], ['([', ['])']], ['[[', [']]']], ['[(', [')]']], ['((', ['))']],
  ['{{', ['}}']], ['[/', ['/]', '\\]']], ['[\\', ['\\]', '/]']], ['[', [']']],
  ['(', [')']], ['{', ['}']], ['>', [']']],
];
const LINK_RE = /\s*(?:[<ox]?(?:-{2,}|={2,}|-\.+-?)[->ox]?|~~~)|\s*&\s*|:::/g;
const ID_CHAR = /[\p{L}\p{N}_]/u;
const MASK = '\x01';

function stripTags(s) {
  return s.replace(/<br\s*\/?>/gi, ' ').replace(TAG_RE, '');
}

// A # followed by text that is not an entity (#1, C#): mermaid 10 takes it as
// the start of a character code and silently swallows the text.
const BARE_HASH = /#(?!(?:\d+|[a-zA-Z]+);)/g;
const hasBareHash = (s) => /#(?!(?:\d+|[a-zA-Z]+);)/.test(s);
const escapeHash = (s) => s.replace(BARE_HASH, '#35;');

function quoteLabel(s) {
  return '"' + escapeHash(s.trim()).replace(/"/g, '#quot;') + '"';
}

// Finds the labels in a flowchart line: node shapes, |text| on edges and
// `-- text -->`. Returns their ranges, to check them and to mask them.
function scanFlowLabels(line) {
  const spans = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      const j = line.indexOf('"', i + 1);
      if (j === -1) break;
      i = j + 1;
      continue;
    }
    if (ch === '|') {
      // The closing pipe is the last | before the next edge, so a | inside the
      // text (|a|b|) does not cut the label.
      LINK_RE.lastIndex = i + 1;
      let next = line.length;
      for (let m; (m = LINK_RE.exec(line)) !== null;) {
        if (m[0].length === 0) { LINK_RE.lastIndex++; continue; }
        if (!/[[({]/.test(line.slice(i + 1, m.index))) continue;
        next = m.index;
        break;
      }
      const shapeAt = line.slice(i + 1, next).search(/\|\s*[\p{L}\p{N}_]+[[({]/u);
      const limit = shapeAt === -1 ? next : i + 1 + shapeAt;
      let j = line.lastIndexOf('|', limit);
      if (j <= i) j = line.indexOf('|', i + 1);
      if (j === -1) break;
      const body = line.slice(i + 1, j).trim();
      spans.push({ kind: 'pipe', outer: [i, j + 1], inner: [i + 1, j], quoted: body.length > 1 && body.startsWith('"') && body.endsWith('"') });
      i = j + 1;
      continue;
    }
    if ('([{>'.includes(ch) && i > 0 && ID_CHAR.test(line[i - 1])) {
      // Longest shape first: [(note) x] is not a cylinder unless it closes with
      // )]; it is a rectangle with a parenthesis inside.
      const candidates = SHAPES.filter(([o]) => line.startsWith(o, i));
      if (!candidates.length) { i++; continue; }
      const closesAt = ([o, cs]) => {
        LINK_RE.lastIndex = i + o.length;
        let end = line.length;
        for (let m; (m = LINK_RE.exec(line)) !== null;) {
          if (m[0].length === 0) { LINK_RE.lastIndex++; continue; }
          if (cs.some((c) => line.slice(0, m.index).trimEnd().endsWith(c))) { end = m.index; break; }
        }
        const seg = line.slice(0, end).replace(/[\s;]+$/, '');
        return cs.some((c) => seg.endsWith(c)) || line.slice(i + o.length).trimStart().startsWith('"');
      };
      const shape = candidates.find(closesAt) ?? candidates[0];
      const [open, closers] = shape;
      const start = i + open.length;
      const lead = line.slice(start).match(/^\s*/)[0].length;
      const q = line[start + lead] === '"' ? line.indexOf('"', start + lead + 1) : -1;
      if (q !== -1) {
        const rest = line.slice(q + 1);
        const closer = closers.find((c) => rest.trimStart().startsWith(c));
        if (!closer) {
          // Quotes inside quotes? A["says "hi""]: the real end is the last quote
          // followed by the shape's closer.
          const ends = closers.map((c) => [c, line.indexOf('"' + c, q + 1)]).filter(([, at]) => at !== -1);
          if (ends.length) {
            const [c, at] = ends.sort((a, b) => a[1] - b[1])[0];
            spans.push({ kind: 'node', outer: [i, at + 1 + c.length], inner: [start, at + 1], open, closer: c, quoted: true, innerQuotes: true });
            i = at + 1 + c.length;
            continue;
          }
        } else {
          const end = q + 1 + (rest.length - rest.trimStart().length) + closer.length;
          spans.push({ kind: 'node', outer: [i, end], inner: [start, q + 1], open, closer, quoted: true });
          i = end;
          continue;
        }
      }
      // Unquoted (or quoted without wrapping the whole label, like
      // ["quote" x:y]): it runs to the next edge, & or :::, and has to end
      // with the shape's closer.
      LINK_RE.lastIndex = start;
      let segEnd = line.length;
      let m;
      while ((m = LINK_RE.exec(line)) !== null) {
        if (m[0].length === 0) { LINK_RE.lastIndex++; continue; }
        const before = line.slice(start, m.index);
        if (closers.some((c) => before.trimEnd().endsWith(c))) { segEnd = m.index; break; }
      }
      let seg = line.slice(0, segEnd).replace(/[\s;]+$/, '');
      const closer = closers.find((c) => seg.endsWith(c) && seg.length - c.length >= start);
      if (!closer) {
        spans.push({ kind: 'node', outer: [i, segEnd], inner: [start, segEnd], open, unclosed: true });
        i = segEnd;
        continue;
      }
      const innerEnd = seg.length - closer.length;
      spans.push({ kind: 'node', outer: [i, seg.length], inner: [start, innerEnd], open, closer });
      i = seg.length;
      continue;
    }
    i++;
  }
  return spans;
}

function mask(line, spans) {
  let out = line;
  for (const s of spans) {
    const [a, b] = s.outer;
    out = out.slice(0, a) + MASK.repeat(b - a) + out.slice(b);
  }
  // Loose quoted strings (click, linkStyle, etc.)
  out = out.replace(/"[^"]*"/g, (q) => MASK.repeat(q.length));
  return out;
}

const EDGE_TEXT_RE = /(?<![-=.<])(--|==|-\.)\s+(?![->=.])(.+?)\s+(-{2,}[>ox]?|={2,}[>ox]?|\.-+[>ox]?)(?=\s*[\p{L}\p{N}_"(\[])/u;

function headerInfo(lines) {
  let i = 0;
  let frontmatter = null;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (lines[i]?.trim() === '---') {
    const close = lines.findIndex((l, k) => k > i && l.trim() === '---');
    frontmatter = { start: i, end: close };
    i = close === -1 ? lines.length : close + 1;
  }
  while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('%%'))) i++;
  const raw = lines[i]?.trim() ?? '';
  const type = raw.match(/^([A-Za-z0-9-]+)/)?.[1] ?? '';
  return { headerLine: i, type, frontmatter };
}

function translit(id) {
  return id.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]/g, '_');
}

export function lint(code, { fix = false } = {}) {
  const issues = [];
  const add = (rule, severity, line, msg, fixable = false) =>
    issues.push({ rule, severity, line, msg, fixable });

  let text = code;

  // Byte-level normalization, before looking at the syntax.
  if (text.includes('\r')) {
    add('crlf', 'info', 1, 'Windows line endings (CRLF).', true);
    text = text.replace(/\r\n?/g, '\n');
  }
  if (LINE_SEP_RE.test(text)) {
    add('unicode-line-separator', 'error', 1, 'Unicode line separators (U+2028/U+2029): mermaid does not treat them as line breaks.', true);
    text = text.replace(LINE_SEP_RE, '\n');
  }

  let lines = text.split('\n');
  lines = lines.map((l, k) => {
    if (!MOJIBAKE_RE.test(l)) return l;
    const repaired = unmojibake(l);
    add('mojibake', 'error', k + 1,
      `Broken text encoding (for example "Ã¡" instead of "á")${repaired ? `: should be "${repaired.trim()}"` : ''}.`,
      !!repaired);
    return repaired ?? l;
  });
  lines = lines.map((l, k) => {
    const found = l.match(INVISIBLE_RE);
    if (!found) return l;
    const names = [...new Set(found)].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
    // Zero-width characters change IDs invisibly (A and A+ZWSP are different
    // nodes); non-breaking spaces render fine today, but they are fragile.
    const zeroWidth = found.some((c) => INVISIBLE[c] === '');
    add('invisible', zeroWidth ? 'error' : 'warn', k + 1, zeroWidth
      ? `Zero-width characters (${names.join(', ')}): invisible, but they change IDs and text.`
      : `Non-breaking spaces (${names.join(', ')}): fine today, but an older destination may not treat them as spaces.`, true);
    return l.replace(INVISIBLE_RE, (c) => INVISIBLE[c]);
  });
  lines = lines.map((l, k) => {
    if (!l.includes('\t')) return l;
    add('tab', 'info', k + 1, 'Tab character: replaced with spaces.', true);
    return l.replace(/\t/g, '  ');
  });

  // Smart quotes used as label delimiters: A[“text”].
  lines = lines.map((l, k) => {
    const re = /([[({>|]\s*)[“”„‟«]([^“”„‟«»]*)[“”„‟»](\s*[\])}|])/g;
    if (!re.test(l)) return l;
    add('smart-quotes', 'error', k + 1, 'Smart quotes (“ ” « ») used as label delimiters: mermaid only understands straight quotes (").', true);
    return l.replace(re, (_, a, body, b) => `${a}"${body.replace(/"/g, '#quot;')}"${b}`);
  });

  const { headerLine, type, frontmatter } = headerInfo(lines);
  if (frontmatter && frontmatter.end === -1) {
    add('frontmatter', 'error', frontmatter.start + 1, 'The `---` config block is never closed.');
  }
  if (!type) {
    add('diagram-type', 'error', headerLine + 1, 'Missing diagram type on the first line (flowchart, sequenceDiagram, ...).');
  } else if (!KNOWN_TYPES.includes(type)) {
    const close = KNOWN_TYPES.find((t) => t.toLowerCase() === type.toLowerCase());
    add('diagram-type', 'error', headerLine + 1,
      `Unknown diagram type: "${type}"${close ? `. Did you mean "${close}"? Case matters` : ''}.`,
      !!close);
    if (close) lines[headerLine] = lines[headerLine].replace(type, close);
  }
  const kind = (KNOWN_TYPES.find((t) => t.toLowerCase() === type.toLowerCase()) ?? type);

  // %%{init: ...}%% directives: if the JSON does not parse, mermaid silently ignores them.
  lines.forEach((l, k) => {
    const m = l.match(/^\s*%%\{([\s\S]*)\}%%\s*$/);
    if (!m) return;
    const d = m[1].match(/^\s*(init|initialize)\s*:\s*([\s\S]*)$/);
    if (!d) {
      add('init', 'warn', k + 1, 'A %%{ }%% directive that is not init: mermaid ignores it.');
      return;
    }
    try {
      JSON.parse(d[2]);
    } catch {
      try {
        JSON.parse(d[2].replace(/'/g, '"'));
      } catch {
        add('init', 'error', k + 1, 'Invalid %%{init}%% JSON: mermaid silently ignores it and the diagram renders with the default config.');
      }
    }
  });

  // Comments at the end of a code line: mermaid only accepts %% at the start of a line.
  lines = lines.flatMap((l, k) => {
    const trimmed = l.trim();
    if (trimmed.startsWith('%%') || !l.includes('%%')) return [l];
    const outsideQuotes = l.replace(/"[^"]*"/g, (q) => MASK.repeat(q.length));
    const at = outsideQuotes.indexOf('%%');
    if (at === -1) return [l];
    add('inline-comment', 'error', k + 1, '%% comment at the end of a code line: mermaid only accepts comments on their own line.', true);
    const indent = l.match(/^\s*/)[0];
    return [indent + l.slice(at).trim(), l.slice(0, at).trimEnd()];
  });

  const isFlow = kind === 'flowchart' || kind === 'graph';
  const isSeq = kind === 'sequenceDiagram';
  const isState = kind.startsWith('stateDiagram');

  if (isFlow) lintFlowchart(lines, headerLine, add);
  if (isSeq) lintSequence(lines, headerLine, add);
  if (isState) {
    let depth = 0;
    lines.forEach((l) => {
      if (l.trim().startsWith('%%')) return;
      const t = l.replace(/"[^"]*"/g, '');
      depth += (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
    });
    if (depth !== 0) add('balance', 'error', 1, `Unbalanced composite-state braces (${depth > 0 ? 'missing' : 'extra'} ${Math.abs(depth)} closing).`);
  }

  const fixed = lines.join('\n');
  return {
    type: kind,
    issues,
    fixed: fix ? fixed : undefined,
    changed: fixed !== code,
  };

  function lintFlowchart(ls, header, addIssue) {
    let open = 0;
    const renames = new Map();
    ls.forEach((l, k) => {
      if (k <= header) return;
      const t = l.trim();
      if (!t || t.startsWith('%%')) return;
      if (/^end\s*;?$/.test(t)) { open--; return; }
      if (/^subgraph\b/.test(t)) {
        open++;
        const title = t.replace(/^subgraph\s+/, '');
        if (!/[[\]"]/.test(title) && BREAKING.test(title)) {
          addIssue('unquoted-label', 'error', k + 1, `Unquoted subgraph title with symbols: "${title}".`, true);
          ls[k] = l.replace(title, quoteLabel(title));
        }
        return;
      }
      if (/^(classDef|linkStyle|direction|accTitle|accDescr)\b/.test(t)) return;

      // Node and edge labels
      let line = ls[k];
      let spans = scanFlowLabels(line);
      for (const s of [...spans].reverse()) {
        if (s.unclosed) {
          addIssue('unclosed-shape', 'error', k + 1, `The "${s.open}" shape is not closed on this line.`);
          continue;
        }
        if (s.innerQuotes) {
          const raw = line.slice(s.inner[0], s.inner[1]).trim().slice(1, -1);
          addIssue('nested-quotes', 'error', k + 1, 'Quotes inside a quoted label: mermaid silently drops them and shows different text. Write them as #quot;.', true);
          line = line.slice(0, s.inner[0]) + quoteLabel(raw) + line.slice(s.inner[1]);
          continue;
        }
        if (s.quoted) {
          const q = line.slice(s.inner[0], s.inner[1]);
          if (hasBareHash(q)) {
            addIssue('bare-hash', 'error', k + 1, `A # followed by text in ${q}: mermaid 10 silently swallows what follows. Write it as #35;.`, true);
            line = line.slice(0, s.inner[0]) + escapeHash(q) + line.slice(s.inner[1]);
          }
          continue;
        }
        const content = line.slice(s.inner[0], s.inner[1]);
        const visible = stripTags(content);
        const breaking = BREAKING.test(visible) || hasBareHash(visible);
        const risky = RISKY.test(visible);
        if (breaking || risky) {
          const sev = breaking ? 'error' : 'warn';
          const why = breaking ? 'it has symbols the parser reads as syntax' : 'it has accents or symbols some versions or destinations reject';
          addIssue('unquoted-label', sev, k + 1, `Unquoted label "${content.trim()}": ${why}.`, true);
          line = line.slice(0, s.inner[0]) + quoteLabel(content) + line.slice(s.inner[1]);
        }
      }
      // -- text --> becomes -->|"text"| when the text has symbols
      const masked0 = mask(line, scanFlowLabels(line));
      const em = masked0.match(EDGE_TEXT_RE);
      if (em && !em[2].includes(MASK)) {
        const label = em[2];
        if (BREAKING.test(label) || RISKY.test(label) || hasBareHash(label)) {
          // In `-- text -->` mermaid 10 to 12 accept parentheses and accents; it is a
          // warning because |"text"| is the form that does not depend on the version.
          addIssue('unquoted-label', 'warn', k + 1, `Unquoted edge text "${label}": it parses today, but |"text"| is the safe form.`, true);
          const arrow = em[1] === '-.' ? '-.' + em[3].slice(1) : em[3];
          line = line.slice(0, em.index) + `${arrow}|${quoteLabel(label)}|` + line.slice(em.index + em[0].length);
        }
      }
      ls[k] = line;

      // IDs: `end`, IDs with accents, and o/x arrows glued to the node
      spans = scanFlowLabels(line);
      for (const s of spans) {
        const content = line.slice(s.inner[0], s.inner[1]);
        if (s.kind === 'node' && !s.unclosed) {
          const lines2 = stripTags(content).split(/<br\s*\/?>/i);
          const longest = Math.max(...lines2.map((x) => x.replace(/^"|"$/g, '').length));
          if (longest > 45) addIssue('long-label', 'warn', k + 1, `Label with ${longest} characters in one line: split it with <br/> so it does not get too wide.`);
          for (const tm of content.matchAll(TAG_RE)) {
            if (!ALLOWED_TAGS.has(tm[1].toLowerCase())) addIssue('html', 'warn', k + 1, `HTML tag <${tm[1]}>: dropped under securityLevel strict.`);
          }
        }
      }
      const masked = mask(line, spans);
      for (const w of masked.matchAll(/[\p{L}\p{N}_]+/gu)) {
        const id = w[0];
        const prev = masked[w.index - 1];
        if (/^(style|class|click|call|href)$/.test(id) && w.index === masked.search(/\S/)) continue;
        if (id === 'end' && !(prev && /[-=]/.test(prev) && /^[ox]/.test(id))) {
          addIssue('end-as-id', 'error', k + 1, 'A node is named "end": mermaid reads it as a subgraph closer. Renamed to "End".', true);
          renames.set('end', 'End');
        } else if (/[^\x00-\x7F]/.test(id)) {
          addIssue('non-ascii-id', 'warn', k + 1, `The ID "${id}" has non-ASCII characters: use ASCII IDs and keep accents in the label.`, true);
          renames.set(id, translit(id));
        }
      }
      for (const om of masked.matchAll(/(?:-{2,}|={2,})([ox])([\p{L}\p{N}_]+)/gu)) {
        addIssue('o-x-arrow', 'warn', k + 1, `"${om[0]}": mermaid reads it as a ${om[1] === 'o' ? 'circle' : 'cross'} arrow to "${om[2]}". If the node is named "${om[1]}${om[2]}", add a space before it.`);
      }
    });
    if (open !== 0) addIssue('balance', 'error', 1, `subgraph and end are unbalanced (${open > 0 ? `${open} end missing` : `${-open} extra end`}).`);

    if (renames.size) {
      const taken = new Set();
      ls.forEach((l, k) => {
        if (k <= header || /^\s*end\s*;?\s*$/.test(l) || /^\s*(classDef|linkStyle)\b/.test(l)) return;
        const masked = mask(l, scanFlowLabels(l));
        let out = '';
        let last = 0;
        for (const w of masked.matchAll(/[\p{L}\p{N}_]+/gu)) {
          if (!renames.has(w[0])) continue;
          let to = renames.get(w[0]);
          while (taken.has(to) && !renames.has(w[0])) to += '_';
          out += l.slice(last, w.index) + to;
          last = w.index + w[0].length;
        }
        ls[k] = out + l.slice(last);
      });
    }
  }

  function lintSequence(ls, header, addIssue) {
    let open = 0;
    ls.forEach((l, k) => {
      if (k <= header) return;
      const t = l.trim();
      if (!t || t.startsWith('%%')) return;
      if (/^(loop|alt|opt|par|par_over|critical|break|rect|box)\b/.test(t)) open++;
      else if (/^end$/.test(t)) open--;
      const m = l.match(/^(\s*(?:[^:]*?(?:-{1,2}>{1,2}|-{1,2}[x)]|<<-{1,2}>>)[+-]?[^:]*|\s*[Nn]ote\s+[^:]+)):(.*)$/);
      if (!m) {
        if (/^(participant|actor)\s+end\b/.test(t)) addIssue('end-as-id', 'error', k + 1, 'A participant is named "end": mermaid reads it as a block closer.');
        return;
      }
      let msg = m[2];
      const bareSemi = /(?<!#(?:\d+|[a-zA-Z]+));/g;
      if (bareSemi.test(msg)) {
        addIssue('semicolon', 'error', k + 1, 'Semicolon in a message: mermaid reads it as a statement end and cuts the text. Write it as #59;.', true);
        msg = msg.replace(bareSemi, '#59;');
      }
      if (hasBareHash(msg)) {
        addIssue('bare-hash', 'error', k + 1, 'A # followed by text in a message: mermaid 10 silently swallows what follows. Write it as #35;.', true);
        msg = escapeHash(msg);
      }
      ls[k] = m[1] + ':' + msg;
    });
    if (open !== 0) addIssue('balance', 'error', 1, `loop/alt/opt/par/rect blocks and end are unbalanced (${open > 0 ? `${open} end missing` : `${-open} extra end`}).`);
  }
}
