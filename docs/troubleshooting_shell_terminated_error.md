# Troubleshooting: Shell Terminated (Exit Code 1)

## Descripción del Problema
Los usuarios pueden encontrarse con un error en la terminal de Gulin Agent que muestra `[shell terminated (exit code 1)]` inmediatamente después de intentar abrir una nueva pestaña de terminal o ejecutar un comando. En estos casos, la interfaz gráfica (UI) y el backend (`gulinsrv`) no pueden mantener la comunicación con el proceso de la shell.

Como consecuencia directa, el agente de Inteligencia Artificial falla silenciosamente o responde sin contenido de texto, ya que la herramienta de ejecución de comandos se queda sin una terminal subyacente para operar.

## Análisis de Logs
El análisis del archivo `gulinapp.log` durante la ocurrencia del error muestra el siguiente patrón:

1. **Conexión Inicial:** El servicio recibe una conexión de un socket de dominio (`got domain socket connection`).
2. **Autenticación Exitosa:** El enrutador `wshrouter` registra y autentica el enlace en milisegundos (`wshrouter authenticate-token success linkid=7`).
3. **Desconexión Inmediata:** Prácticamente en el mismo milisegundo (ej. `15:08:23.659` a `15:08:23.660`), el enlace se desenlaza y se cierra (`link recvloop done ... (unknown)` / `wshrouter unregister link`).

Esta rápida secuencia indica que el proceso `wsh` (Wave Shell Helper) se está cerrando o fallando abruptamente (crash) justo después de establecer la conexión inicial con el backend.

## Posibles Causas

1. **Conflictos de Arquitectura (Apple Silicon vs Intel):**
   Si la aplicación se está ejecutando en un Mac con procesador ARM (M1/M2/M3/M4) pero el binario compilado o descargado de `wsh` es para procesadores Intel (x64), el sistema operativo puede abortar la ejecución del proceso instantáneamente al no poder traducirlo correctamente o faltar Rosetta.

2. **Error en Scripts de Inicialización de la Shell:**
   El script de integración en `~/.zshrc` que invoca `GULIN_SHELL_RC` podría estar entrando en un bucle infinito, o el propio archivo de configuración local del usuario (`.zshrc`, `.bashrc`) contiene un comando `exit` o falla de una manera que fuerza el cierre (exit code 1) de la sesión de Zsh que Gulin intenta levantar.

3. **Permisos en Directorios Temporales:**
   El componente `wsh` necesita permisos de escritura para crear y comunicarse a través de sockets de dominio UNIX (típicamente en `/tmp` o directorios de usuario). Problemas de permisos pueden causar un error fatal en tiempo de ejecución.

## Siguientes Pasos Recomendados para Diagnóstico

*   **Verificar el binario `wsh`:** Ejecutar `file <ruta_al_binario_wsh>` para comprobar que la arquitectura coincide con la del sistema anfitrión (ej. `arm64` vs `x86_64`).
*   **Modo Seguro de Zsh:** Intentar desactivar temporalmente el script de integración en `~/.zshrc` comentando las líneas relacionadas a Gulin Shell Integration, y comprobar si una terminal pura logra abrirse.
*   **Captura de Errores Estándar (stderr):** Ejecutar el servidor de desarrollo (`npm run dev`) y observar el `dev_server.log` buscando mensajes de `panic:` o `runtime error:` originados por el proceso de la shell o el binario en Go.
