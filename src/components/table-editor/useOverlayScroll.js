import { useCallback, useRef } from "react";

export default function useOverlayScroll() {
  const nodeRef = useRef(null);
  const timerRef = useRef(null);

  const onScroll = useCallback((e) => {
    const el = e.currentTarget;
    el.classList.add("is-scrolling");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      el.classList.remove("is-scrolling");
      timerRef.current = null;
    }, 700);
  }, []);

  return useCallback(
    (node) => {
      if (nodeRef.current) {
        nodeRef.current.removeEventListener("scroll", onScroll);
        if (timerRef.current) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
          nodeRef.current.classList.remove("is-scrolling");
        }
      }
      nodeRef.current = node;
      if (node) {
        node.addEventListener("scroll", onScroll, { passive: true });
      }
    },
    [onScroll],
  );
}
