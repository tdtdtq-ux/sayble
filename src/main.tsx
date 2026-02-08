import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { attachConsole } from "@tauri-apps/plugin-log";
import App from "./App";
import { FloatingApp } from "./components/FloatingApp";

// 将后端 Rust 日志转发到浏览器 DevTools 控制台（方便开发调试）
// 注意：前端日志写入文件需使用 @tauri-apps/plugin-log 的 info/warn/error 函数
attachConsole().catch((e) => console.error("Failed to attach console to log plugin:", e));

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
