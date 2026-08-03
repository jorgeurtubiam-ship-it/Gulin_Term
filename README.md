# 🚀 GuLiN Terminal — The Ultimate Agentic OS & Terminal

![GuLiN Banner](https://img.shields.io/badge/GuLiN-v2.0.4-blue?style=for-the-badge&logo=ai&color=6366f1)
![Multi-IA](https://img.shields.io/badge/Architecture-Multi--IA-green?style=for-the-badge)
![Agentic](https://img.shields.io/badge/Mode-Full--Agentic-orange?style=for-the-badge)
![License](https://img.shields.io/github/license/jorgeurtubiam-ship-it/Gulin_ia?style=for-the-badge)
![Stars](https://img.shields.io/github/stars/jorgeurtubiam-ship-it/Gulin_ia?style=social)
![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?style=for-the-badge&logo=go)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=for-the-badge)

[English](./docs/en/README.md) · [Español](./README.md) · [한국어](./README.ko.md)

**GuLiN Terminal** es el ecosistema definitivo de **inteligencia agéntica** para ingenieros que operan en la frontera de la **IA**, el **Big Data** y la **infraestructura a gran escala**. No es solo un terminal, es un **sistema operativo cognitivo** con memoria a largo plazo, agentes expertos y herramientas de gestión de bases de datos, nube y redes integradas.

---

## ✨ Características Principales

- 🧠 **Orquestador Multi-IA**: Conexión nativa y conmutación en caliente entre **Ollama (Local/GPU Cloud), DeepSeek, Claude, Gemini y OpenAI**. Cambia de motor sin perder el contexto.
- 💾 **Memoria a Largo Plazo (Gulin Brain)**: Sistema de memoria persistente con **Auto-RAG** que aprende de tus hábitos, soluciones y contexto de proyecto.
- 🗄️ **DB Maestro**: Conexión y gestión total de **Oracle, Postgres, MySQL, MongoDB, SQLite y Dremio (Big Data)**. Genera SQL complejo y visualiza resultados al instante.
- 🌐 **Navegador Agéntico**: Un navegador que la IA opera de forma autónoma: navega la web, interactúa con el DOM, llena formularios y extrae información crítica en tiempo real.
- 🔑 **API Manager**: Bóveda centralizada y segura de tokens, secretos y conexiones (AWS, Azure, APIs personalizadas).
- 🖥️ **Infraestructura SSH & CLI**: Control total de servidores remotos, Docker y servicios cloud. La IA diagnostica, repara y despliega proactivamente.
- 📊 **Dashboards Dinámicos**: Gráficos de líneas, barras, radar, áreas y composiciones premium en segundos.
- 🗺️ **Mapa de Infraestructura**: Visualización en tiempo real de nodos y conexiones de red.
- 🧩 **GulinApp SDK**: Construye micro-apps de terminal (monitores, BI dashboards) con el framework **Tsunami (Go + VDom)**.

---

## ⭐ ¿Por qué usar GuLiN?

| GuLiN                                  | Terminal tradicional            |
| -------------------------------------- | ------------------------------- |
| Agente con memoria infinita (Auto-RAG) | Sin memoria de contexto         |
| Multi-IA agnóstica (hot-swap)          | Un solo modelo/provider         |
| DB Maestro integrado (SQL + NoSQL)     | Solo línea de comandos          |
| Navegador autónomo y agéntico          | Sin navegación                 |
| Dashboard BI nativo                    | Requiere herramientas externas  |

---

## 📦 Instalación

### Requisitos mínimos
- **Node.js** 22 LTS · **Go** 1.25+ · npm 10+ · Xcode CLI Tools (macOS)

### Instalación completa (producción)

```bash
git clone https://github.com/jorgeurtubiam-ship-it/Gulin_ia.git
cd Gulin_ia
chmod +x install_gulin.sh
./install_gulin.sh
```

El instalador compila el backend Go, el frontend Electron, genera el instalador (`.dmg`, `.AppImage`, `.deb`, `.exe`) e instala la CLI (`wsh`, `gulinsrv`) en el PATH.

### Modo desarrollo (hot-reload)

```bash
npm install && task build
task dev
```

### Cross-compilación desde macOS

```bash
brew install zig          # requerido para CGO
./install_gulin.sh --windows   # genera .exe
./install_gulin.sh --linux     # genera .AppImage + .deb
```

---

## 🏗️ Stack Tecnológico

- **Backend:** Go (arquitectura modular `pkg/`)
- **Frontend:** TypeScript / React (Vite · Electron) · Tailwind · Recharts · Monaco Editor
- **ORM/DB:** Oracle, Postgres, MySQL, MongoDB, SQLite, Dremio
- **IA:** Ollama, DeepSeek, Claude, Gemini, OpenAI, Bedrock, Anthropic

---

## 🚀 Roadmap

Consúltalo en [ROADMAP.md](./ROADMAP.md). Próximos hitos:
- Conmutación Multi-IA cross-provider en caliente (en curso)

---

## 🤝 Contribuciones

¡Las contribuciones son bienvenidas! Revisa [CONTRIBUTING.md](./CONTRIBUTING.md) y el [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

---

## 📄 Licencia

Distribuido bajo la **Apache License 2.0**. Ver [LICENSE](./LICENSE).

---

**Desarrollado por [Jorge Urtubia](https://github.com/jorgeurtubiam-ship-it)**  
*GuLiN Terminal: Donde la IA se convierte en acción.*
