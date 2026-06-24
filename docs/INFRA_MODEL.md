# Modelo de Datos Universal - Gulin Infrastructure

Este documento define el esquema maestro para la persistencia de infraestructura en Gulin. El objetivo es ser **agnóstico** a la fuente de datos (AWS, RVTools, O365, etc.).

## 1. Tabla `infra_nodes`

Representa los elementos individuales de la infraestructura.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | TEXT (PK) | Identificador único (ej: `aws-i-12345`). |
| `label` | TEXT | Nombre legible para el usuario. |
| `type` | TEXT | Categoría (server, db, bucket, mailbox, etc.). |
| `status` | TEXT | Estado actual (online, offline, warning). |
| `icon` | TEXT | Emoji o identificador de icono. |
| `x`, `y` | INTEGER | Coordenadas para el mapa (opcional). |
| `description` | TEXT | Resumen textual opcional. |
| `parent_id` | TEXT | ID del nodo padre (jerarquía). |
| `xp_value` | INTEGER | Puntos de experiencia asociados al nodo. |
| `node_group` | TEXT | Agrupación lógica (ej: "Producción", "VPC-A"). |
| `status_color` | TEXT | Color hexadecimal para el estado. |
| `metadata` | TEXT (JSON) | **CAMPO UNIVERSAL**. Almacena todos los detalles técnicos específicos. |

### Ejemplo de Metadata (AWS):
```json
{
  "instance_id": "i-0987654321",
  "private_ip": "10.0.0.5",
  "instance_type": "t3.medium",
  "region": "us-east-1"
}
```

## 2. Tabla `infra_edges`

Representa las conexiones y flujos entre nodos.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER (PK) | Auto-incremental. |
| `source` | TEXT | ID del nodo origen. |
| `target` | TEXT | ID del nodo destino. |
| `traffic` | TEXT | Descripción del flujo (ej: "HTTP", "SQL"). |

---
*Ultima actualización: 2026-05-14*
