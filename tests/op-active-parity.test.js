import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import contract from "../resources/op-active-fixtures.json" with { type: "json" };
import { isOpActive } from "../src/utils/operation.js";
import { describeIfPython } from "./helpers/python.js";

const PY = "python";
const PY_CODE_PREFIX = "import sys; sys.path.insert(0, 'python'); ";

const toRendererOp = (c) => {
  const op = {};
  if ("start" in c) op.startTime = c.start;
  if ("end" in c) op.endTime = c.end;
  return op;
};

function clauseActiveAt(row, t) {
  if (row.disabled) return false;
  if (!row.clause) return true;
  const m = /^enable=(between|gte|lte)\(t\\,(.+)\)$/.exec(row.clause);
  expect(m, `unparseable clause: ${row.clause}`).toBeTruthy();
  const bounds = m[2].split("\\,").map(Number);
  if (m[1] === "between") return bounds[0] <= t && t <= bounds[1];
  if (m[1] === "gte") return t >= bounds[0];
  return t <= bounds[0];
}

describe("op active contract (JSON)", () => {
  it("is versioned and non-empty", () => {
    expect(contract.version).toBe(1);
    expect(contract.active_cases.length).toBeGreaterThan(0);
  });
});

describe("op active contract (JS)", () => {
  it.each(contract.active_cases.map((c) => [c.id, c]))("case %s", (_id, c) => {
    expect(isOpActive(toRendererOp(c), c.t)).toBe(c.expected);
  });
});

describeIfPython("op active contract (Python parity)", () => {
  it("emitted enable clauses evaluate to the same truth table", () => {
    const code = `
import json
from op_shared import _build_enable_clause, _is_op_time_disabled

with open("resources/op-active-fixtures.json", encoding="utf-8") as f:
    contract = json.load(f)

out = []
for c in contract["active_cases"]:
    op = {}
    if "start" in c:
        op["start_time"] = c["start"]
    if "end" in c:
        op["end_time"] = c["end"]
    out.append({
        "id": c["id"],
        "disabled": _is_op_time_disabled(op),
        "clause": _build_enable_clause(op),
    })
print(json.dumps(out))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    const rows = JSON.parse(r.stdout.trim());

    for (const c of contract.active_cases) {
      const row = rows.find((x) => x.id === c.id);
      expect(row, c.id).toBeTruthy();
      expect(clauseActiveAt(row, c.t), c.id).toBe(c.expected);
    }
  });
});
