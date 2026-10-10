import { describe, it } from "vitest";
import fs from "fs";
import path from "path";
import { extractHiddenImports, extractLocalImports } from "./helpers/python-imports.js";

const specPath = path.join(process.cwd(), "python", "beru-processor.spec");
const processorPath = path.join(process.cwd(), "python", "processor.py");

describe("beru-processor.spec hiddenimports covers processor.py local imports", () => {
  const specSrc = fs.readFileSync(specPath, "utf-8");
  const pySrc = fs.readFileSync(processorPath, "utf-8");

  const hidden = extractHiddenImports(specSrc);
  const localImports = extractLocalImports(pySrc);

  it("every local import in processor.py is in hiddenimports", () => {
    const missing = localImports.filter((mod) => !hidden.includes(mod));
    if (missing.length > 0) {
      throw new Error(
        `processor.py imports ${missing.join(", ")} but beru-processor.spec hiddenimports is missing: ` +
          missing.join(", "),
      );
    }
  });
});
