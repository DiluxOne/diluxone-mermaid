---
name: diluxone-mermaid
description: Create, edit and validate mermaid diagrams so they never break, whether because of accents, special characters, structure or the mermaid version. Use it whenever you create a new mermaid diagram, edit an existing one, or are asked to validate, check or fix mermaid diagrams (flowchart, sequence, class, state, er, gantt, mindmap, etc.), in .md or .mmd files. Can also be run directly with /diluxone-mermaid <file>.
---

# DiluxOne Mermaid

Create, edit and validate mermaid diagrams that never break.

A mermaid diagram can break in three ways: it does not parse, it parses in one version but not in another, or it parses but shows something else (swallowed text, a visible entity, an unreadable layout). DiluxOne Mermaid checks all three. Layers 1 to 3 are deterministic and run in the CLI; layer 4 is your judgment on the result.

## When to use it

- **Creating** a diagram: follow every step below.
- **Editing** a diagram: follow every step below; validate the whole file, not only the block you touched.
- **Validating** existing diagrams (asked directly, or run as `/diluxone-mermaid <file>`): skip to *Validate*, then *Review the result*.

If invoked without a file, validate every `.md` and `.mmd` file with mermaid blocks that changed in the current task; if there are none, ask which file to check.

## Before writing (create and edit)

Write down in one line what the diagram has to show: the nodes (or participants and messages) and the edges with their text. That is the intent you will compare against at the end.

Write it in the safe form from the start:

- Short ASCII IDs (`payment`, `core_api`); accents go in the label.
- Quote every label: `payment["Payment (QR)"]`, `A -->|"yes, with QR"| B`.
- Inside a label: write `"` as `#quot;`, `#` as `#35;`, and `;` in sequence messages as `#59;`.
- Line breaks with `<br/>`, and no label longer than ~40 characters in one line.
- No node named `end`; `%%` comments go on their own line.

## Validate

```bash
npx -y github:diluxone/diluxone-mermaid#v0.1.0 <file.md|file.mmd> --fix --png <temp-dir> --json
```

Use a temporary folder (the scratchpad, if there is one) for the PNGs, not the project folder. For a standalone diagram, pipe it through stdin with `-` instead of the file.

The JSON has, per diagram:

- `status`: `ok`, `warn` or `error`.
- `fixed`: what `--fix` corrected in the file. It is only applied if the result parses in every version that worked before.
- `lint`: what remains, with its rule, line and reason.
- `render.<version>`: whether it parses in that mermaid version, `nodes`, `edgeLabels` and `messages` (the text that is actually visible), geometry `warnings` (clipped text, overlapping nodes, unreadable size or aspect ratio) and the `png` path.

If an `error` remains, fix it yourself and run again. If it still fails on the third round, simplify the diagram instead of escaping more.

## Review the result

The checks above guarantee it parses and that no text was lost. Whether the diagram is useful is your call:

1. **Fidelity.** Compare `nodes`, `edgeLabels` and `messages` with the intent you wrote down. Everything asked for must be there, with no invented nodes and no changed text. (When only validating, check that the visible text matches the source.)
2. **Readability.** Open the PNG and score from 1 to 5:
   - readable at the size it will be shown;
   - edges crossing for no reason;
   - direction follows the flow (LR for processes, TD for hierarchies);
   - related nodes grouped (`subgraph`);
   - more than ~15 nodes: should it be split into two diagrams?
3. If anything scores 3 or less, restructure the diagram (direction, grouping, splitting) and validate again. When only validating, report it instead of restructuring, unless asked to fix.

## What to report

One line per diagram: whether it is ok, what `--fix` changed, which mermaid versions it was tested against, and the PNG path if it helps to show it. If a warning was left on purpose, say why.
