<div align="center">

# ⚡ GuLiN IA & Terminal
### *The Autonomous AI Terminal & Enterprise Oracle DBA Operating System*

[![GitHub Stars](https://img.shields.io/github/stars/jorgeurtubiam-ship-it/Gulin_ia?style=for-the-badge&logo=github&color=38bdf8)](https://github.com/jorgeurtubiam-ship-it/Gulin_ia/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/jorgeurtubiam-ship-it/Gulin_ia?style=for-the-badge&logo=github&color=818cf8)](https://github.com/jorgeurtubiam-ship-it/Gulin_ia/network/members)
[![Version](https://img.shields.io/badge/Release-v2.1.0-emerald?style=for-the-badge&logo=rocket)](https://github.com/jorgeurtubiam-ship-it/Gulin_ia/releases)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge&logo=apache)](../../LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.25+-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://golang.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Platforms](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=for-the-badge&logo=apple&logoColor=white)]()

<br/>

```
  ██████╗ ██╗   ██╗██╗     ██╗███╗   ██╗    ██╗ █████╗ 
 ██╔════╝ ██║   ██║██║     ██║████╗  ██║    ██║██╔══██╗
 ██║  ███╗██║   ██║██║     ██║██╔██╗ ██║    ██║███████║
 ██║   ██║██║   ██║██║     ██║██║╚██╗██║    ██║██╔══██║
 ╚██████╔╝╚██████╔╝███████╗██║██║ ╚████║    ██║██║  ██║
  ╚═════╝  ╚═════╝ ╚══════╝╚═╝╚═╝  ╚═══╝    ╚═╝╚═╝  ╚═╝
```

**[English](./README.md)** · **[Español](../../README.md)** · **[한국어](../../README.ko.md)**

<p align="center">
  <b>GuLiN</b> transforms your terminal into an <b>Autonomous Agentic Operations Center</b>.<br/>
  Install, diagnose, and orchestrate complex enterprise infrastructure like <b>Oracle Database & Data Guard Standby</b> using <b>pure Natural Language</b>.
</p>

</div>

---

## 🌟 What is GuLiN?

**GuLiN Terminal** is the cognitive operating system for developers, DevOps engineers, and DBAs. It embeds frontier AI models (**Max 3, Claude 3.5 Sonnet, Gemini 2.0, DeepSeek R1/V3, GPT-4o, and local Ollama**) directly with your native shell, database engines, and executive reporting tools.

```
+---------------------------------------------------------------------------------------+
|  👤 USER (Natural Language Prompt):                                                   |
|  "Install Oracle DB 23ai, configure Data Guard Standby replica, and give me a PPT"   |
+---------------------------------------------------------------------------------------+
                                           │
                                           ▼
+───────────────────────────────────────────────────────────────────────────────────────+
|  🤖 GULIN AUTONOMOUS AGENT CORE (Max 3 / Claude / DeepSeek / Gemini / Ollama)         |
|  ├── 🧠 Gulin Brain: Infinite semantic memory & contextual Auto-RAG                   |
|  ├── 🗄️ Oracle Autonomous Engine: DBA Playbooks, RAC, Standby & Diagnostics           |
|  ├── 💻 Live Terminal Bridge: Real-time bidirectional execution & streaming           |
|  └── 📊 DocGen Suite: Automated generation of .pptx, .docx, .xlsx, and BI Dashboards  |
+───────────────────────────────────────────────────────────────────────────────────────+
                                           │
                                           ▼
+───────────────────────────────────────────────────────────────────────────────────────+
|  🎯 DELIVERABLES:                                                                     |
|  [✓] Oracle DB 23ai installed and kernel parameters tuned                             |
|  [✓] Data Guard Standby synchronized with active redo log shipping                    |
|  [✓] Executive slide deck created: executive_dba_report.pptx                         |
|  [✓] Live Dashboard: Oracle Gulin-Insights (PDBs, RAC, Tablespaces, SGA/PGA)          |
+───────────────────────────────────────────────────────────────────────────────────────+
```

---

## 🚀 Key Superpowers

### 🗄️ 1. Autonomous Oracle DBA & Data Guard Standby via Natural Language
* **Zero-Touch Installation:** Deploy **Oracle Database 19c / 21c / 23ai** including all Linux dependencies, oracle user, kernel parameters (`sysctl`, `limits.conf`), and listener configuration with a single prompt.
* **Oracle Standby / Data Guard Automation:** Automatic provisioning of physical/logical Standby databases, `tnsnames.ora`, `listener.ora`, redo transport services, MRP synchronization, and lag checks.
* **Proactive Diagnostics & Health Check:** Lock detection, *alert log* parsing, *Tablespace* threshold monitoring, slow SQL diagnosis, and *SGA/PGA* memory tuning.
* **Live Visual Dashboard (Oracle Gulin-Insights):** Dedicated real-time view to inspect Pluggable Databases (PDBs), RAC clusters, active sessions, and replication flow.

### 🧠 2. Frontier Multi-LLM Orchestration
* Native support for **Max 3**, **Claude 3.5 Sonnet**, **Gemini 2.0 Pro/Flash**, **OpenAI GPT-4o**, **DeepSeek R1 / V3**, and zero-cost local execution with **Ollama**.
* **Zero-context-loss Hot-Swapping:** Change models on the fly depending on the task (e.g., deep reasoning with Max 3/DeepSeek R1, ultra-fast streaming with Gemini Flash).

### 📑 3. DocGen Suite: Executive Presentations, Word Reports & Excel Spreadsheets
* Automatically generate **PowerPoint (`.pptx`)** slide decks, formal executive **Word (`.docx`)** summaries, and **Excel (`.xlsx`)** workbooks with charts directly from terminal diagnostic outputs.
* Interactive **Visual BI** dashboards rendered directly within the workspace.

### 💻 4. Interactive Split-Pane Workspace & High-Performance PTY
* Dual-pane layout: Full-featured Go terminal engine + AI chat with isolated chain-of-thought reasoning.
* 1-click execution blocks and hands-free voice control (*wake-word* support).

---

## ⚡ Quick Installation

### 📦 Production Package (.dmg / .AppImage / .deb / .exe)

```bash
git clone https://github.com/jorgeurtubiam-ship-it/Gulin_ia.git
cd Gulin_ia
chmod +x install.sh
./install.sh
```

### 🛠️ Development Mode (Hot-Reload)

```bash
npm install && task build
task dev
```

---

## 💡 Example Natural Language Prompts

| Prompt | Agent Action |
| :--- | :--- |
| `> "Install Oracle DB 23ai on this server and configure a PDB named ERP_PROD"` | Sets up prerequisites, runs silent installation, and provisions the PDB. |
| `> "Check Data Guard Standby status and verify if there is any archive gap"` | Queries `V$ARCHIVE_DEST_STATUS`, `V$DATAGUARD_STATS`, computes lag, and reports status. |
| `> "Analyze database CPU and memory metrics and create an executive Word report"` | Extracts AWR/ASH metrics and compiles a formatted `performance_report.docx`. |
| `> "Find blocking sessions and generate the resolution plan"` | Inspects `V$SESSION` and `V$SQL`, tracks the root blocker, and proposes kill/tune actions. |

---

## 🏗️ Architecture & Technology Stack

- **Frontend:** React, TypeScript, Vite, Electron, Monaco Editor, Tailwind CSS, Recharts, xterm.js
- **Backend:** Go Core, Go PTY, SQLite, Native Oracle (`go-ora`), PostgreSQL, MySQL, MongoDB, Dremio
- **AI Engine:** Max 3, Claude 3.5, Gemini 2.0, DeepSeek R1/V3, OpenAI, Ollama

---

## 📄 License

Distributed under the **Apache 2.0 License**. See [`LICENSE`](../../LICENSE) for details.

<div align="center">
  <sub>Built with ❤️ by <b><a href="https://github.com/jorgeurtubiam-ship-it">Jorge Urtubia</a></b> and the <b><a href="mailto:contacto@ecogulin.cl">EcoGulin</a></b> team.</sub>
</div>
