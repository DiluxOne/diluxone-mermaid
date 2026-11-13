import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SCRIPT = """
import { lint } from './src/lint.mjs';
let src = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) src += chunk;
process.stdout.write(JSON.stringify(lint(src, { fix: true })));
"""


def fixed_lines(diagram):
    run = subprocess.run(
        ["node", "--input-type=module", "-e", SCRIPT],
        input=diagram, capture_output=True, text=True, cwd=ROOT, timeout=60,
    )
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)["fixed"].split("\n")


def test_fix_keeps_end_and_existing_End_as_two_distinct_nodes():
    lines = fixed_lines("flowchart TD\n  A --> end\n  End --> C\n")
    target_of_a = lines[1].split("-->")[1].strip()
    source_of_c = lines[2].split("-->")[0].strip()
    assert target_of_a != source_of_c, f"nodes merged: {lines}"


def test_fix_does_not_turn_accented_id_into_self_loop_on_existing_acao():
    lines = fixed_lines("flowchart TD\n  ação --> acao\n")
    source, target = (s.strip() for s in lines[1].split("-->"))
    assert source != target, f"self-loop created: {lines}"
