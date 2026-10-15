import fs from "node:fs";
import path from "node:path";
import { RUN_ROOT } from "./harness.mjs";

export function createReport(scenario) {
  const checks = [];
  const metrics = [];
  const dir = path.join(RUN_ROOT, scenario);
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    check(name, passed, detail = "") {
      checks.push({ name, passed: Boolean(passed), detail: String(detail) });
      console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
      return Boolean(passed);
    },
    metric(name, value, unit = "") {
      metrics.push({ name, value, unit });
      console.log(
        `METRIC ${name} = ${typeof value === "number" ? Number(value.toFixed(2)) : value}${unit ? ` ${unit}` : ""}`,
      );
      return value;
    },
    async step(name, fn) {
      try {
        return await fn();
      } catch (error) {
        checks.push({ name, passed: false, detail: error.message });
        console.log(`FAIL  ${name} — ${error.message}`);
        return undefined;
      }
    },
    finish() {
      const failed = checks.filter((c) => !c.passed).length;
      const summary = { scenario, passed: checks.length - failed, failed, checks, metrics };
      fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(summary, null, 2));
      console.log(`\n${scenario}: ${summary.passed} passed, ${failed} failed`);
      return summary;
    },
  };
}
