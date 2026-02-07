import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { FloatingApp } from "./components/FloatingApp";

const params = new URLSearchParams(window.location.search);
const windowType = params.get("window");

// floating 窗口需要透明背景、无滚动条
if (windowType === "floating") {
  document.documentElement.classList.add("floating-window");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {windowType === "floating" ? <FloatingApp /> : <App />}
  </React.StrictMode>,
);
