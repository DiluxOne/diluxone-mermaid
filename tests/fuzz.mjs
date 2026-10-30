// Probabilistic validation: generates random diagrams with poisonous labels,
// written the way someone in a hurry (or a model) would write them: unquoted.
// It measures against the real render, not against our own expectations:
//
//   false negative   diluxone-mermaid said ok, but it breaks in some version or the
//                    visible text is not what was written
//   faithful fix     after --fix it parses in every version and the visible
//                    text is exactly the original
//
//   node tests/fuzz.mjs [count] [seed]

import { createRenderer } from '../src/render.mjs';
import { evaluate } from '../src/evaluate.mjs';

const N = Number(process.argv[2] ?? 200);
const SEED = Number(process.argv[3] ?? 2027);
let seed = SEED;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

const PIECES = [
  'Payment', 'Session', 'São Paulo', 'jalapeño', 'QR', 'Core', 'API', '100%', '$50', '¿ok?', '¡go!',
  'a/b', 'x:y', '(note)', '[v2]', '{json}', 'a|b', 'A&B', '#1', '50;60', '"quote"',
  "'single'", 'a < b', 'a > b', '🚀', 'café', 'über', 'naïve', '→', '…', '—', '’',
  'Pay QR', 'end', 'o', 'x', 'Ñandú', 'C#', 'v1.2', '@user', '~tilde~', '*bold*',
];

function label() {
  const n = 1 + Math.floor(rand() * 3);
  return Array.from({ length: n }, () => pick(PIECES)).join(' ');
}

function flowchart() {
  const n = 3 + Math.floor(rand() * 3);
  const labels = Array.from({ length: n }, label);
  const edges = [];
  const lines = [`flowchart ${pick(['TD', 'LR'])}`];
  for (let i = 1; i < n; i++) {
    const from = Math.floor(rand() * i);
    const el = rand() < 0.4 ? label() : null;
    if (el) edges.push(el);
    lines.push(`  N${from}[${labels[from]}] -->${el ? `|${el}|` : ''} N${i}[${labels[i]}]`);
  }
  return { code: lines.join('\n'), expect: { nodes: labels, edges } };
}

function sequence() {
  const n = 2 + Math.floor(rand() * 4);
  const msgs = Array.from({ length: n }, label);
  const lines = ['sequenceDiagram', '  participant A', '  participant B'];
  msgs.forEach((m, i) => lines.push(`  ${i % 2 ? 'B-->>A' : 'A->>B'}: ${m}`));
  return { code: lines.join('\n'), expect: { messages: msgs } };
}

// A label that is entirely "something" is quoting syntax, not text with quotes.
const norm = (s) => s.replace(/[\s ]+/g, ' ').trim().replace(/^"([^"]*)"$/, '$1');
const sameBag = (a, b) => JSON.stringify([...a].map(norm).sort()) === JSON.stringify([...b].map(norm).sort());

// Is the render faithful? It parses in every version and shows the written text.
function faithful(render, expect) {
  for (const r of Object.values(render)) {
    if (!r.ok) return { ok: false, why: `mermaid ${r.version} fails at ${r.stage}` };
    if (expect.nodes) {
      const unique = [...new Set(r.nodes)];
      if (!sameBag(unique, [...new Set(expect.nodes)])) return { ok: false, why: `mermaid ${r.version} shows ${JSON.stringify(unique)}` };
      if (!sameBag(r.edgeLabels, expect.edges)) return { ok: false, why: `mermaid ${r.version} shows edges ${JSON.stringify(r.edgeLabels)}` };
    }
    if (expect.messages && !sameBag(r.messages, expect.messages)) {
      return { ok: false, why: `mermaid ${r.version} shows ${JSON.stringify(r.messages)}` };
    }
  }
  return { ok: true };
}

const renderer = await createRenderer();
const stats = { total: 0, broken: 0, caught: 0, mmdc: 0, falseNegative: 0, falsePositive: 0, faithfulFix: 0, unfaithfulFix: 0 };
const examples = { falseNegative: [], falsePositive: [], unfaithfulFix: [] };

try {
  for (let i = 0; i < N; i++) {
    const { code, expect } = rand() < 0.65 ? flowchart() : sequence();
    const r = await evaluate(code, renderer, { fix: true });
    const original = await renderer.check(code);
    const truth = faithful(original, expect);
    stats.total++;
    if (!truth.ok) stats.broken++;
    if (!truth.ok && r.statusBefore !== 'ok') stats.caught++;
    // Plain mmdc = parse with a single version (the latest) and check whether it fails.
    const last = Object.keys(original).at(-1);
    if (!truth.ok && !original[last].ok) stats.mmdc++;
    if (!truth.ok && r.statusBefore === 'ok') {
      stats.falseNegative++;
      examples.falseNegative.push({ code, why: truth.why });
    }
    if (truth.ok && r.statusBefore === 'error') {
      stats.falsePositive++;
      examples.falsePositive.push({ code, why: r.issues.filter((x) => x.severity === 'error').map((x) => `[${x.rule}] ${x.msg}`).join(' · ') });
    }
    const after = r.fixedCode ? await renderer.check(r.fixedCode) : original;
    const fixedTruth = faithful(after, expect);
    if (fixedTruth.ok) stats.faithfulFix++;
    else {
      stats.unfaithfulFix++;
      examples.unfaithfulFix.push({ code: r.fixedCode ?? code, why: fixedTruth.why });
    }
  }
} finally {
  await renderer.close();
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '—');
console.log(`fuzz · ${stats.total} diagrams · seed ${SEED}`);
console.log(`  actually broken (does not parse, or does not show what was written): ${stats.broken} (${pct(stats.broken, stats.total)})`);
console.log(`  caught by diluxone-mermaid: ${stats.caught}/${stats.broken} (${pct(stats.caught, stats.broken)})`);
console.log(`  caught by plain mmdc (one version, text not checked): ${stats.mmdc}/${stats.broken} (${pct(stats.mmdc, stats.broken)})`);
console.log(`  false negatives (diluxone-mermaid said ok and it was broken): ${stats.falseNegative}`);
console.log(`  false positives (diluxone-mermaid said error and it was fine): ${stats.falsePositive}`);
console.log(`  faithful in all versions after --fix: ${stats.faithfulFix}/${stats.total} (${pct(stats.faithfulFix, stats.total)})`);
for (const [k, xs] of Object.entries(examples)) {
  for (const x of xs.slice(0, 4)) console.log(`\n[${k}] ${x.why}\n${x.code}`);
}
process.exit(stats.falseNegative ? 1 : 0);
