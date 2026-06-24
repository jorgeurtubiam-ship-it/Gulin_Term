---
id: service-map
title: Mapa de Servicios y Archivos Editables
sidebar_position: 5
---

# Mapa de Servicios y Archivos Editables

GuLiN Terminal depende de varios archivos JSON críticos para mapear la topografía de tu flujo de trabajo. Estos archivos son altamente editables y residen en tu directorio de configuración (generalmente `~/.config/gulin` o `%APPDATA%/gulin/config`).

## Archivos de Configuración Principales
1. **`gulin.config.json`**: El archivo de configuración maestro. Dicta dónde se almacenan los plugins, bases de datos, logs y cachés en macOS, Linux y Windows.
2. **`connections.json`**: Almacena tus conexiones SSH. Puedes definir hostnames, usuarios, puertos y archivos de identidad. Las conexiones definidas aquí aparecen en el gestor de conexiones de la terminal.
3. **`db-connections.json`**: Mapea todas tus conexiones a bases de datos (PostgreSQL, SQLite, Oracle, etc.). Es utilizado por el **Experto en Bases de Datos** para ejecutar consultas autónomas.
4. **`api-manager.json`**: Un registro de APIs externas, incluyendo credenciales (tokens, usuarios) y prompts de sistema específicos necesarios para interactuar con ellas (ej. Dremio, GitHub API).
5. **`brain-map.json`**: Un mapa visual y estructural de tu infraestructura. Define nodos (como instancias EC2 de AWS, contenedores Docker, bases de datos) y cómo se conectan entre sí.

> **Consejo:** Puedes editar estos archivos manualmente de forma segura para configurar rápidamente tu entorno en una máquina nueva.
