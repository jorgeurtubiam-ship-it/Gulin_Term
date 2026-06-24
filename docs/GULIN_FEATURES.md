# 🚀 GuLiN Terminal: Guía Maestra de Funcionalidades

Bienvenido a la documentación oficial de **GuLiN Terminal** (v2.0.2). Aquí detallamos todas las innovaciones y herramientas integradas para potenciar tu flujo de trabajo como ingeniero de elite.

---

## 🧠 1. Memoria Unificada (Gulin Brain)
El motor de inteligencia de GuLiN no solo responde, sino que **aprende y recuerda**.

*   **Auto-RAG Proactivo**: GuLiN realiza una búsqueda semántica automática en tus archivos de memoria cada vez que le hablas. No necesitas pedirle que busque; él ya tiene el contexto relevante inyectado en su mente.
*   **Directorio de Memoria**: Todos tus hábitos, lecciones y contextos se guardan en archivos Markdown en:
    `~/.config/gulin/gulin/` (macOS)
    `%APPDATA%/gulin/gulin/` (Windows)
*   **Herramientas de Memoria**:
    *   `brain_update`: Guarda nuevos conocimientos.
    *   `brain_list`: Lista todo lo que GuLiN sabe.
    *   `brain_search`: Búsqueda manual profunda por vectores.
*   **Embeddings Locales**: Utiliza `nomic-embed-text` a través de **Ollama** para una indexación 100% privada y local.

---

## 📊 2. Dashboards Interactivos Pro
Visualiza datos complejos con una estética premium directamente en tu terminal utilizando componentes avanzados de `recharts`.

*   **Tipos de Gráficos Soportados**:
    *   **Barras (`bar`)**: Comparaciones categóricas clásicas.
    *   **Líneas (`line`)**: Seguimiento de tendencias temporales.
    *   **Área (`area`)**: Visualización de volúmenes acumulados.
    *   **Pay (`pie`)**: Distribuciones proporcionales y porcentajes.
    *   **Radar (`radar`)**: Comparación de múltiples variables cuantitativas.
    *   **Compuesto (`composed`)**: Mezcla de barras y líneas en un solo gráfico.
    *   **Tabla (`grid`)**: Vista tabular optimizada para grandes volúmenes de datos.
*   **Funcionalidad de Exportación**:
    *   **Descarga PNG**: Cada dashboard incluye un botón de descarga para exportar el gráfico como una imagen de alta resolución con fondo optimizado.
*   **Configuración vía Metadatos**:
    *   `dashboard:type`: Define el tipo de gráfico (ej: "radar").
    *   `dashboard:title`: Título personalizado del dashboard.
    *   `dashboard:data`: JSON con los datos a representar.
*   **Persistencia y Estabilidad**: Los dashboards utilizan un modo de renderizado "congelado" que captura la primera ráfaga de datos válida, evitando bucles de actualización constantes y asegurando un rendimiento fluido.

---

## ⌨️ 3. Atajos de IA en el Terminal
GuLiN no es solo un chat lateral, está integrado en tu prompt de comandos.

*   **AI Command Completion (`#` + TAB)**:
    *   Escribe un comentario empezando con `#` (ej: `# check disk space`) y presiona **TAB**.
    *   La IA predecirá y escribirá automáticamente el comando correspondiente (ej: `df -h`).
*   **Ejecución Remota**: La IA puede ejecutar comandos en cualquier terminal abierto (con tu aprobación) usando `term_run_command`.

---

## 🔗 4. Conexiones y Modelos
Flexibilidad total para elegir tu motor de procesamiento.

*   **Soporte Multimodelo**:
    *   **Ollama (Local)**: Llama3.2, Phi3, etc. Optimizados con un parser de fallback para herramientas.
    *   **DeepSeek (V3/R1)**: Potencia masiva para tareas de arquitectura.
    *   **Gemini/Anthropic/OpenAI**: Conexión nativa con proveedores cloud.
*   **Conmutación en Caliente**: Puedes cambiar de modelo **sin perder el historial del chat**. La memoria es compartida entre todos los proveedores.
*   **Adiós a la Incompatibilidad**: Hemos eliminado las barreras que forzaban el reinicio del chat al cambiar de marca de IA.

---

## 🎨 5. Identidad Visual y Experiencia
*   **Rebranding Total**: La interfaz ha sido rediseñada para ser **GuLiN**, eliminando rastros de Gulin Terminal y la etiqueta BETA.
*   **Rendimiento Premium**: Transiciones suaves, soporte nativo para dark mode y micro-animaciones.
*   **Instaladores Nativos**:
    *   macOS: Imagen `.dmg` v2.0.2 optimizada para Apple Silicon e Intel.
    *   Windows: Instalador `.exe` v2.0.2 con fixes de estabilidad.

---

## 🛠️ 6. Herramientas de Sistema
*   **Captura de Pantalla**: La IA puede ver tu terminal literalmente usando `capture_screenshot` para ayudarte a depurar errores visuales.
*   **Gestión de Archivos**: Lectura, edición y creación de archivos con capacidades de búsqueda en todo el espacio de trabajo.

---

## 🌐 7. Navegador Web Agéntico (NUEVO)
GuLiN ahora interactúa dinámicamente con la web, no solo lee URLs, sino que "navega" por ellas.

*   **Ojos en la Web (`web_read_page`)**: La IA puede leer el contenido textual de cualquier pestaña del navegador abierta dentro de GuLiN. Ideal para resumir artículos o seguir tutoriales paso a paso.
*   **Acción Controlada**: La IA puede interactuar con el DOM de la página para ayudarte en flujos complejos:
    *   `web_click`: Presiona botones, enlaces o cajas de selección.
    *   `web_type`: Rellena formularios de búsqueda o campos de texto.
*   **Capa de Seguridad (User-in-the-Loop)**: Todas las acciones de clic o escritura **requieren tu aprobación manual** en el chat. GuLiN nunca enviará datos o hará clic sin tu permiso explícito.

---

---

## 🛑 8. Interrupción Universal y Reorientación Agéntica (ELITE)
GuLiN ahora es totalmente controlable. Se acabó el esperar a que una tarea errónea termine; ahora puedes corregir al agente en tiempo real.

*   **Lógica "Rewind & Merge"**: Si interrumpes al agente con un nuevo mensaje, GuLiN cancela la tarea actual, rebobina el historial y fusiona tu nueva instrucción con el contexto previo. Esto garantiza un reinicio suave y natural sin errores de protocolo (`400 Bad Request`).
*   **Cancelación Atómica de Herramientas**: Todas las herramientas de bajo nivel (Terminal, Web, RAG) están vinculadas al contexto de la sesión. Si detienes al agente, los procesos de terminal en espera y las lecturas web se cortan instantáneamente, liberando recursos y permitiendo una respuesta inmediata.
*   **Caso de Uso**: ¿Le pediste que analice todo el disco pero solo querías `/tmp`? Envía el mensaje correctivo a mitad de ejecución y GuLiN cambiará de rumbo al instante.

## 🚀 9. Optimización Extrema de Contexto y Tokens (NUEVO)
GuLiN v2.0.3 introduce mejoras críticas para maximizar la velocidad de respuesta y minimizar el consumo de tokens, especialmente en sesiones largas.

*   **Ventana de Memoria de Chat (Sliding Window)**:
    *   La IA ahora solo recibe el contexto de las **últimas 4 interacciones** (8 mensajes totales) del chat actual. Esto evita que el costo por mensaje escale exponencialmente y mantiene la respuesta ágil.
*   **Gestión Inteligente de Terminal**:
    *   **Límite de Contexto**: Cuando la IA consulta el terminal por defecto, solo se envían las últimas **20 líneas** del scrollback (antes 200). Esto inyecta solo la información necesaria.
    *   **No Repetición Redundante**: Se han ajustado todos los roles expertos para que **NO repitan los resultados del terminal** en el chat de texto si estos ya son visibles en el widget. Menos ruido, más precisión.
*   **Registro de Comandos de IA (AI History)**:
    *   Cada comando ejecutado por la IA se registra automáticamente en `~/.gulin/ai_history.sh`.
    *   Ideal para auditoría o para reutilizar comandos complejos orquestados por el agente.
*   **Respuestas Ultra-Concisas**:
    *   Los prompts de sistema han sido fortificados para eliminar preámbulos y conclusiones amigables innecesarias. La IA va directa al dato técnico.

---

*GuLiN Terminal: El futuro del desarrollo agentic está en tus manos.*
