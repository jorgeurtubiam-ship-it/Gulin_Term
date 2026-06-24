---
id: dashboards
title: Dashboards & Analytics
sidebar_position: 6
---

# Dashboards & Analytics

GuLiN Terminal provides powerful built-in analytical capabilities to visualize metrics and system health right from the terminal layout.

## Tsunami Widgets
The `tsunami` widgets are dedicated components designed to ingest data streams and render them using modern charting libraries (like `recharts`). They communicate directly with the local server to poll or stream data from databases, APIs, or local processes.

## Built-in Visualizations
- **CPU Plot**: The `cpuplot` widget tracks live CPU usage across local and remote connections.
- **Database Metrics**: When connected to external databases via `db-connections.json`, the DB Expert can generate visual summaries of query outputs.

Data flows from the backend (Go) via gRPC and WebSocket bridges to the frontend (React), ensuring low latency and smooth animations.
