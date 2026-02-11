# Sayble

**开源语音输入工具。自选引擎，按量付费，数据留在本地。**

<div align="center">
  <img src="src-tauri/icons/icon.png" alt="Sayble" width="120" height="120">

  <p>
    <img src="https://img.shields.io/badge/Version-0.2.0-blue?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/Tauri-v2-orange?style=flat-square" alt="Tauri">
    <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
  </p>

  <p>
    <a href="#为什么选-sayble">为什么选 Sayble</a> ·
    <a href="#功能">功能</a> ·
    <a href="#支持引擎">支持引擎</a> ·
    <a href="#快速开始">快速开始</a> ·
    <a href="#技术栈">技术栈</a> ·
    <a href="README.md">English</a>
  </p>
</div>

---

## 为什么选 Sayble

市面上的语音输入工具（讯飞、搜狗、Typeless、Dragon 等）按月收费，绑定引擎，语音数据全部经过他们的服务器。

Sayble 不一样：

- **引擎自选** — ASR 和润色 LLM 都由你决定，接入任何兼容 API 即可
- **按量付费** — 没有会员、没有套餐，直接用官方 API 原价，一个月可能只花几块钱
- **数据自主** — 所有数据留在本地，无账号、无遥测、无"我们有权使用您的数据"

## 功能

- **全局热键** — 在任意应用中按下快捷键即可录音，全系统可用
- **实时流式识别** — 边说边出字，基于 WebSocket 流式 ASR
- **LLM 润色** — 可选接入大模型，自动修正错别字、口语转书面语
- **人设系统** — 自定义润色 Prompt，一键切换不同写作风格
- **浮窗提示** — 录音时悬浮窗实时展示识别文字和计时
- **系统托盘** — 常驻后台，不占任务栏

## 支持引擎

### 语音识别（ASR）

| 供应商 | 状态 | 说明 |
|--------|------|------|
| [火山引擎](https://www.volcengine.com/)（豆包流式 2.0） | ✅ 已支持 | 中文优化，低延迟 |
| [OpenAI Whisper](https://platform.openai.com/docs/guides/speech-to-text) | 计划中 | 多语言，抗噪能力强 |
| [Deepgram](https://deepgram.com/) | 计划中 | 速度快，准确率高 |
| [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text) | 计划中 | 支持 125+ 语言 |
| [Microsoft Azure Speech](https://azure.microsoft.com/en-us/products/ai-services/speech-to-text) | 计划中 | 支持自定义词汇 |
| [讯飞](https://www.xfyun.cn/) | 计划中 | 中文识别领先 |

### LLM 润色

| 供应商 | 状态 | 说明 |
|--------|------|------|
| OpenAI 兼容 API | ✅ 已支持 | 适用于 OpenAI、DeepSeek、Ollama 等 |

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) >= 20
- [Rust](https://www.rust-lang.org/tools/install) >= 1.77
- 一个 ASR 服务的 API Key（如[火山引擎](https://www.volcengine.com/)）

### 安装与运行

```bash
git clone https://github.com/tdtdtq-ux/sayble.git
cd sayble
npm install
npm run dev
```

### 构建

```bash
npm run build
```

## 技术栈

| 层 | 技术 |
|----|------|
| 框架 | [Tauri v2](https://tauri.app/)（Rust + Web） |
| 前端 | React 19、TypeScript、Tailwind CSS 4、shadcn/ui |
| 后端 | Rust |
| 语音识别 | 火山引擎流式 ASR（WebSocket） |
| 音频采集 | cpal |
| 文字输出 | enigo（键盘模拟）/ arboard（剪贴板） |

## 平台支持

| 平台 | 状态 |
|------|------|
| Windows | ✅ 支持 |
| macOS | 计划中 |
| Linux | 计划中 |

## 许可证

[MIT](LICENSE)
