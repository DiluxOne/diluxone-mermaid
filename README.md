# DiluxOne Mermaid

**Create, edit and validate mermaid diagrams that never break.** Not because of accents, odd characters, structure, or the mermaid version used wherever you paste them.

DiluxOne Mermaid is two things:

- **A Claude skill** (`diluxone-mermaid`) that Claude uses whenever it creates, edits or validates a mermaid diagram, and that you can also run directly with `/diluxone-mermaid <file>`.
- **A CLI** that validates diagrams in `.md` or `.mmd` files, fixes them when the fix is mechanical, and renders a PNG so you can look at them. The skill uses it under the hood.

## Installation

DiluxOne Mermaid is listed in the organisation's catalog, [`diluxone-plugins-ai`](https://github.com/DiluxOne/diluxone-plugins-ai), and installs from this repository in every tool below. Every tool needs Node 20 or newer (`node -v`). The first run downloads mermaid and a headless Chrome (about 150 MB); after that it takes a few seconds.

### Claude Code (recommended)

Run these two commands inside Claude Code:

```
/plugin marketplace add DiluxOne/diluxone-plugins-ai
/plugin install diluxone-mermaid@diluxone-plugins-ai
```

**If you added the old catalog** (`diluxone/diluxone-plugins`, marketplace `diluxone`), remove it first, then add the new one and install again:

```
/plugin marketplace remove diluxone
/plugin marketplace add DiluxOne/diluxone-plugins-ai
/plugin install diluxone-mermaid@diluxone-plugins-ai
```

### Codex

```bash
codex plugin marketplace add DiluxOne/diluxone-plugins-ai
```

Then install `diluxone-mermaid` from the `diluxone-plugins-ai` marketplace.

### GitHub Copilot CLI

```bash
copilot plugin marketplace add DiluxOne/diluxone-plugins-ai
copilot plugin install diluxone-mermaid@diluxone-plugins-ai
```

### Cursor

Clone this repository into Cursor's local plugins folder, then restart Cursor:

```bash
git clone https://github.com/DiluxOne/diluxone-mermaid ~/.cursor/plugins/local/diluxone-mermaid
```

### Gemini CLI

```bash
gemini extensions install https://github.com/DiluxOne/diluxone-mermaid
```

### OpenCode

OpenCode has no plugin manifest to install from: copy the skill into its skills folder, for every project (`~/.config/opencode/skills/`) or for one (`.opencode/skills/` in the project):

```bash
git clone https://github.com/DiluxOne/diluxone-mermaid /tmp/diluxone-mermaid
mkdir -p ~/.config/opencode/skills
cp -r /tmp/diluxone-mermaid/skills/diluxone-mermaid ~/.config/opencode/skills/
```

### Claude on the web or Claude Desktop

1. Download [`diluxone-mermaid-skill.zip`](https://github.com/diluxone/diluxone-mermaid/releases/latest/download/diluxone-mermaid-skill.zip).
2. In Claude, go to *Settings* → *Capabilities* and enable code execution.
3. Under *Skills*, upload the `.zip`.

The skill then runs in Claude's code environment, which needs to be able to download this repo's engine and a Chrome build. If your organization restricts that environment's network, it may not work.

### CLI only

```bash
npx github:diluxone/diluxone-mermaid README.md
npx github:diluxone/diluxone-mermaid docs/*.md --fix --png /tmp/diagrams
cat diagram.mmd | npx github:diluxone/diluxone-mermaid -
```

## Usage

**In Claude**, there is nothing to remember: when you ask for a diagram ("draw the payment flow", "add a sequence diagram to the README") or ask to fix or validate one, Claude loads the skill on its own. To run it explicitly:

```
/diluxone-mermaid docs/architecture.md
```

To make it a rule in a repo, add a line like this to its `CLAUDE.md`: *Every mermaid diagram is created and validated with the diluxone-mermaid skill.*

What the skill does:

1. **Create or edit:** it writes down what the diagram has to show and writes it in a safe form (ASCII IDs, quoted labels, escapes for `"`, `#` and `;`).
2. **Validate:** it runs the CLI with `--fix`, which lints, parses in three mermaid versions, measures the render and takes a PNG.
3. **Review:** it compares the visible text with what was asked for and scores the PNG for readability. If something is off, it reworks the diagram and validates again.

**CLI options:**

| Option | What it does |
| --- | --- |
| `--fix` | apply the safe fixes and rewrite the file |
| `--png <dir>` | save one PNG per diagram |
| `--versions 10,12` | choose which mermaid versions to parse against |
| `--json` | machine-readable output (what the skill uses) |
| `--strict` | warnings also fail |

It exits with code 1 if any error remains, so it also works in CI.

## Why `mmdc` is not enough

The mermaid skills and MCP servers available today all do the same thing: pass the diagram to `mmdc` (the official renderer) and check whether it errors. That misses three things:

1. **What parses but renders wrong.** `A["says "hi""]` parses and shows `says hi`. In mermaid 10, `A->>B: C# and more` parses and shows an empty message. A broken JSON in `%%{init}%%` is silently ignored.
2. **Other versions.** GitHub, Confluence, Notion and editors do not all run the same mermaid version. What passes in 12 can break in 10.
3. **Readability.** Text that does not fit its box, overlapping nodes, a 4000 px diagram that is unreadable once embedded in a doc.

## How it validates: four layers

| Layer | Kind | What it does |
| --- | --- | --- |
| 1 · Lint | Deterministic | Checks the text before parsing: invisible characters (non-breaking, zero-width), broken encoding (`Ã¡` instead of `á`), smart quotes, unquoted labels with symbols, quotes inside quotes, `#` and `;` that swallow text, `end` as an ID, IDs with accents, unbalanced `subgraph`/`end`, `%%` at the end of a line, `%%{init}%%` JSON. |
| 2 · Real parser | Deterministic | Parses and renders with **mermaid 10.9.8, 11.17.2 and 12.2.0** inside a headless Chrome. |
| 3 · Geometry | Deterministic | Measures the rendered SVG: clipped text, overlapping nodes, size and aspect ratio, visible entities or broken encoding. Returns the text that is actually visible. |
| 4 · Review | Probabilistic | Done by Claude, following the skill: compares the visible text with what was asked for and scores the PNG against a fixed rubric (readability, crossings, direction, grouping, size). |

With `--fix`, DiluxOne Mermaid fixes what is mechanical (quotes, escapes, invisible characters, encoding, IDs) and **only accepts the fix if the result does not break any version that worked before**.

## How it was tested

Two tests, both in the repo and reproducible.

**Corpus** (`npm run bench`): 37 hand-written cases: valid ones (to measure false positives), broken ones the parser catches, and silently broken ones. DiluxOne Mermaid gets 37 out of 37 right and fixes 17 out of 17. Details in [`bench/RESULTS.md`](https://github.com/diluxone/diluxone-mermaid/blob/main/bench/RESULTS.md).

**Fuzzing** (`npm run fuzz`): 200 randomly generated diagrams with poisonous labels (accents, ñ, quotes, `;`, `|`, `#`, `<`, emoji, non-breaking spaces), written unquoted, the way someone in a hurry writes them. They are checked against the real render of all three versions, not against our own expectations:

| Seed 2027 · 200 diagrams | Result |
| --- | --- |
| Actually broken (does not parse, or does not show the written text) | 121 |
| Caught by plain `mmdc` | 98 (81%) |
| **Caught by DiluxOne Mermaid** | **121 (100%)** |
| False negatives: said ok and it was broken | **0** |
| False positives: said error and it was fine | 18 |
| Faithful in all three versions after `--fix` | 198 (99%) |

The false positives are deliberate: DiluxOne Mermaid asks for quotes on labels that, in those versions, still worked without them. Adding them never breaks anything.

## Limits

- Geometry is measured with the headless Chrome's fonts; in another destination, text may measure differently.
- The lint knows flowchart and sequence diagrams in depth; for other types (class, state, er, gantt, mindmap...) layers 2 and 3 and the general checks apply.
- It does not know which mermaid version each destination runs. That is why it tests all three and lets you pick with `--versions`.
- If `npx` blocks the script that downloads Chrome, it uses the Chrome installed on your machine. If there is none, it tells you how to install one.

## Development

```bash
git clone https://github.com/diluxone/diluxone-mermaid.git
cd diluxone-mermaid
npm install
npm test          # corpus
npm run fuzz      # 200 random diagrams
npm run bench     # corpus vs. mmdc, writes bench/RESULTS.md
```

[MIT license](https://github.com/diluxone/diluxone-mermaid/blob/main/LICENSE).
