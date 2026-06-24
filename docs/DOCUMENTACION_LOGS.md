# Manual de Uso: Widget de Logs Universal (Depuración Real-Time)

Este manual explica cómo utilizar el nuevo **Widget de Logs Universal** para supervisar el comportamiento interno de GuLiN, con soporte para todas las herramientas y filtros personalizables.

## 1. ¿Qué es el Widget de Logs Universal?

Es una consola de depuración integrada que captura y muestra en tiempo real los eventos técnicos que ocurren "bajo el capó". A diferencia de los logs estándar, este widget te permite filtrar la información para que solo veas lo que te interesa en cada momento.

## 2. Cobertura Total de Herramientas

El widget ahora captura logs de **TODAS** las acciones del agente:

- **Terminal (`[TERM]`)**: Comandos ejecutados, errores de sintaxis y estados de salida.
- **API Manager (`[API]`)**: Llamadas `curl`, parámetros enviados y respuestas del servidor.
- **Archivos (`[FILE]`)**: Lectura, escritura, edición y borrado de archivos.
- **Base de Datos (`[DB]`)**: Consultas SQL enviadas y resultados de conexión.
- **IA y Memoria (`[IA]`)**: Detalles de construcción del prompt, recortes por límite de contexto y uso de tokens.

## 3. Cómo Usar los Filtros de Usuario

En la parte superior del Widget de Logs, encontrarás una barra de filtros con botones (Pills). Puedes activarlos o desactivarlos según tu necesidad:

- **Ejemplo 1**: Si solo quieres ver qué archivos está tocando el agente, deja activado solo el botón **[Archivos]**.
- **Ejemplo 2**: Si estás depurando una integración con Dremio, activa **[API]** y **[DB]**.
- **Ejemplo 3**: Activa **[IA]** si quieres ver por qué el agente está "olvidando" cosas (logs de recortes de contexto).

## 4. Guía de Colores de Categorías

Para facilitar la lectura rápida, cada log tiene una etiqueta de color:
- <span style="color: #3b82f6;">●</span> **API**: Azul (Comunicaciones externas)
- <span style="color: #10b981;">●</span> **Terminal**: Verde (Comandos locales)
- <span style="color: #f59e0b;">●</span> **Archivos**: Naranja (Sistema de archivos)
- <span style="color: #8b5cf6;">●</span> **IA**: Púrpura (Razonamiento y contexto)
- <span style="color: #ef4444;">●</span> **Sistema**: Rojo (Errores críticos)

## 5. Funciones de Productividad

- **Autoscroll**: El widget se desplaza automáticamente hacia abajo con cada nuevo log.
- **Limpiar Consola**: Usa el icono de la papelera para vaciar la vista y empezar de cero.
- **Copiar Log**: Haz clic en cualquier línea para copiar el contenido técnico (ideal para copiar comandos `curl` complejos).

---
*Gulin Agentic Environment - Sistema de Observabilidad Total*
