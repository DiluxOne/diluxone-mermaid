// Runs the tests/corpus cases through diluxone-mermaid and, with --bench, also through
// plain `mmdc` (what the existing mermaid skills and MCP servers do). Each case
// declares on its first lines what it should produce:
//
//   %% expect: ok|warn|error       as written
//   %% after-fix: ok|warn|error    after --fix (optional)
//
// mmdc only has ok and error: a "warn" case counts as a hit if mmdc says ok,
// since a warning is not a failure. Writes bench/RESULTS.md with --bench.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRenderer } from '../src/render.mjs';
import { evaluate } from '../src/evaluate.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const corpus = path.join(root, 'tests', 'corpus');
const bench = process.argv.includes('--bench');
const only = process.argv.slice(2).find((a) => !a.startsWith('--'));

function mmdc(file) {
  const out = path.join(os.tmpdir(), `diluxone-mermaid-bench-${process.pid}.svg`);
  try {
    execFileSync(path.join(root, 'node_modules', '.bin', 'mmdc'), ['-i', file, '-o', out, '-q'], { stdio: 'pipe', timeout: 60000 });
    return 'ok';
  } catch {
    return 'error';
  }
}

const files = fs.readdirSync(corpus).filter((f) => f.endsWith('.mmd') && (!only || f.includes(only))).sort();
const renderer = await createRenderer();
const rows = [];
let failures = 0;

try {
  for (const f of files) {
    const file = path.join(corpus, f);
    const code = fs.readFileSync(file, 'utf8');
    const expect = code.match(/^%% expect: (\w+)/m)?.[1];
    const expectFix = code.match(/^%% after-fix: (\w+)/m)?.[1];
    const r = await evaluate(code, renderer, { fix: Boolean(expectFix) });
    const row = {
      name: f.replace(/\.mmd$/, ''),
      expect,
      result: r.statusBefore,
      okTool: r.statusBefore === expect,
      expectFix: expectFix ?? '',
      fix: expectFix ? r.status : '',
      okFix: expectFix ? r.status === expectFix : true,
      rules: [...new Set([...r.issues, ...r.fixed].map((i) => i.rule))].join(', '),
    };
    if (bench) {
      row.mmdc = mmdc(file);
      row.okMmdc = row.mmdc === expect || (expect === 'warn' && row.mmdc === 'ok');
    }
    if (!row.okTool || !row.okFix) {
      failures++;
      row.detail = [
        ...r.issues.map((i) => `      lint ${i.severity} [${i.rule}] ${i.msg}`),
        ...Object.entries(r.render).flatMap(([v, x]) => [
          ...(x.ok ? [] : [`      mermaid ${v}: ${x.stage}: ${(x.error ?? x.errors?.map((e) => e.msg).join(' | ') ?? '').slice(0, 160)}`]),
          ...(x.warnings ?? []).map((w) => `      mermaid ${v} [${w.rule}] ${w.msg}`),
        ]),
        ...(r.fixRejected ? [`      fix rejected: ${r.fixRejected}`] : []),
        ...(r.fixedCode ? [`      fixed code:\n${r.fixedCode.replace(/^/gm, '        ')}`] : []),
      ].join('\n');
    }
    rows.push(row);
    const mark = row.okTool && row.okFix ? '✓' : '✗';
    process.stdout.write(`${mark} ${row.name.padEnd(32)} expect ${expect.padEnd(5)} diluxone-mermaid ${row.result.padEnd(5)}${expectFix ? ` · after fix ${row.fix} (expect ${expectFix})` : ''}${bench ? ` · mmdc ${row.mmdc}` : ''}\n`);
    if (row.detail) process.stdout.write(row.detail + '\n');
  }
} finally {
  await renderer.close();
}

const total = rows.length;
const okS = rows.filter((r) => r.okTool).length;
const withFix = rows.filter((r) => r.expectFix);
const okF = withFix.filter((r) => r.okFix).length;
process.stdout.write(`\ndiluxone-mermaid: ${okS}/${total} correct diagnoses · fixes: ${okF}/${withFix.length}\n`);

if (bench) {
  const okM = rows.filter((r) => r.okMmdc).length;
  process.stdout.write(`plain mmdc: ${okM}/${total}\n`);
  const versions = renderer.versions.map((v) => v.version).join(' · ');
  const cli = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mermaid-js/mermaid-cli/package.json'))).version;
  const md = [
    '# Benchmark results',
    '',
    `Run on ${new Date().toISOString().slice(0, 10)} with mermaid ${versions} (diluxone-mermaid) and @mermaid-js/mermaid-cli ${cli} (mmdc). Reproduce with \`npm run bench\`.`,
    '',
    `- **diluxone-mermaid:** ${okS}/${total} correct diagnoses; with \`--fix\`, ${okF}/${withFix.length} cases end up as expected.`,
    `- **plain mmdc** (what the existing skills and MCP servers do): ${okM}/${total}.`,
    '',
    '| Case | Expected | diluxone-mermaid | mmdc | After --fix | Rules triggered |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.name} | ${r.expect} | ${r.okTool ? '✓' : '✗'} ${r.result} | ${r.okMmdc ? '✓' : '✗'} ${r.mmdc} | ${r.expectFix ? `${r.okFix ? '✓' : '✗'} ${r.fix}` : '—'} | ${r.rules || '—'} |`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'bench', 'RESULTS.md'), md);
  process.stdout.write('bench/RESULTS.md written.\n');
}
process.exit(failures ? 1 : 0);
