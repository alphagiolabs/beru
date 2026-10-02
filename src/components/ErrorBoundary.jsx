import React from "react";
import { tStatic } from "../utils/format-message";
import useEditorStore from "../stores/useEditorStore";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[beru] UI render error:", error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center"
        style={{ background: "#0a0a0a", color: "#fff" }}
      >
        <h1 className="text-lg font-semibold">
          {tStatic("errorBoundary.title", null, useEditorStore.getState().language)}
        </h1>
        <p className="text-sm max-w-md" style={{ color: "#999" }}>
          {tStatic(
            "errorBoundary.hint",
            { cmd: "npm run dev" },
            useEditorStore.getState().language,
          )}
        </p>
        <pre
          className="text-left text-[11px] max-w-xl w-full overflow-auto p-3 rounded"
          style={{ background: "#1a1a1a", color: "#f87171", border: "1px solid #333" }}
        >
          {String(error?.message || error)}
        </pre>
      </div>
    );
  }
}
