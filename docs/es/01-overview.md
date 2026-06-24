---
id: overview
title: Visión General y Arquitectura
sidebar_position: 1
---

# Visión General y Arquitectura

Bienvenido a la documentación de **GuLiN Terminal**. GuLiN es una terminal avanzada potenciada por IA diseñada para fusionar los flujos de trabajo tradicionales de la línea de comandos con potentes capacidades gráficas, como navegación web, visualización de datos ricos (dashboards) y agentes de IA autónomos.

## Arquitectura Principal

GuLiN Terminal está construida con una arquitectura híbrida:
- **Backend (Go)**: El motor principal está escrito en Go (`cmd/server/main-server.go`). Maneja todas las tareas pesadas, incluyendo la Memoria Unificada (Brain), el proxy de Modelos de IA, conexiones a bases de datos, ejecución de shells y el sistema orquestador de agentes.
- **Frontend (Node/TypeScript/React)**: La interfaz gráfica de usuario está construida con React y Vite. Renderiza emuladores de terminal, dashboards (usando `recharts`) y vistas web dentro de un contenedor Electron/Tauri.
- **Persistencia de Datos**: Utiliza SQLite para almacenamiento local, combinado con una Base de Datos Vectorial para el sistema Auto-RAG (Generación Aumentada por Recuperación).

## Características Clave
- **Integración de IA**: Soporte nativo para múltiples modelos (Ollama, Gemini, Claude, DeepSeek).
- **Flujo de Trabajo Agéntico**: Agentes especializados (Experto en BD, Experto en Archivos, Experto Web, Sysadmin) manejados por un Orquestador central.
- **Memoria Unificada (Brain)**: Un sistema de memoria a largo plazo que mapea conocimiento, conexiones de servidores y hábitos.
- **Mapa de Servicios**: Gestión centralizada de configuraciones usando archivos JSON para APIs, Bases de Datos y conexiones SSH.
