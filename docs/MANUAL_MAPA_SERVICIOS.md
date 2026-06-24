# 🌐 Mapa de Servicios Gulin — Documentación Completa

## 📖 1. Introducción

El **Mapa de Servicios** es una herramienta de observabilidad premium diseñada para visualizar en tiempo real todos los recursos (Contenedores, VMs, Instancias Cloud) que Gulin detecta en tu entorno, así como las conexiones, dependencias y flujos de datos entre servidores y servicios (Dremio, Oracle, API Gateways, etc.).

---

## 🚀 2. Métodos de Acceso

Puedes abrir la ventana del mapa de tres maneras diferentes:

### A. Comandos de Chat (Slash Commands)
Escribe cualquiera de estos comandos en el chat principal de Gulin:
- `/mapa`
- `/map`

### B. Botón en el Panel de Gulin AI
En la parte superior derecha del chat, encontrarás un icono de red (`network-wired`). Al pulsarlo, se abrirá la ventana dedicada.

### C. Botón en el Panel de Logs
Si tienes abierto el panel de **Logs de Depuración**, encontrarás un botón azul etiquetado como **"Mapa"** junto al botón de limpieza.

---

## 🎮 3. Navegación e Interacción

La ventana del mapa es totalmente interactiva:

- **Zoom**: Utiliza la rueda del ratón o gestos de zoom en el trackpad para acercarte o alejarte.
- **Pan (Arrastre)**: Haz clic izquierdo en el fondo y arrastra para moverte por el lienzo.
- **Mover Tarjetas**: Haz clic sostenido en cualquier tarjeta para reposicionarla. El mapa recordará la posición exacta la próxima vez que lo abras.
- **Detalles del Nodo**: Haz clic simple (sin arrastrar) sobre una tarjeta para abrir el **Panel de Detalles**. Aquí verás el ID técnico, el origen y la descripción completa.
- **Hover**: Al pasar el ratón sobre un nodo, este se iluminará para mostrar que es interactivo.

---

## 📊 4. Organización Automática

El mapa agrupa los recursos automáticamente en 4 zonas delimitadas:
1. **DOCKER CONTAINERS**: Contenedores detectados localmente o vía Bridge.
2. **AWS INFRASTRUCTURE**: Instancias EC2, IPs estáticas y recursos de la nube.
3. **VIRTUALBOX VMs**: Máquinas virtuales locales.
4. **LOCAL HOST**: Servicios que corren directamente en el host.

---

## 🎨 5. Indicadores Visuales

| Elemento | Significado |
| :--- | :--- |
| **Líneas de Flujo Animadas** | Representan el tráfico de red activo entre servicios. |
| **Pulsos de Luz** | La velocidad del pulso indica la intensidad del tráfico (Alto/Bajo). |
| **🟢 Online/Active** | La tarjeta brilla con un contorno índigo y muestra estado "Running" o "Active". |
| **⚪ Offline/Stopped** | La tarjeta se vuelve opaca y el borde se oscurece. |
| **Iconos de Nodo** | Cada servicio tiene un icono único (BD, Servidor, App, Router). |

---

## 🛠️ 6. Documentación Técnica (Arquitectura)

### Stack Tecnológico
- **Frontend**: React (TSX) + Tailwind CSS + Lucide Icons.
- **Motor de Mapa**: `react-zoom-pan-pinch` para el lienzo infinito.
- **Backend**: Go (wshserver) con puente SQLite directo.

### Persistencia y Datos (SQLite)
El mapa lee y escribe directamente en la tabla `infra_nodes` de la base de datos de Gulin.

**Esquema de la tabla `infra_nodes`:**
| Columna | Tipo | Descripción |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | Identificador único (ej: `docker-xyz`, `aws-123`). |
| `label` | TEXT | Nombre legible para la UI. |
| `type` | TEXT | Categoría (Container, VM, etc.). |
| `status` | TEXT | Estado actual (running, stopped). |
| `x`, `y` | INTEGER | Coordenadas espaciales persistentes. |
| `parent_id`| TEXT | ID del grupo padre (source-docker, source-aws, etc.). |
| `icon` | TEXT | Nombre del icono de FontAwesome. |

### Comunicación RPC (SQL Bridge)
Para evitar crear nuevos endpoints de API, se ha sobrecargado el comando `PathCommand` en el servidor Go. Si el comando comienza con el prefijo `sql:`, el servidor ejecuta la consulta directamente en SQLite y devuelve el resultado en formato JSON.

**Ejemplo de Guardado de Posición:**
```typescript
await RpcApi.PathCommand(TabRpcClient, {
    pathType: `sql:UPDATE infra_nodes SET x = ${x}, y = ${y} WHERE id = '${id}'`,
    tabId: model.tabModel.tabId
});
```

### Lógica de Drag & Drop con Zoom
El arrastre se calcula en un subcomponente (`ServiceMapContent`) para acceder al contexto del zoom. La fórmula para que el movimiento sea 1:1 con el ratón es:
`Desplazamiento_Mapa = Desplazamiento_Pantalla / Nivel_Zoom`

### Auto-Agrupación
Si un nodo no tiene coordenadas (`x=0, y=0`), el mapa aplica un algoritmo de distribución inicial basado en el prefijo del ID:
- `vbox-` → VirtualBox
- `aws-` → AWS
- `docker-` → Docker

---

## 🚀 7. Próximos Pasos Recomendados
1. **Edges dinámicos**: Permitir dibujar conexiones manuales entre tarjetas para definir dependencias de red.
2. **Snap-to-Grid**: Implementar un imán de rejilla para que las tarjetas queden perfectamente alineadas al soltarlas.
3. **Filtros**: Añadir un buscador para localizar nodos rápidamente en mapas de gran escala (+100 nodos).
4. **Motor de Descubrimiento**: Conexión a datos de red reales obtenidos vía SSH desde servidores pivot.

---

*GuLiN Agent — Visual Infrastructure Intelligence v2.0*
