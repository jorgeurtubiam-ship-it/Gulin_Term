# GuLiN: Manual de Usuario
**Versión:** 2.0.3
**Fecha:** 21 de Mayo de 2026

---

## 1. Resumen Ejecutivo
GuLiN es una plataforma de terminal inteligente (AI-Native) diseñada para orquestar flujos de trabajo técnicos, unificando la ejecución de comandos (CLI), la gestión de infraestructura y la búsqueda semántica en un entorno persistente y visual.

## 2. Requisitos del Sistema
- **Sistema Operativo:** macOS 14+ (recomendado).
- **Entorno:** App instalada bajo `/Applications/GuLiN.app` (o equivalente).
- **IA Local:** Ollama instalado y configurado para modelos de embeddings.
- **Conectividad:** Acceso a internet para actualizaciones de plugins y modelos.

## 3. Instalación y Configuración Inicial
1.  **Ejecución:** Inicie la aplicación desde su carpeta de aplicaciones.
2.  **Configuración de API:** Acceda a la sección "API Manager" en la interfaz para configurar sus tokens de servicios externos (AWS, proveedores de IA, bases de datos).
3.  **Indexación:** En la terminal integrada, ejecute `wsh gulin index` para permitir que el agente aprenda la estructura de su proyecto. Este proceso puede tardar unos minutos dependiendo del tamaño del código.

## 4. Guía de Operaciones
### 4.1. Terminal Inteligente
La terminal soporta comandos nativos de `zsh`. Además, puede invocar al agente mediante lenguaje natural para:
- Explicar errores de ejecución.
- Generar scripts de automatización.
- Analizar logs complejos.

### 4.2. Brain Map (Mapa 3D)
Visualización en tiempo real de su infraestructura.
- **Nodos:** Representan servidores, bases de datos o instancias en la nube.
- **Interacción:** Haga clic en cualquier nodo para obtener metadatos detallados, estado de salud y conexiones activas.

### 4.3. Búsqueda Semántica
Utilice el comando `search` o la interfaz de búsqueda para localizar conceptos, configuraciones o funciones dentro de su código fuente sin necesidad de conocer la ruta exacta.

## 5. Automatización (Plugins)
GuLiN es extensible. Puede añadir scripts en la carpeta `~/.gulin/plugins/`.
- **Formato:** Archivos `.js` con estructura definida (ver documentación técnica para desarrolladores).
- **Ejecución:** Los plugins se cargan dinámicamente sin reiniciar la aplicación.

## 6. Resolución de Problemas (Troubleshooting)

| Problema | Causa Probable | Solución |
| :--- | :--- | :--- |
| `stream decode error` | Interrupción en la comunicación entre el motor de IA y la UI. | Inicie un nuevo chat. Si persiste, reinicie GuLiN. |
| Búsqueda semántica sin resultados | Índice no generado o corrupto. | Ejecute `wsh gulin index` en la terminal. |
| Terminal no muestra output | Error de renderizado del widget. | Cierre y reabra el widget de terminal. |
| Conexión a DB fallida | Credenciales incorrectas o red. | Verifique `db_list_connections` y pruebe la conexión. |

## 7. Soporte Técnico
Para reportar errores o solicitar nuevas funcionalidades, contacte a nuestro equipo de soporte técnico a través del portal de clientes o abra un issue directamente desde el sistema si está habilitado.
