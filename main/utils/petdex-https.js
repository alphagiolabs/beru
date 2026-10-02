import { request as httpsRequest } from "https";
import { assertPetdexBodySize, assertPetdexUrl, PETDEX_REFERER } from "./petdex-core.js";

export function fetchPetBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("Demasiadas redirecciones"));
      return;
    }

    let parsed;
    try {
      parsed = assertPetdexUrl(url);
    } catch (error) {
      reject(error);
      return;
    }

    const req = httpsRequest(
      parsed,
      {
        headers: {
          Referer: PETDEX_REFERER,
          "User-Agent": "Beru/1.0",
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let next;
          try {
            next = new URL(res.headers.location, parsed).toString();
            assertPetdexUrl(next);
          } catch (error) {
            res.resume();
            reject(error);
            return;
          }
          res.resume();
          fetchPetBuffer(next, redirects + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const chunks = [];
        let total = 0;
        let settled = false;
        const fail = (error) => {
          if (settled) return;
          settled = true;
          res.destroy();
          reject(error);
        };

        res.on("data", (chunk) => {
          total += chunk.length;
          try {
            assertPetdexBodySize(total);
          } catch (error) {
            fail(error);
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks));
        });
        res.on("error", fail);
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("Timeout de red")));
    req.end();
  });
}
