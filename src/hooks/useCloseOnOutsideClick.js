import { useEffect } from "react";

export default function useCloseOnOutsideClick(ref, isOpen, setIsOpen) {
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, isOpen, setIsOpen]);
}
