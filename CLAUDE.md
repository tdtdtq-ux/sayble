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
- **App.tsx** → 主窗口根组件，页面路由（Dashboard / Settings）、自启动检测、警告条展示。挂载时调用 `useSettingsStore.getState().loadSettings()` 加载全局设置
- **Dashboard.tsx** — 首页框架（左侧菜单 + 首页/人设切换）
- **Settings.tsx** — 设置页框架（左侧菜单 + tab 路由），菜单项：识别引擎 / 润色引擎 / 通用 / 关于
- **VoiceSettings.tsx** — 识别引擎（内建供应商列表、左右分栏内联编辑、连接测试）
- **GeneralSettings.tsx** — 通用设置 tab 框架（Tabs 路由：首页 / 快捷键 / 数据）
- **general/GeneralHome.tsx** — 通用首页 tab（输出方式、麦克风、自动输出、自启动）
- **general/HotkeySettings.tsx** — 快捷键 tab（切换模式、长按模式）
- **general/DataSettings.tsx** — 数据 tab（设置文件路径、日志路径、打开文件夹）
- **polish/PolishProviderManager.tsx** — LLM供应商管理（左右分栏内联编辑，测试连接，选中标记）
- **PersonaPage.tsx** — 人设管理（Prompt 列表左右分栏内联编辑，选中标记，内建标识）
- **FloatingApp.tsx** — 浮窗入口，独立窗口，监听 ASR 事件（带 sessionId 过滤）和 floating-control 事件，纯状态展示（不参与文字输出）
- **FloatingWindow.tsx** — 浮窗 UI 组件（录音状态指示、实时识别文字、计时器）
- **HomePage.tsx** — 主窗口首页（使用统计卡片、识别历史列表、详情弹窗、分页、清空）
- **HotkeyRecorder.tsx** — 快捷键录制组件
- **components/ui/** — shadcn/ui 组件库（button, card, dialog, input, select 等）

路径别名：`@/*` → `./src/*`

使用 [Zustand](https://github.com/pmndrs/zustand) 进行全局状态管理。核心 store：

- **`src/stores/useSettingsStore.ts`** — 统一管理 `appSettings`、`asrSettings`、`polishSettings` 及 UI 状态（`autostartWarning`）。所有写操作触发同一个 500ms 防抖 `debouncedSave()`，全量序列化到后端 `cmd_save_settings`。`loadSettings()` 在 App.tsx 挂载时调用一次，内部有 `loaded` 标志防重。

设置持久化通过后端 IPC（`cmd_load_settings` / `cmd_save_settings`）全量读写 `settings.json`。跨窗口通信使用 Tauri 事件系统。

#### 录音状态管理

后端是唯一的状态权威，录音控制完全在后端闭环，不经过前端 WebView：

- **RecordingFlag**（后端 `lib.rs`）— 唯一真相源，包含 `is_recording`、`session_id`、`stop_tx`
- **hotkey-forward 线程（后端直控）** — 收到热键后直接从 store 读取配置，调用 `start_recording_inner` / `stop_recording_inner`，并 emit `floating-control` 通知浮窗。不经过前端 WebView，确保主窗口隐藏到托盘后录音控制仍正常工作
- **前端不参与录音控制** — App.tsx 只负责设置界面，不监听热键事件
- **ASR 事件携带 sessionId** — 前端用 `maxSessionRef` 比大小过滤旧 session 的迟到事件
- **Disconnected 不暴露给前端** — 后端内部消化，fallback 为 FinalResult + Finished
- **文字输出后端闭环** — 后端收到 FinalResult 后，先判断润色开关：关闭则直接 emit FinalResult + output；开启则 emit Polishing（携带原文）→ 调用 LLM API → 成功 emit PolishResult / 失败 emit PolishError → output(final_text) → 延迟(成功1s/失败3s) → Finished
- **异步 listener 注册使用 cancelled 标志** — 防止 React StrictMode 双重执行导致 listener 泄漏

### 后端 (src-tauri/src/)

Rust，按功能模块划分：

| 模块 | 职责 |
|------|------|
| `asr/` | 语音识别 — `protocol.rs` 定义协议，`volcengine.rs` 对接火山引擎 ASR（WebSocket） |
| `audio/` | 麦克风音频采集（cpal） |
| `hotkey/` | 全局热键 — `win_hook.rs` Windows 底层键盘钩子 |
| `input/` | 文字输出 — `simulate.rs` 键盘模拟（enigo），`clipboard.rs` 剪贴板（arboard） |
| `store.rs` | 数据持久化 — 自封装 JsonStore，统一管理 `~/.sayble/` 下的 settings/stats/history |
| `tray/` | 系统托盘图标与菜单 |
| `config.rs` | 配置类型定义（如 OutputMode 枚举） |
| `polish.rs` | LLM 润色 — 调用 OpenAI 兼容 API（POST /chat/completions）对 ASR 文字润色 |

### Tauri Commands（前后端 IPC 接口）

- `cmd_list_audio_devices()` — 枚举音频输入设备
- `cmd_start_recording(appId, accessKey, deviceName)` — 开始录音和 ASR 识别
- `cmd_stop_recording()` — 停止录音
- `cmd_test_asr_connection(appId, accessKey)` — 测试 ASR 连接
- `cmd_test_polish_provider(baseUrl, apiKey)` — 测试润色供应商连接（GET /models）
- `cmd_save_settings(settings)` / `cmd_load_settings()` — 设置持久化（全量读写，settings 为 `{ app_settings, polish_settings, ... }` 结构）
- `cmd_get_data_dir()` — 返回数据目录路径（settings、logs）
- `cmd_load_history()` — 加载识别历史记录（倒序，最新在前）
- `cmd_clear_history()` — 清空识别历史记录

### 关键依赖

- **tokio-tungstenite** — ASR WebSocket 通信
- **cpal** — 跨平台音频 I/O
- **enigo** — 跨平台键盘模拟
- **reqwest** — HTTP client（润色供应商连接测试、后续 OpenAI API 调用）
- **windows** crate (0.58) — Windows 底层 API（钩子、输入）

## Testing

Vitest + jsdom 环境 + @testing-library/react。测试文件放在对应目录的 `__tests__/` 子目录下。测试配置启用了 globals（可直接使用 describe/it/expect）。

## Platform Notes

当前主要面向 Windows 平台（hotkey 模块使用 Windows API 键盘钩子）。主窗口使用 Overlay 标题栏模式（`titleBarStyle: "Overlay"`），由系统提供窗口控制按钮，关闭按钮拦截为隐藏到托盘。浮窗为独立窗口（`decorations: false, alwaysOnTop: true`），不显示在任务栏。通过 `build.manifest` 声明 `PerMonitorV2` DPI 感知，确保多屏不同缩放比例下 UI 清晰。

**Device ID**：应用首次启动时从 Windows 注册表 `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` 读取机器唯一标识，写入 `app_settings.deviceId` 并持久化。后续启动直接读取已存储的值。前端 About 页面展示前 8 位，点击可复制完整 ID。跨平台 TODO：macOS/Linux 需要实现各自的设备标识获取逻辑。

## Data Paths

| 路径 | 说明 |
|------|------|
| `~/.sayble/settings.json` | 用户设置持久化（自封装 JsonStore） |
| `~/.sayble/stats.json` | 使用统计持久化（自封装 JsonStore） |
| `~/.sayble/history.json` | 识别历史记录持久化（自封装 JsonStore，最多 200 条） |
| `~/.sayble/logs/sayble.log` | 应用日志（tauri-plugin-log，5MB 轮转） |

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
| `[store]` | store.rs | 数据持久化（JsonStore 读写） |
| `[tray]` | tray/ | 系统托盘 |
| `[autostart]` | lib.rs | 开机自启动 |
| `[polish]` | polish.rs | LLM 润色（API 调用、结果处理） |

## Work Rules

- 当用户提供了文档链接或文档内容时，严格按照文档来做，不要自行搜索替代方案。如果文档链接无法访问，必须立即告知用户，而不是自己去网上搜索。
- 前端 UI 开发时，凡是 shadcn/ui 组件库中有对应组件的，一律使用 shadcn/ui 组件，不要使用原生 HTML 元素。
