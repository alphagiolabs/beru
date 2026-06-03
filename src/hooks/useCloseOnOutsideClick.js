import { useEffect } from "react";

/**
 * Registers mousedown-outside and Escape-key listeners to close a popup.
 * @param {React.RefObject} ref - ref to the popup container element
 * @param {boolean} isOpen - whether the popup is currently open
 * @param {(next: boolean) => void} setIsOpen - setter to close the popup
 */
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
