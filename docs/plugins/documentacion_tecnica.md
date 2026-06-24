# ⚙️ Documentación Técnica: Sistema de Plugins

## Arquitectura
El sistema de plugins utiliza un motor híbrido:
1.  **Backend (Go)**: Un cargador que utiliza la librería **Goja** para interpretar Javascript.
2.  **Frontend (React)**: Un administrador visual que se comunica vía REST API con el servidor de Gulin.

## Componentes Clave
- **PluginLoader**: Escanea `~/.config/gulin-dev/plugins/` cada vez que se inicia una sesión de chat o se guarda un plugin.
- **Metadata Parser**: Extrae los tags `@name` y `@description` para registrar las herramientas en el `ToolCatalog` de Gulin.
- **Bridge Context**: Inyecta funciones nativas de Go (API, DB, Terminal) en el entorno global del script de JS de forma segura.

## Ciclo de Vida
1. **Detección**: Se encuentra un archivo `.js` en el directorio.
2. **Validación**: Se comprueba que tenga los metadatos mínimos y la función `execute`.
3. **Registro**: Se añade como una `ToolDefinition` disponible para el modelo de lenguaje (Gemini, GPT, etc.).
4. **Ejecución**: Cuando la IA decide usar la herramienta, el motor de Goja crea una instancia, inyecta el bridge y ejecuta la función `execute`.

## Endpoints de Gestión
- `GET /gulin/plugin-list`: Lista archivos `.js`.
- `GET /gulin/plugin-read`: Obtiene el contenido de un script.
- `POST /gulin/plugin-save`: Guarda o actualiza un archivo.
- `POST /gulin/plugin-delete`: Elimina un archivo.
