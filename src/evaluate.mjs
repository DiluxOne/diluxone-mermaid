// Evaluates a diagram with the three layers and, if asked, tries to fix it.
// A fix is accepted only if it does not break any version that worked before
// and does not leave more lint errors than before. Used by the CLI and tests.

import { lint } from './lint.mjs';

function failedVersions(render) {
  return Object.entries(render).filter(([, r]) => !r.ok).map(([v]) => v);
}

export function statusOf(issues, render) {
  const errs = issues.some((i) => i.severity === 'error') || Object.values(render).some((r) => !r.ok);
  const warns = issues.some((i) => i.severity === 'warn') || Object.values(render).some((r) => r.warnings?.length);
  return errs ? 'error' : warns ? 'warn' : 'ok';
}

export async function evaluate(code, renderer, { fix = false, png } = {}) {
  const l = lint(code, { fix });
  let render = await renderer.check(code, { png });
  const result = {
    type: l.type,
    issues: l.issues,
    render,
    fixed: [],
    fixRejected: null,
    fixedCode: null,
    statusBefore: statusOf(l.issues, render),
  };

  if (fix && l.changed) {
    const after = await renderer.check(l.fixed, { png });
    const before = failedVersions(render);
    const regressions = failedVersions(after).filter((v) => !before.includes(v));
    const relint = lint(l.fixed);
    const errorsBefore = l.issues.filter((i) => i.severity === 'error').length;
    const errorsAfter = relint.issues.filter((i) => i.severity === 'error').length;
    if (regressions.length === 0 && errorsAfter <= errorsBefore) {
      result.fixed = l.issues.filter((i) => i.fixable);
      result.issues = relint.issues;
      result.render = after;
      result.fixedCode = l.fixed;
    } else {
      result.fixRejected = regressions.length
        ? `the fix broke mermaid ${regressions.map((v) => after[v].version).join(', ')}`
        : 'the fix did not reduce the lint errors';
    }
  }
  result.status = statusOf(result.issues, result.render);
  return result;
}
