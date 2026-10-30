#!/usr/bin/env node
// DiluxOne Mermaid · validates mermaid diagrams before they break.
//
//   diluxone-mermaid file.md [other.mmd ...] [--fix] [--png <dir>]
//                   [--versions 10,11,12] [--json] [--strict]
//   cat diagram.mmd | diluxone-mermaid -
//
// Layer 1: text lint. Layer 2: real parser in every mermaid version.
// Layer 3: geometry of the rendered SVG. With --fix it applies the lint fixes
// and accepts them only if the result does not break any version that worked
// before. Exits with 1 if any error remains (or any warning, with --strict).

import fs from 'node:fs';
import path from 'node:path';
import { extractBlocks, replaceBlocks } from '../src/extract.mjs';
import { evaluate } from '../src/evaluate.mjs';
import { createRenderer, DEFAULT_VERSIONS } from '../src/render.mjs';

function parseArgs(argv) {
  const opts = { files: [], fix: false, png: null, versions: DEFAULT_VERSIONS, json: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fix') opts.fix = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--png') opts.png = argv[++i];
    else if (a === '--versions') opts.versions = argv[++i].split(',').map((v) => v.trim());
    else if (a === '-h' || a === '--help') opts.help = true;
    else opts.files.push(a);
  }
  return opts;
}

const HELP = `DiluxOne Mermaid · validates mermaid diagrams

  diluxone-mermaid <file.md|file.mmd|-> [...] [options]

  --fix               apply the safe fixes and rewrite the file
  --png <dir>         save one PNG per diagram (for visual review)
  --versions 10,11,12 mermaid versions to parse against
  --json              machine-readable output
  --strict            warnings also fail
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.files.length === 0) {
    process.stdout.write(HELP);
    process.exit(opts.help ? 0 : 2);
  }
  if (opts.png) fs.mkdirSync(opts.png, { recursive: true });

  const renderer = await createRenderer(opts.versions);
  const report = { versions: renderer.versions.map((v) => v.version), files: [] };
  let hasError = false;
  let hasWarn = false;

  try {
    for (const file of opts.files) {
      const isStdin = file === '-';
      const text = isStdin ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
      const blocks = extractBlocks(text, isStdin ? 'stdin.mmd' : file);
      const fileReport = { file, diagrams: [] };
      const fixes = [];

      for (const block of blocks) {
        const base = isStdin ? 'stdin' : path.basename(file).replace(/\.[^.]+$/, '');
        const png = opts.png ? path.join(opts.png, `${base}-${block.index + 1}.png`) : undefined;
        const r = await evaluate(block.code, renderer, { fix: opts.fix, png });
        const shift = (i) => ({ ...i, line: i.line + block.startLine - 1 });
        if (r.fixedCode !== null) fixes.push({ range: block.range, code: r.fixedCode });
        fileReport.diagrams.push({
          index: block.index + 1,
          line: block.startLine,
          type: r.type,
          status: r.status,
          lint: r.issues.map(shift),
          fixed: r.fixed.map(shift),
          fixRejected: r.fixRejected,
          render: r.render,
        });
        hasError ||= r.status === 'error';
        hasWarn ||= r.status === 'warn';
      }

      if (fixes.length && !isStdin) {
        fs.writeFileSync(file, replaceBlocks(text, fixes));
        fileReport.rewritten = true;
      } else if (fixes.length && isStdin) {
        fileReport.fixedCode = fixes[0].code;
      }
      report.files.push(fileReport);
    }
  } finally {
    await renderer.close();
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    printHuman(report);
  }
  process.exit(hasError || (opts.strict && hasWarn) ? 1 : 0);
}

function printHuman(report) {
  const out = [];
  const icon = { ok: '✓', warn: '!', error: '✗' };
  out.push(`DiluxOne Mermaid · mermaid ${report.versions.join(' · ')}`);
  for (const f of report.files) {
    if (f.diagrams.length === 0) {
      out.push(`\n${f.file}: no mermaid diagrams.`);
      continue;
    }
    for (const d of f.diagrams) {
      out.push(`\n${icon[d.status]} ${f.file}:${d.line} · diagram ${d.index} (${d.type || 'no type'})`);
      for (const i of d.fixed) out.push(`    fixed      l.${i.line} [${i.rule}] ${i.msg}`);
      if (d.fixRejected) out.push(`    not fixed: ${d.fixRejected}`);
      for (const i of [...d.lint].sort((a, b) => a.line - b.line)) out.push(`    ${i.severity.padEnd(9)}  l.${i.line} [${i.rule}] ${i.msg}`);
      // The same error or warning across versions is shown once.
      const grouped = new Map();
      const push = (sev, msg, version) => {
        const key = sev + '\0' + msg;
        grouped.set(key, { sev, msg, versions: [...(grouped.get(key)?.versions ?? []), version] });
      };
      for (const r of Object.values(d.render)) {
        if (!r.ok) {
          const msg = r.error ? r.error.split('\n').slice(0, 3).join(' | ') : r.errors.map((e) => e.msg).join(' | ');
          push('error', `fails at ${r.stage}: ${msg.length > 300 ? msg.slice(0, 300) + '…' : msg}`, r.version);
        }
        for (const w of r.warnings ?? []) push('warn', `[${w.rule}] ${w.msg}`, r.version);
      }
      for (const { sev, msg, versions } of grouped.values()) {
        out.push(`    ${sev.padEnd(9)}  mermaid ${versions.join(' · ')}: ${msg}`);
      }
      const shown = Object.values(d.render).find((r) => r.png);
      if (shown) out.push(`    png        ${shown.png}`);
    }
    if (f.rewritten) out.push(`\n  ${f.file} rewritten with the fixes.`);
    if (f.fixedCode) out.push(`\n--- fixed code ---\n${f.fixedCode}\n---`);
  }
  process.stdout.write(out.join('\n') + '\n');
}

main().catch((e) => {
  process.stderr.write(`diluxone-mermaid: ${e.stack ?? e}\n`);
  process.exit(2);
});
