# Sayble

**Open-source voice typing. Bring your own APIs. Pay per use. Your data stays on your machine.**

<div align="center">
  <img src="src-tauri/icons/icon.png" alt="Sayble" width="120" height="120">

  <p>
    <img src="https://img.shields.io/badge/Version-0.2.0-blue?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/Tauri-v2-orange?style=flat-square" alt="Tauri">
    <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
  </p>

  <p>
    <a href="#why-sayble">Why Sayble</a> ·
    <a href="#features">Features</a> ·
    <a href="#supported-engines">Engines</a> ·
    <a href="#getting-started">Getting Started</a> ·
    <a href="#tech-stack">Tech Stack</a> ·
    <a href="README.zh-CN.md">中文文档</a>
  </p>
</div>

---

## Why Sayble

Most voice typing tools charge monthly fees, lock you into their speech engine, and route your voice through their servers.

Sayble is different:

- **You choose the engine** — plug in any ASR provider or OpenAI-compatible LLM you like
- **You pay API costs only** — no subscriptions, no tiers, typically a few cents per day
- **You own your data** — everything stays local, no accounts, no telemetry

## Features

- **Global hotkey** — press a key in any app to start voice typing, works system-wide
- **Real-time streaming** — words appear as you speak, powered by WebSocket-based ASR
- **LLM polish** — optionally refine raw speech into clean text (fix typos, casual-to-formal, etc.)
- **Persona system** — switch between custom prompts for different writing styles
- **Floating indicator** — a small overlay shows live transcription and recording timer
- **System tray** — runs in the background, out of your way

## Supported Engines

### Speech Recognition (ASR)

| Provider | Status | Notes |
|----------|--------|-------|
| [Volcengine](https://www.volcengine.com/) (Doubao Streaming 2.0) | ✅ Supported | Chinese-optimized, low latency |
| [OpenAI Whisper](https://platform.openai.com/docs/guides/speech-to-text) | Planned | Multilingual, strong noise handling |
| [Deepgram](https://deepgram.com/) | Planned | Fast, high accuracy |
| [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text) | Planned | 125+ languages |
| [Microsoft Azure Speech](https://azure.microsoft.com/en-us/products/ai-services/speech-to-text) | Planned | Custom vocabulary support |
| [iFlytek](https://www.xfyun.cn/) | Planned | Leading Chinese recognition |

### LLM Polish

| Provider | Status | Notes |
|----------|--------|-------|
| OpenAI-compatible API | ✅ Supported | Works with OpenAI, DeepSeek, Ollama, etc. |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Rust](https://www.rust-lang.org/tools/install) >= 1.77
- An ASR API key (e.g. [Volcengine](https://www.volcengine.com/))

### Install & Run

```bash
git clone https://github.com/tdtdtq-ux/sayble.git
cd sayble
npm install
npm run dev
```

### Build

```bash
npm run build
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri v2](https://tauri.app/) (Rust + Web) |
| Frontend | React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| Backend | Rust |
| ASR | Volcengine streaming ASR (WebSocket) |
| Audio | cpal |
| Input simulation | enigo (keyboard) / arboard (clipboard) |

## Platform Support

| Platform | Status |
|----------|--------|
| Windows | ✅ Supported |
| macOS | Planned |
| Linux | Planned |

## License

[MIT](LICENSE)
