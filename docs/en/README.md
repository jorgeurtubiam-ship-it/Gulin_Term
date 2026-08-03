# 🚀 GuLiN Terminal — The Ultimate Agentic OS & Terminal

![GuLiN Banner](https://img.shields.io/badge/GuLiN-v2.0.4-blue?style=for-the-badge&logo=ai&color=6366f1)
![Multi-IA](https://img.shields.io/badge/Architecture-Multi--IA-green?style=for-the-badge)
![Agentic](https://img.shields.io/badge/Mode-Full--Agentic-orange?style=for-the-badge)
![License](https://img.shields.io/github/license/jorgeurtubiam-ship-it/Gulin_ia?style=for-the-badge)
![Stars](https://img.shields.io/github/stars/jorgeurtubiam-ship-it/Gulin_ia?style=social)
![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?style=for-the-badge&logo=go)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=for-the-badge)

[English](./README.md) · [Español](../README.md) · [한국어](../../README.ko.md)

**GuLiN Terminal** is the ultimate **agentic intelligence** ecosystem for engineers working on the frontier of **AI**, **Big Data**, and **large-scale infrastructure**. It's not just a terminal — it's a **cognitive operating system** with long-term memory, expert agents, and integrated tooling for databases, cloud, and networks.

---

## ✨ Key Features

- 🧠 **Multi-AI Orchestrator**: Native hot-swapping between **Ollama (Local/GPU Cloud), DeepSeek, Claude, Gemini, and OpenAI**. Switch engines without losing conversation context.
- 💾 **Long-Term Memory (Gulin Brain)**: Persistent memory with **Auto-RAG** that learns from your habits, solutions, and project context.
- 🗄️ **DB Maestro**: Full database connection & management for **Oracle, Postgres, MySQL, MongoDB, SQLite, and Dremio (Big Data)**. Generate complex SQL and visualize results instantly.
- 🌐 **Agentic Browser**: A browser that the AI operates autonomously — navigating the web, interacting with the DOM, filling forms, and extracting real-time critical info.
- 🔑 **API Manager**: Centralized, secure vault for tokens, secrets, and external service connections (AWS, Azure, custom APIs).
- 🖥️ **SSH & CLI Infrastructure**: Full control over remote servers, Docker, and cloud services. The AI proactively diagnoses, fixes, and deploys.
- 📊 **Dynamic Dashboards**: Premium line, bar, radar, area, and composed charts in seconds.
- 🗺️ **Infrastructure Map**: Real-time visualization of nodes and network connections via agent scanning.
- 🧩 **GulinApp SDK**: Build custom terminal micro-apps (monitors, BI dashboards) with the **Tsunami (Go + VDom)** framework.

---

## ⭐ Why GuLiN?

| GuLiN                                  | Traditional terminal       |
| -------------------------------------- | -------------------------- |
| Infinite memory agent (Auto-RAG)       | No persistent context      |
| Multi-AI agnostic (hot-swap)           | Single model/provider      |
| Integrated DB Maestro (SQL + NoSQL)    | CLI only                   |
| Autonomous agentic browser             | No browsing capability     |
| Native BI dashboard                    | Requires external tools    |

---

## 📦 Installation

### Minimum requirements
- **Node.js** 22 LTS · **Go** 1.25+ · npm 10+ · Xcode CLI Tools (macOS)

### Full install (production)

```bash
git clone https://github.com/jorgeurtubiam-ship-it/Gulin_ia.git
cd Gulin_ia
chmod +x install_gulin.sh
./install_gulin.sh
```

The installer compiles the Go backend, the Electron frontend, produces the install package (`.dmg`, `.AppImage`, `.deb`, `.exe`) and sets up the CLI (`wsh`, `gulinsrv`) on PATH.

### Development (hot-reload)

```bash
npm install && task build
task dev
```

### Cross-compilation from macOS

```bash
brew install zig          # required for CGO
./install_gulin.sh --windows   # generates .exe
./install_gulin.sh --linux     # generates .AppImage + .deb
```

---

## 🏗️ Tech Stack

- **Backend:** Go (modular `pkg/` architecture)
- **Frontend:** TypeScript / React (Vite · Electron) · Tailwind · Recharts · Monaco Editor
- **Databases:** Oracle, Postgres, MySQL, MongoDB, SQLite, Dremio
- **AI:** Ollama, DeepSeek, Claude, Gemini, OpenAI, Bedrock, Anthropic

---

## 🚀 Roadmap

See [ROADMAP.md](../../ROADMAP.md). Upcoming:
- Cross-provider hot model-switching (in progress)

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](../../CONTRIBUTING.md) and our [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md).

---

## 📄 License

Distributed under the **Apache License 2.0**. See [LICENSE](../../LICENSE).

---

**Built by [Jorge Urtubia](https://github.com/jorgeurtubiam-ship-it)**  
*GuLiN Terminal: Where AI turns into action.*
