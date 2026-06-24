---
id: gulin-agent
title: GuLiN Agent & Brain (Auto-RAG)
sidebar_position: 3
---

# GuLiN Agent & Brain

The **GuLiN Agent** is an autonomous orchestration system built into the terminal. Rather than relying on a single prompt, GuLiN delegates tasks to specialized sub-agents.

## The Orchestrator
When a complex task is received, the Orchestrator evaluates the intent and uses the `call_expert` tool to dispatch the task to one of the following:
- **DB Expert**: Specialized in `db_query`, managing database connections, and querying tables.
- **File Expert**: Handles file reading, writing, and deletion.
- **Web Expert**: Navigates the internet to fetch documentation or scrape data.
- **Command Expert**: A sysadmin agent that runs shell commands and monitors terminal output.

## Unified Memory (Brain)
The "Brain" is GuLiN's long-term memory system. It operates on two fronts:
1. **Semantic Search (Auto-RAG)**: The `workspace_search` tool queries a local Vector Database of your indexed project codebase. To index your project, run `wsh gulin index`.
2. **Persistent Knowledge**: The agent can explicitly save habits, server topologies, and project context using `brain_update` and retrieve them via `brain_search`. These are stored as Markdown files and parsed dynamically.
