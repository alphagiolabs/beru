/**
 * jsdom stubs for APIs used by production UI (@tanstack/react-virtual, etc.).
 * Loaded once via vitest.config.js setupFiles.
 * Always replace ResizeObserver — jsdom's partial implementation lacks unobserve.
 */

class ResizeObserverStub {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub;
if (typeof window !== "undefined") {
  window.ResizeObserver = ResizeObserverStub;
}

if (typeof Element !== "undefined") {
  if (typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = function scrollTo() {};
  }
  if (typeof Element.prototype.getBoundingClientRect !== "function") {
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        toJSON() {
          return {};
        },
      };
    };
  }
}
