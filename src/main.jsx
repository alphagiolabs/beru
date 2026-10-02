import React from "react";
import ReactDOM from "react-dom/client";
import BeruRoot from "./BeruRoot";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BeruRoot />
  </React.StrictMode>,
);

const interFont = document.createElement("link");
interFont.rel = "stylesheet";
interFont.href =
  "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap";
document.head.appendChild(interFont);
