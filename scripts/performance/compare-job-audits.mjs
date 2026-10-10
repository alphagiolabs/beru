import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const [beforeDirectory, afterDirectory, outputFile] = process.argv.slice(2);
if (!beforeDirectory || !afterDirectory || !outputFile)
  throw new Error(
    "Usage: node scripts/performance/compare-job-audits.mjs before-dir after-dir new-result.json",
  );
const readReport = (directory) =>
  JSON.parse(fs.readFileSync(path.join(directory, "report.json"), "utf8"));
const before = readReport(beforeDirectory);
const after = readReport(afterDirectory);
if (before.failure || after.failure) throw new Error("Cannot compare failed audits");
const canCompareCommands =
  before.matrix?.processor !== "packaged" && after.matrix?.processor !== "packaged";
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const commands = (run) =>
  (run.commands || [])
    .filter((command) => path.basename(command.argv[0]).toLowerCase() === "ffmpeg.exe")
    .map((command) =>
      command.argv.map((arg) => {
        if (arg === run.job.output_path) return "<output>";
        const temporary = arg.match(/[\\/]beru-temporal-[^\\/]+[\\/](temporal-\d+\.mkv)$/);
        return temporary ? `<temporary>/${temporary[1]}` : arg;
      }),
    );
const comparisons = [];
for (const run of before.runs) {
  const counterpart = after.runs.find(
    (item) => item.name === run.name && item.repeat === run.repeat && item.variant === run.variant,
  );
  if (!counterpart) throw new Error(`Missing counterpart: ${run.name} #${run.repeat}`);
  const label = `${run.name}-${run.variant}-${run.repeat}`;
  const files = fs
    .readdirSync(beforeDirectory)
    .filter((file) => file.startsWith(`${label}-`) && file.endsWith(".framemd5"));
  if (!files.length) throw new Error(`Missing decoded fingerprints: ${label}`);
  const afterFiles = fs
    .readdirSync(afterDirectory)
    .filter((file) => file.startsWith(`${label}-`) && file.endsWith(".framemd5"));
  if (files.length !== afterFiles.length) throw new Error(`Stream count changed: ${label}`);
  const streams = files.map((file) => ({
    file,
    before: hash(path.join(beforeDirectory, file)),
    after: hash(path.join(afterDirectory, file)),
  }));
  const beforeCommands = commands(run);
  const afterCommands = commands(counterpart);
  const ffmpegCommandsExact =
    canCompareCommands && (beforeCommands.length || afterCommands.length)
      ? JSON.stringify(beforeCommands) === JSON.stringify(afterCommands)
      : null;
  comparisons.push({
    name: run.name,
    repeat: run.repeat,
    streams,
    allDecodedFramesAndAudioExact: streams.every((s) => s.before === s.after),
    ffmpegCommandsExact,
    comparedFfmpegCommands: canCompareCommands ? beforeCommands.length : 0,
  });
}
if (before.runs.length !== after.runs.length) throw new Error("Job counts differ");
const result = {
  beforeDirectory,
  afterDirectory,
  comparisons,
  exact: comparisons.every((item) => item.allDecodedFramesAndAudioExact),
  ffmpegCommandsExact: comparisons.some((item) => item.ffmpegCommandsExact !== null)
    ? comparisons.every((item) => item.ffmpegCommandsExact !== false)
    : null,
};
fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(
  `${comparisons.length} comparisons: ${result.exact ? "EXACT" : "DIFFERENT"}; ${outputFile}`,
);
if (!result.exact || result.ffmpegCommandsExact === false) process.exitCode = 1;
