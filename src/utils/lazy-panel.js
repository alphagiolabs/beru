import { lazy } from "react";

export function lazyPanel(importPanel) {
  let pending;
  let loaded;
  const load = () => {
    pending ??= importPanel()
      .then((module) => (loaded = module))
      .catch((error) => {
        pending = undefined;
        throw error;
      });
    return pending;
  };
  const Panel = lazy(() => ({
    then(resolve, reject) {
      if (loaded) resolve(loaded);
      else load().then(resolve, reject);
    },
  }));
  Panel.preload = () => load().catch(() => {});
  return Panel;
}
