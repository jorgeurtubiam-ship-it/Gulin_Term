---
id: overview
title: Overview & Architecture
sidebar_position: 1
---

# Overview & Architecture

Welcome to the **GuLiN Terminal** documentation. GuLiN is an advanced, AI-powered terminal designed to merge traditional CLI workflows with powerful graphical capabilities, such as web browsing, rich data visualization (dashboards), and autonomous AI agents.

## Core Architecture

GuLiN Terminal is built using a hybrid architecture:
- **Backend (Go)**: The core engine is written in Go (`cmd/server/main-server.go`). It handles all heavy lifting, including the Unified Memory (Brain), AI Model proxying, database connections, shell execution, and the orchestrator agent system.
- **Frontend (Node/TypeScript/React)**: The graphical user interface is built with React and Vite. It renders terminal emulators, dashboards (using `recharts`), and web views within an Electron/Tauri container.
- **Data Persistence**: Uses SQLite for local storage, combined with a Vector Database for the Auto-RAG (Retrieval-Augmented Generation) system.

## Key Features
- **AI Integration**: Support for multiple models (Ollama, Gemini, Claude, DeepSeek).
- **Agentic Workflow**: Specialized agents (DB Expert, File Expert, Web Expert, Command Sysadmin) managed by an Orchestrator.
- **Unified Memory (Brain)**: A long-term memory system that maps knowledge, server connections, and habits.
- **Service Map**: Centralized configuration management using JSON files for APIs, Databases, and SSH connections.
