# Sayble
> 桌面语音输入工具 — 按下快捷键说话，文字自动输入到任意应用。

<div align="center">
  <img src="src-tauri/icons/icon.png" alt="Sayble Logo" width="120" height="120" style="border-radius: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.15);">

  <h3>Voice-to-text, anywhere you type.</h3>
  <p>按下快捷键，开口说话，文字即刻出现在光标处。</p>

  <p>
    <a href="https://github.com/tdtdtq-ux/sayble">
      <img src="https://img.shields.io/badge/Version-0.1.0-blue?style=flat-square" alt="Version">
    </a>
    <img src="https://img.shields.io/badge/Tauri-v2-orange?style=flat-square" alt="Tauri">
    <img src="https://img.shields.io/badge/Backend-Rust-red?style=flat-square" alt="Rust">
    <img src="https://img.shields.io/badge/Frontend-React_19-61DAFB?style=flat-square" alt="React">
    <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
  </p>

  <p>
    <a href="#-功能特点">功能特点</a> •
    <a href="#-技术栈">技术栈</a> •
    <a href="#-快速开始">快速开始</a> •
    <a href="#-使用方式">使用方式</a> •
    <a href="#-项目结构">项目结构</a>
  </p>
</div>

---

## ✨ 功能特点

| 功能 | 说明 |
|------|------|
| **全局热键** | 切换模式（按一次开始/再按停止）+ 长按模式（按住录音/松开停止），支持区分左右修饰键 |
| **实时识别** | 基于火山引擎流式 ASR，边说边出字 |
| **灵活输出** | 剪贴板粘贴 或 模拟键盘输入，适配不同应用场景 |
| **浮窗提示** | 录音时悬浮窗实时展示识别文字和计时 |
| **系统托盘** | 常驻后台，最小化到托盘，不占用任务栏 |

## 🛠 技术栈

| 层 | 技术 |
|----|------|
| **框架** | [Tauri v2](https://tauri.app/)（Rust 后端 + Web 前端） |
| **前端** | React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui |
| **语音识别** | [火山引擎 ASR](https://www.volcengine.com/docs/6561/1354869)（WebSocket 流式传输） |
| **音频采集** | cpal（跨平台音频 I/O） |
| **键盘模拟** | enigo（跨平台输入模拟） |

## 🚀 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) >= 20
- [Rust](https://www.rust-lang.org/tools/install) >= 1.77
- [火山引擎账号](https://www.volcengine.com/) — 需开通语音识别服务，获取 App ID 和 Access Key

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/tdtdtq-ux/sayble.git
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

## 📖 使用方式

1. 首次启动后在 **API 配置** 页填写火山引擎的 App ID 和 Access Key，点击保存
2. 使用默认快捷键开始语音输入：

   | 快捷键 | 模式 | 说明 |
   |--------|------|------|
   | `右 Ctrl` | 切换模式 | 按一次开始录音，再按一次停止 |
   | `左 Ctrl + Space` | 长按模式 | 按住录音，松开停止 |

3. 说话完成后，识别结果会自动粘贴到当前光标位置

> 快捷键可在设置页的 **快捷键** 标签中自定义。

## 📁 项目结构

```
src/                        # 前端（React）
├── App.tsx                 # 主窗口，管理录音状态和热键响应
├── components/
│   ├── Settings.tsx        # 设置页面（API / 快捷键 / 通用）
│   ├── FloatingApp.tsx     # 浮窗入口
│   ├── FloatingWindow.tsx  # 浮窗 UI（录音状态 / 实时文字 / 计时）
│   └── ui/                 # shadcn/ui 组件库

src-tauri/src/              # 后端（Rust）
├── asr/                    # 语音识别（火山引擎 WebSocket）
├── audio/                  # 麦克风音频采集
├── hotkey/                 # 全局热键（Windows 键盘钩子）
├── input/                  # 文字输出（剪贴板 / 键盘模拟）
├── tray/                   # 系统托盘
└── lib.rs                  # 入口，Tauri Commands
```

## 💻 平台支持

| 平台 | 状态 |
|------|------|
| Windows | ✅ 支持 |
| macOS | 🔜 计划中 |
| Linux | 🔜 计划中 |

## 📄 许可证

[MIT](LICENSE) — 自由使用、修改、分发。
