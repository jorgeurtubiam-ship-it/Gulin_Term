---
id: exhaustive-features
title: Lista Exhaustiva de Funcionalidades
sidebar_position: 8
---

# Lista Exhaustiva de Funcionalidades

Más allá de las características estándar, GuLiN Terminal incluye herramientas internas especializadas que potencian el ecosistema agéntico:

## Herramientas de Gestión de Archivos
- `read_dir`, `read_text_file`, `write_text_file`, `edit_text_file`, `delete_text_file`.

## Herramientas de Control de Terminal
- `term_run_command`: Ejecuta comandos de forma síncrona o asíncrona.
- `term_command_output`: Obtiene la salida en tiempo real de los comandos en ejecución.
- `term_get_scrollback`: Analiza las salidas previas de la shell para diagnosticar errores.
- `term_search`: Busca texto dentro del buffer activo de la terminal.

## Herramientas de Base de Datos y API
- `db_query`: Ejecuta consultas SQL seguras en BD registradas.
- `db_list_connections`, `db_register_connection`, `db_test_connection`, `db_delete_connection`.
- `apimanager_list`, `apimanager_call`, `apimanager_register`, `apimanager_delete`.

## Ecosistema de Plugins
- `plugin_list`, `plugin_save`, `plugin_delete`, `plugin_debug`: Se utilizan para inyectar dinámicamente nuevos comportamientos o herramientas en el entorno.
