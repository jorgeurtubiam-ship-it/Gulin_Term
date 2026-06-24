---
id: service-map
title: Service Map & Editable Files
sidebar_position: 5
---

# Service Map & Editable Files

GuLiN Terminal relies on several critical JSON files to map the topography of your workflow. These files are highly editable and reside in your configuration directory (usually `~/.config/gulin` or `%APPDATA%/gulin/config`).

## Core Configuration Files
1. **`gulin.config.json`**: The master configuration file. It dictates where plugins, databases, logs, and caches are stored across macOS, Linux, and Windows.
2. **`connections.json`**: Stores your SSH connections. You can define hostnames, users, ports, and identity files. Connections defined here appear in the terminal connection manager.
3. **`db-connections.json`**: Maps all your database connections (PostgreSQL, SQLite, Oracle, etc.). Used by the **DB Expert** agent to run autonomous queries.
4. **`api-manager.json`**: A registry of external APIs, including credentials (tokens, usernames) and specific system prompts needed to interact with them (e.g., Dremio, GitHub API).
5. **`brain-map.json`**: A visual and structural map of your infrastructure. It defines nodes (like AWS EC2 instances, Docker containers, databases) and how they connect to one another.

> **Tip:** You can safely edit these files manually to quickly bootstrap your environment on a new machine.
