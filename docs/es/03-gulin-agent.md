---
id: gulin-agent
title: Agente GuLiN y Cerebro (Auto-RAG)
sidebar_position: 3
---

# Agente GuLiN y Cerebro

El **Agente GuLiN** es un sistema de orquestación autónomo integrado en la terminal. En lugar de depender de un solo prompt general, GuLiN delega tareas a sub-agentes especializados.

## El Orquestador
Cuando se recibe una tarea compleja, el Orquestador evalúa la intención y usa la herramienta `call_expert` para delegar la tarea a uno de los siguientes especialistas:
- **Experto en Bases de Datos**: Especializado en la herramienta `db_query`, gestionar conexiones y consultar tablas.
- **Especialista en Archivos**: Maneja la lectura, escritura y eliminación de archivos.
- **Investigador Web**: Navega por internet para buscar documentación o extraer datos.
- **Sysadmin (Comandos)**: Un agente administrador de sistemas que ejecuta comandos de shell y monitorea la salida de la terminal.

## Memoria Unificada (Cerebro)
El "Cerebro" (Brain) es el sistema de memoria a largo plazo de GuLiN. Opera en dos frentes:
1. **Búsqueda Semántica (Auto-RAG)**: La herramienta `workspace_search` consulta una Base de Datos Vectorial local de tu código fuente indexado. Para indexar tu proyecto, ejecuta `wsh gulin index`.
2. **Conocimiento Persistente**: El agente puede guardar explícitamente hábitos, topologías de servidores y contexto del proyecto usando `brain_update` y recuperarlos vía `brain_search`. Estos datos se almacenan como archivos Markdown.
