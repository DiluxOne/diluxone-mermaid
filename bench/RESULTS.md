# Benchmark results

Run on 2026-10-30 with mermaid 10.9.8 · 11.17.2 · 12.2.0 (diluxone-mermaid) and @mermaid-js/mermaid-cli 12.0.0 (mmdc). Reproduce with `npm run bench`.

- **diluxone-mermaid:** 37/37 correct diagnoses; with `--fix`, 17/17 cases end up as expected.
- **plain mmdc** (what the existing skills and MCP servers do): 34/37.

| Case | Expected | diluxone-mermaid | mmdc | After --fix | Rules triggered |
| --- | --- | --- | --- | --- | --- |
| 01-simple-flowchart | ok | ✓ ok | ✓ ok | — | — |
| 02-quoted-accents | ok | ✓ ok | ✓ ok | — | — |
| 03-sequence-accents | ok | ✓ ok | ✓ ok | — | — |
| 04-br-and-bold | ok | ✓ ok | ✓ ok | — | — |
| 05-nested-subgraph | ok | ✓ ok | ✓ ok | — | — |
| 06-class | ok | ✓ ok | ✓ ok | — | — |
| 07-composite-state | ok | ✓ ok | ✓ ok | — | — |
| 08-er | ok | ✓ ok | ✓ ok | — | — |
| 09-gantt | ok | ✓ ok | ✓ ok | — | — |
| 10-pie-accents | ok | ✓ ok | ✓ ok | — | — |
| 11-valid-init | ok | ✓ ok | ✓ ok | — | — |
| 12-edge-text | ok | ✓ ok | ✓ ok | — | — |
| 13-markdown-string | ok | ✓ ok | ✓ ok | — | — |
| 14-mindmap | ok | ✓ ok | ✓ ok | — | — |
| 15-long-ids | ok | ✓ ok | ✓ ok | — | — |
| 20-unquoted-parentheses | error | ✓ error | ✓ error | ✓ ok | unquoted-label |
| 21-end-as-id | error | ✓ error | ✓ error | ✓ ok | end-as-id |
| 22-semicolon-in-message | error | ✓ error | ✓ error | ✓ ok | semicolon |
| 23-subgraph-without-end | error | ✓ error | ✓ error | ✓ error | balance |
| 24-nested-quotes | error | ✓ error | ✗ ok | ✓ ok | nested-quotes |
| 25-wrong-case-type | error | ✓ error | ✓ error | ✓ ok | diagram-type |
| 26-smart-quotes | error | ✓ error | ✓ error | ✓ ok | smart-quotes |
| 27-inline-comment | error | ✓ error | ✓ error | ✓ ok | inline-comment |
| 28-braces-in-brackets | error | ✓ error | ✓ error | ✓ ok | unquoted-label |
| 29-pipe-in-label | error | ✓ error | ✓ error | ✓ ok | unquoted-label |
| 30-alt-without-end | error | ✓ error | ✓ error | ✓ error | balance |
| 31-edge-text-parentheses | warn | ✓ warn | ✓ ok | ✓ ok | unquoted-label |
| 40-mojibake | error | ✓ error | ✗ ok | ✓ ok | mojibake |
| 41-broken-init-json | error | ✓ error | ✗ ok | — | init |
| 42-non-breaking-space | warn | ✓ warn | ✓ ok | ✓ ok | invisible |
| 43-zero-width-in-id | error | ✓ error | ✓ error | ✓ ok | invisible |
| 44-glued-o-arrow | warn | ✓ warn | ✓ ok | — | o-x-arrow |
| 45-long-label | warn | ✓ warn | ✓ ok | — | long-label |
| 46-disallowed-html | warn | ✓ warn | ✓ ok | — | html |
| 47-huge-diagram | warn | ✓ warn | ✓ ok | — | — |
| 48-unquoted-accent | warn | ✓ warn | ✓ ok | ✓ ok | unquoted-label |
| 49-accented-id | warn | ✓ warn | ✓ ok | ✓ ok | non-ascii-id |
