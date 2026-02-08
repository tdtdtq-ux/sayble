# Sayble

跨平台桌面语音输入工具 — 按下快捷键说话，松开自动将语音转为文字输入到任意应用中。

## 功能特点

- **全局热键** — 支持切换模式（按一次开始/再按停止）和长按模式（按住录音/松开停止），区分左右修饰键
- **实时识别** — 基于火山引擎流式 ASR，说话同时即可看到识别结果
- **灵活输出** — 剪贴板粘贴或模拟键盘输入，适配不同应用场景
- **浮窗提示** — 录音时显示悬浮窗，实时展示识别文字和录音时长
- **系统托盘** — 常驻后台，最小化到托盘，不占用任务栏

## 技术栈

- **框架** — [Tauri v2](https://tauri.app/)（Rust 后端 + Web 前端）
- **前端** — React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui
- **语音识别** — [火山引擎 ASR（WebSocket 流式传输）](https://www.volcengine.com/docs/6561/1354869)
- **音频采集** — cpal（跨平台音频 I/O）
- **键盘模拟** — enigo（跨平台输入模拟）

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) >= 20
- [Rust](https://www.rust-lang.org/tools/install) >= 1.77
- [火山引擎账号](https://www.volcengine.com/) — 需要开通语音识别服务，获取 App ID 和 Access Key

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/jasonchou021/sayble.git
cd sayble

# 安装前端依赖
npm install

# 开发模式运行
npm run dev
```

### 构建

```bash
# 生产构建（输出安装包）
npm run tauri build
```

## 使用方式

1. 首次启动后在 **API 配置** 页填写火山引擎的 App ID 和 Access Key，点击保存
2. 使用默认快捷键开始语音输入：
   - **右 Ctrl** — 切换模式（按一次开始录音，再按一次停止）
   - **左 Ctrl + Space** — 长按模式（按住录音，松开停止）
3. 说话完成后，识别结果会自动粘贴到当前光标位置

快捷键可在 **快捷键** 设置页自定义。

## 项目结构

```
src/                    # 前端（React）
├── App.tsx             # 主窗口，管理录音状态和热键响应
├── components/
│   ├── Settings.tsx    # 设置页面
│   ├── FloatingApp.tsx # 浮窗入口
│   ├── FloatingWindow.tsx # 浮窗 UI
│   ├── TitleBar.tsx    # 自定义标题栏
│   └── ui/             # shadcn/ui 组件
src-tauri/src/          # 后端（Rust）
├── asr/                # 语音识别（火山引擎 WebSocket）
├── audio/              # 麦克风音频采集
├── hotkey/             # 全局热键（Windows 键盘钩子）
├── input/              # 文字输出（剪贴板 / 键盘模拟）
├── tray/               # 系统托盘
└── lib.rs              # 入口，Tauri Commands
```

## 平台支持

目前主要支持 **Windows**。全局热键模块使用 Windows API 底层键盘钩子实现，macOS / Linux 支持待后续开发。

## 许可证

[MIT](LICENSE)
