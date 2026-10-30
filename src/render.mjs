// Layers 2 and 3 · real parser and render geometry.
// Starts a headless Chrome, loads every mermaid version pinned in package.json
// and, for each diagram: parses it, renders it to SVG and measures the result
// (text overflowing its box, overlapping nodes, size, undecoded entities,
// visible mojibake). Optionally takes a PNG.

import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);

export const DEFAULT_VERSIONS = ['10', '11', '12'];

export function versionInfo(major) {
  const pkg = require(`mermaid${major}/package.json`);
  return { major, version: pkg.version, script: require.resolve(`mermaid${major}/dist/mermaid.min.js`) };
}

// Aspect ratio only matters for big diagrams: a small LR one is wide and still readable.
const LIMITS = { maxSide: 3000, maxAspect: 6, aspectMinSide: 1600, overlapPx: 4 };

// First the Chrome that puppeteer downloads; if it is missing (for example with
// npx, which skips install scripts), the Chrome installed on the machine.
async function launch() {
  try {
    return await puppeteer.launch({ headless: true });
  } catch (first) {
    try {
      return await puppeteer.launch({ headless: true, channel: 'chrome' });
    } catch {
      throw new Error(`No Chrome found to render with. Install one with:\n  npx puppeteer browsers install chrome-headless-shell\n(${first.message.split('\n')[0]})`);
    }
  }
}

export async function createRenderer(majors = DEFAULT_VERSIONS) {
  const browser = await launch();
  const pages = new Map();
  for (const major of majors) {
    const info = versionInfo(major);
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });
    await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff"><div id="host" style="display:inline-block;padding:16px"></div></body>');
    await page.addScriptTag({ path: info.script });
    await page.evaluate(() => {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
    });
    pages.set(major, { page, info });
  }

  let counter = 0;

  async function check(code, { png } = {}) {
    const results = {};
    for (const [major, { page, info }] of pages) {
      const id = `mc${counter++}`;
      const r = await Promise.race([
        page.evaluate(inPage, code, id, LIMITS),
        new Promise((res) => setTimeout(() => res({ stage: 'timeout', error: 'Rendering took more than 20 s.' }), 20000)),
      ]);
      r.version = info.version;
      if (png && r.ok && major === [...pages.keys()].at(-1)) {
        const el = await page.$('#host');
        await el.screenshot({ path: png });
        r.png = png;
      }
      results[major] = r;
    }
    return results;
  }

  return { check, close: () => browser.close(), versions: [...pages.values()].map((p) => p.info) };
}

// Runs inside the browser.
async function inPage(code, id, limits) {
  const host = document.getElementById('host');
  host.innerHTML = '';
  const cleanup = () => document.querySelectorAll(`#d${id}, #${id}, #i${id}`).forEach((n) => n !== host && n.remove());
  try {
    await window.mermaid.parse(code);
  } catch (e) {
    cleanup();
    return { ok: false, stage: 'parse', error: String(e?.message ?? e).slice(0, 1200) };
  }
  let svgText;
  try {
    ({ svg: svgText } = await window.mermaid.render(id, code));
  } catch (e) {
    cleanup();
    return { ok: false, stage: 'render', error: String(e?.message ?? e).slice(0, 1200) };
  }
  cleanup();
  host.innerHTML = svgText;
  const svg = host.querySelector('svg');
  const warnings = [];
  const errors = [];

  if (/Syntax error in (text|graph)/i.test(svg.textContent)) {
    return { ok: false, stage: 'render', error: 'Mermaid rendered its error diagram.' };
  }

  // Real drawing size: the viewBox. The on-screen size depends on the container.
  const vb = svg.viewBox?.baseVal;
  const box = svg.getBBox();
  const width = Math.round(vb && vb.width ? vb.width : box.width);
  const height = Math.round(vb && vb.height ? vb.height : box.height);
  if (width > limits.maxSide || height > limits.maxSide) {
    warnings.push({ rule: 'size', msg: `The diagram is ${width}×${height} px: embedded in a doc or a deck it will be unreadable.` });
  }
  const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height));
  if (aspect > limits.maxAspect && Math.max(width, height) > limits.aspectMinSide) {
    warnings.push({ rule: 'aspect-ratio', msg: `Aspect ratio ${aspect.toFixed(1)}:1: too narrow or too long; try switching direction (LR ↔ TD).` });
  }

  // What is visible
  const texts = [...svg.querySelectorAll('foreignObject, text')]
    .filter((n) => !n.closest('foreignObject') || n.tagName.toLowerCase() === 'foreignobject')
    .map((n) => n.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const t of texts) {
    if (/&(amp|lt|gt|quot|#\d+);|#quot;|#\d+;/.test(t)) {
      warnings.push({ rule: 'visible-entity', msg: `An undecoded entity is visible: "${t.slice(0, 60)}".` });
    }
    if (/Ã[\u0080-¿]|â€/.test(t)) {
      errors.push({ rule: 'mojibake-visible', msg: `Text with broken encoding is visible: "${t.slice(0, 60)}".` });
    }
  }

  // Clipped text: the label's HTML content is bigger than its box.
  for (const fo of svg.querySelectorAll('foreignObject')) {
    const inner = fo.firstElementChild;
    if (!inner) continue;
    const w = fo.width.baseVal.value;
    const h = fo.height.baseVal.value;
    const t = fo.textContent.trim();
    if (!t) continue;
    if (inner.scrollWidth > w + 2 || inner.scrollHeight > h + 2) {
      warnings.push({ rule: 'clipped-text', msg: `The text "${t.slice(0, 50)}" does not fit its box (${Math.round(inner.scrollWidth)}×${Math.round(inner.scrollHeight)} in ${Math.round(w)}×${Math.round(h)}).` });
    }
  }

  // Overlapping nodes
  const nodes = [...svg.querySelectorAll('g.node, g.actor, rect.actor')]
    .map((n) => ({ label: n.textContent.replace(/\s+/g, ' ').trim(), r: n.getBoundingClientRect() }))
    .filter((n) => n.r.width > 0 && n.r.height > 0);
  for (let a = 0; a < nodes.length; a++) {
    for (let b = a + 1; b < nodes.length; b++) {
      const A = nodes[a].r;
      const B = nodes[b].r;
      const ix = Math.min(A.right, B.right) - Math.max(A.left, B.left);
      const iy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      if (ix > limits.overlapPx && iy > limits.overlapPx) {
        const inside = (P, Q) => P.left >= Q.left && P.right <= Q.right && P.top >= Q.top && P.bottom <= Q.bottom;
        if (inside(A, B) || inside(B, A)) continue;
        warnings.push({ rule: 'overlapping-nodes', msg: `"${nodes[a].label.slice(0, 30)}" and "${nodes[b].label.slice(0, 30)}" overlap.` });
      }
    }
  }

  const edgeLabels = [...svg.querySelectorAll('g.edgeLabel')].map((n) => n.textContent.trim()).filter(Boolean);
  const messages = [...svg.querySelectorAll('text.messageText')].map((n) => n.textContent.trim());
  return {
    ok: errors.length === 0,
    stage: errors.length ? 'geometry' : 'ok',
    width,
    height,
    nodes: nodes.map((n) => n.label).filter(Boolean),
    edgeLabels,
    messages,
    warnings,
    errors,
  };
}
