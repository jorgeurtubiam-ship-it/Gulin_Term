---
id: dashboards
title: Dashboards y Analíticas
sidebar_position: 6
---

# Dashboards y Analíticas

GuLiN Terminal proporciona potentes capacidades analíticas integradas para visualizar métricas y el estado del sistema directamente desde el entorno de la terminal.

## Widgets Tsunami
Los widgets `tsunami` son componentes dedicados diseñados para ingerir flujos de datos y renderizarlos utilizando bibliotecas de gráficos modernas (como `recharts`). Se comunican directamente con el servidor local para obtener datos en tiempo real de bases de datos, APIs o procesos locales.

## Visualizaciones Integradas
- **Gráfico de CPU**: El widget `cpuplot` rastrea el uso de CPU en vivo a través de conexiones locales y remotas.
- **Métricas de Base de Datos**: Cuando está conectado a bases de datos externas a través de `db-connections.json`, el Experto en BD puede generar resúmenes visuales de los resultados de las consultas.

Los datos fluyen desde el backend (Go) a través de puentes gRPC y WebSocket hacia el frontend (React), asegurando baja latencia y animaciones fluidas.
