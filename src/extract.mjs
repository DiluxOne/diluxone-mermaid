// Extracts the mermaid blocks from a markdown file (``` or ~~~, and Azure
// DevOps' ::: mermaid) or returns the whole file if it is .mmd. Each block keeps
// where it starts, to report the real line and to rewrite it in place with --fix.

export function extractBlocks(text, filename = '') {
  if (/\.(mmd|mermaid)$/i.test(filename)) {
    return [{ index: 0, code: text, startLine: 1, range: [0, text.length] }];
  }
  const blocks = [];
  const fence = /^([ \t]*)(`{3,}|~{3,}|:::)[ \t]*mermaid[^\n]*\n([\s\S]*?)^\1(\2|:::)[ \t]*$/gm;
  let m;
  while ((m = fence.exec(text)) !== null) {
    const bodyStart = m.index + m[0].indexOf('\n') + 1;
    const body = m[3];
    const startLine = text.slice(0, bodyStart).split('\n').length;
    blocks.push({
      index: blocks.length,
      code: body.replace(/\n$/, ''),
      startLine,
      range: [bodyStart, bodyStart + body.replace(/\n$/, '').length],
    });
  }
  return blocks;
}

// Replaces the content of the fixed blocks, back to front so the offsets stay valid.
export function replaceBlocks(text, fixes) {
  let out = text;
  for (const { range, code } of [...fixes].sort((a, b) => b.range[0] - a.range[0])) {
    out = out.slice(0, range[0]) + code + out.slice(range[1]);
  }
  return out;
}
