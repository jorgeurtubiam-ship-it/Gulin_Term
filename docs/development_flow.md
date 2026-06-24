# Guía de Desarrollo para GuLiN Agent

Esta guía proporciona las instrucciones necesarias para configurar el entorno de desarrollo, compilar y ejecutar GuLiN Agent desde el código fuente.

## Requisitos Previos

- **Go**: v1.23 o superior para el backend.
- **Node.js**: v20 o superior para el frontend.
- **Task**: Una herramienta de ejecución de tareas (similar a `make`) que facilita la automatización del proyecto.

## Comandos Principales (`Taskfile`)

El proyecto utiliza un `Taskfile.yml` para centralizar todos los comandos de desarrollo.

### Iniciar el Entorno de Desarrollo (Recomendado)
Para ejecutar la aplicación con recarga automática (*Hot Reloading*) en el frontend y recarga del servidor Go:
```bash
task dev
```
Este comando:
1. Instala dependencias de npm.
2. Compila el backend de Go.
3. Inicia el servidor de desarrollo de Vite.
4. Lanza la aplicación Electron.

### Compilación Completa
Para generar los binarios de producción para el servidor:
```bash
task build:server
```
Los binarios se generarán en la carpeta `dist/bin/`.

### Gestión del Frontend
Si solo necesitas trabajar en la interfaz:
```bash
cd frontend
npm run dev
```

## Flujo de Trabajo Típico

1.  **Modificar el Backend**: Los archivos de Go están en `pkg/`. Tras realizar cambios, el comando `task dev` detectará la modificación y reiniciará el servidor.
2.  **Modificar el Frontend**: Los cambios en archivos `.tsx` o `.scss` se reflejarán instantáneamente en la aplicación gracias a Vite HMR.
3.  **Añadir Nuevas Herramientas**:
    - Crea un nuevo archivo en `pkg/aiusechat/tools_[nombre].go`.
    - Registra la herramienta en la lista de capacidades del agente.
    - Reinicia el proceso `task dev`.

## Variables de Entorno

El sistema busca un archivo `.env` en el directorio raíz. Las variables clave son:
- `GULIN_BRIDGE_URL`: URL del microservicio Bridge.
- `GULIN_ENVFILE`: Ruta al archivo de configuración de entorno.
- `GULIN_NOCONFIRMQUIT`: Desactiva la confirmación al cerrar la app (útil en dev).

## Solución de Problemas

- **Errores de Compilación de Go**: Asegúrate de que `go.mod` esté actualizado ejecutando `go mod tidy`.
- **Problemas con Electron**: Si la ventana no abre o muestra una pantalla blanca, revisa los logs en la terminal donde ejecutas `task dev`.
- **Caché**: En ocasiones es necesario limpiar la carpeta `dist` antes de una compilación limpia.
