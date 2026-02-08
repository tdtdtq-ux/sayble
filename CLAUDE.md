# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sayble（跨平台桌面语音输入工具）— 使用 Tauri v2 构建的桌面应用，通过麦克风采集语音，调用火山引擎 ASR 服务转文字，再通过剪贴板粘贴或键盘模拟将文字输入到任意应用中。支持全局热键、系统托盘常驻。

## Commands

```bash
# 前端开发服务器（Vite，端口 1420）
npm run dev

# Tauri 桌面应用开发模式（自动启动前端 dev server）
npm run tauri dev

# 生产构建
npm run build              # 仅前端
npm run tauri build         # 完整桌面应用打包

# 测试
npm test                   # Vitest 单次运行
npm run test:watch         # Vitest 监听模式
# 运行单个测试文件:
npx vitest run src/components/__tests__/SomeComponent.test.tsx

# Rust 后端测试
cd src-tauri && cargo test
```

## Architecture

### 前端 (src/)

React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui (new-york 风格)。

多窗口架构，通过 URL 参数 `?window=floating` 区分窗口类型：

- **main.tsx** → 入口，根据 URL 参数渲染 `<App />` 或 `<FloatingApp />`
- **App.tsx** → 主窗口根组件，监听后端热键指令，调用录音 command，通过 `emit("floating-control")` 与浮窗通信
- **Settings.tsx** — 主设置界面（API 配置、热键配置、输出模式、麦克风选择等）
- **FloatingApp.tsx** — 浮窗入口，独立窗口，监听 ASR 事件（带 sessionId 过滤）和 floating-control 事件，管理文字输出
- **FloatingWindow.tsx** — 浮窗 UI 组件（录音状态指示、实时识别文字、计时器）
- **HotkeyRecorder.tsx** — 快捷键录制组件
- **components/ui/** — shadcn/ui 组件库（button, card, input, select 等）

路径别名：`@/*` → `./src/*`

无全局状态管理库，使用 React hooks + Tauri plugin-store 持久化。跨窗口通信使用 Tauri 事件系统。

#### 录音状态管理

后端是唯一的状态权威，前端只做发指令和展示状态：

- **RecordingFlag**（后端 `lib.rs`）— 唯一真相源，包含 `is_recording`、`session_id`、`stop_tx`
- **hotkey 转发线程** — 收到 `ToggleRecording` 时读 `RecordingFlag.is_recording`，转换为 `StartRecording`/`StopRecording` 再 emit 给前端
- **前端不做二次判断** — 收到 `StartRecording` 就 start，`StopRecording` 就 stop
- **ASR 事件携带 sessionId** — 前端用 `maxSessionRef` 比大小过滤旧 session 的迟到事件
- **Disconnected 不暴露给前端** — 后端内部消化，fallback 为 FinalResult + Finished
- **异步 listener 注册使用 cancelled 标志** — 防止 React StrictMode 双重执行导致 listener 泄漏

### 后端 (src-tauri/src/)

Rust，按功能模块划分：

| 模块 | 职责 |
|------|------|
| `asr/` | 语音识别 — `protocol.rs` 定义协议，`volcengine.rs` 对接火山引擎 ASR（WebSocket） |
| `audio/` | 麦克风音频采集（cpal） |
| `hotkey/` | 全局热键 — `win_hook.rs` Windows 底层键盘钩子 |
| `input/` | 文字输出 — `simulate.rs` 键盘模拟（enigo），`clipboard.rs` 剪贴板（arboard） |
| `tray/` | 系统托盘图标与菜单 |
| `config.rs` | 配置类型定义（如 OutputMode 枚举） |

### Tauri Commands（前后端 IPC 接口）

- `cmd_list_audio_devices()` — 枚举音频输入设备
- `cmd_start_recording(appId, accessKey, deviceName)` — 开始录音和 ASR 识别
- `cmd_stop_recording()` — 停止录音
- `cmd_output_text(text, mode)` — 通过剪贴板或键盘模拟输出文字
- `cmd_test_asr_connection(appId, accessKey)` — 测试 ASR 连接
- `cmd_save_settings(app, settings)` / `cmd_load_settings(app)` — 设置持久化

### 关键依赖

- **tokio-tungstenite** — ASR WebSocket 通信
- **cpal** — 跨平台音频 I/O
- **enigo** — 跨平台键盘模拟
- **windows** crate (0.58) — Windows 底层 API（钩子、输入）

## Testing

Vitest + jsdom 环境 + @testing-library/react。测试文件放在对应目录的 `__tests__/` 子目录下。测试配置启用了 globals（可直接使用 describe/it/expect）。

## Platform Notes

当前主要面向 Windows 平台（hotkey 模块使用 Windows API 键盘钩子）。主窗口使用 Overlay 标题栏模式（`titleBarStyle: "Overlay"`），由系统提供窗口控制按钮，关闭按钮拦截为隐藏到托盘。浮窗为独立窗口（`decorations: false, alwaysOnTop: true`），不显示在任务栏。通过 `build.manifest` 声明 `PerMonitorV2` DPI 感知，确保多屏不同缩放比例下 UI 清晰。

## Data Paths (Windows)

所有运行时数据位于 `%APPDATA%/com.sayble.app/`：

| 路径 | 说明 |
|------|------|
| `logs/sayble.log` | 应用日志（tauri-plugin-log，5MB 轮转，保留旧文件） |
| `settings.json` | 用户设置持久化（tauri-plugin-store） |

### 日志 Tag 约定

所有日志使用 `[tag]` 前缀，按模块分类：

| Tag | 模块 | 说明 |
|-----|------|------|
| `[app]` | lib.rs | 应用启动/生命周期 |
| `[cmd]` | lib.rs | IPC 命令入口（start_recording / stop_recording / output_text） |
| `[recording]` | lib.rs | 录音状态机（session 分配、flag 变更） |
| `[hotkey]` | hotkey/ | 快捷键检测与配置 |
| `[hotkey-forward]` | lib.rs | 快捷键事件转发线程 |
| `[audio]` | audio/ | 麦克风采集 |
| `[asr]` | asr/ | ASR WebSocket 通信 |
| `[asr-forward]` | lib.rs | ASR 事件转发到前端 |
| `[output]` | input/ | 文字输出（剪贴板粘贴 / 键盘模拟） |
| `[tray]` | tray/ | 系统托盘 |
| `[autostart]` | lib.rs | 开机自启动 |

## Work Rules

- 当用户提供了文档链接或文档内容时，严格按照文档来做，不要自行搜索替代方案。如果文档链接无法访问，必须立即告知用户，而不是自己去网上搜索。
