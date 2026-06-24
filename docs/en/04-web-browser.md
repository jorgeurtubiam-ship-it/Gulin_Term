---
id: web-browser
title: Agentic Web Browser
sidebar_position: 4
---

# Agentic Web Browser

GuLiN Terminal is not just a command-line interface; it includes a fully functional web browser widget that the AI can control autonomously.

## Capabilities
The AI uses the following internal tools to interact with web pages without leaving your terminal:
- `web_navigate`: Commands the browser widget to open a specific URL.
- `web_read_page`: Extracts the text content of the currently active browser widget for analysis or summarization.
- `web_click`: Identifies and clicks elements on the page (like links or buttons).
- `web_type`: Simulates keyboard input to fill out forms or search boxes.

## Use Cases
- Reading API documentation directly into the context window.
- Searching StackOverflow for error resolutions.
- Interacting with internal web dashboards.
