import fs from "node:fs";
import path from "node:path";
import {
  RUN_ROOT,
  connectMain,
  connectPage,
  killTree,
  launchElectron,
  sleep,
  startPreview,
  startVite,
  waitUntil,
} from "./harness.mjs";

const VITE_PORT = Number(process.env.BERU_E2E_VITE_PORT || 5199);
const RENDERER_PORT = Number(process.env.BERU_E2E_CDP_PORT || 9333);
const INSPECT_PORT = Number(process.env.BERU_E2E_INSPECT_PORT || 5858);

export async function startSession(name, { language = "es", keepProfile = false } = {}) {
  const profileDir = path.join(RUN_ROOT, name, "profile");
  if (!keepProfile) fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "settings.json"), JSON.stringify({ language }));
  const exe = process.env.BERU_E2E_APP || null;
  const devUrl = exe ? null : `http://localhost:${VITE_PORT}`;
  const vite = exe
    ? null
    : process.env.BERU_E2E_RENDERER === "prod"
      ? startPreview(VITE_PORT)
      : startVite(VITE_PORT);
  let electron = null;
  let page = null;
  let main = null;
  try {
    if (vite)
      await waitUntil(async () => (await fetch(devUrl)).ok, {
        timeout: 120000,
        label: "Vite dev server",
      });
    for (let attempt = 1; ; attempt += 1) {
      electron = launchElectron({
        devUrl,
        exe,
        rendererPort: RENDERER_PORT,
        inspectPort: INSPECT_PORT,
        profileDir,
      });
      try {
        page = await connectPage(RENDERER_PORT, devUrl);
        main = await connectMain(INSPECT_PORT);
        break;
      } catch (error) {
        page?.close();
        main?.close();
        page = null;
        main = null;
        await killTree(electron);
        if (attempt === 2) throw error;
        console.log(
          `RETRY  ${name} — el depurador no respondió (${error.message}); se arranca de nuevo`,
        );
      }
    }
    await main.installDialogStubs();
    await waitUntil(() => page.evaluate("document.readyState === 'complete'"), {
      timeout: 120000,
      label: "page load",
    });
  } catch (error) {
    page?.close();
    main?.close();
    await killTree(electron);
    if (vite) await killTree(vite);
    throw error;
  }
  return {
    page,
    main,
    electron,
    async stop() {
      page.close();
      main.close();
      await killTree(electron);
      if (vite) await killTree(vite);
      await sleep(500);
    },
  };
}

export async function openEditorSpace(page, labels) {
  await waitUntil(
    () =>
      page.evaluate(
        `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === ${JSON.stringify(labels.railLabel)} || b.getAttribute("aria-label") === ${JSON.stringify(labels.railLabel)})`,
      ),
    {
      timeout: 120000,
      label: "rail item",
    },
  );
  await page.evaluate(`(() => {
    const target = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") === ${JSON.stringify(labels.railLabel)} || b.textContent.trim() === ${JSON.stringify(labels.railLabel)}));
    target?.click();
    return Boolean(target);
  })()`);
  await page.waitForButton(labels.import, { timeout: 60000 });
}
