const { build } = require("../package.json");

module.exports = () => {
  const certificate = process.env.CSC_LINK || process.env.WIN_CSC_LINK;
  const mode = process.env.BERU_SIGNING_MODE || (certificate ? "signed" : "unsigned");
  if (!["signed", "unsigned"].includes(mode)) throw new Error("Invalid BERU_SIGNING_MODE");
  if (mode === "signed" && !certificate) throw new Error("Signed builds require a certificate");
  if (mode === "unsigned" && certificate)
    throw new Error("Unsigned builds cannot use a certificate");
  const config = structuredClone(build);
  return {
    ...config,
    forceCodeSigning: mode === "signed",
    win: { ...config.win, verifyUpdateCodeSignature: mode === "signed" },
  };
};
