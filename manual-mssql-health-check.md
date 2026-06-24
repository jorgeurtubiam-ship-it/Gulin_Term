# 🏥 Manual de Uso — Plugin `mssql_health_check`

**Versión:** 1.0  
**Propósito:** Diagnóstico completo de salud para bases de datos SQL Server migradas (2005 → 2022+).  
**Creado por:** GuLiN Agent tras análisis real de BD `fin_demo`, `man_demo` y `carner_nu_prod`.

---

## 📋 Índice

1. [Descripción General](#1-descripción-general)
2. [Requisitos](#2-requisitos)
3. [Parámetros](#3-parámetros)
4. [Modos de Uso](#4-modos-de-uso)
5. [Ejemplos Prácticos](#5-ejemplos-prácticos)
6. [Interpretación de Resultados](#6-interpretación-de-resultados)
7. [Acciones Recomendadas por el Plugin](#7-acciones-recomendadas-por-el-plugin)
8. [Resolución de Problemas](#8-resolución-de-problemas)
9. [Mantenimiento Programado](#9-mantenimiento-programado)

---

## 1. Descripción General

El plugin ejecuta **6 análisis** en la base de datos objetivo:

| # | Módulo | Qué detecta |
|---|--------|-------------|
| 1 | **Compatibility** | Nivel de compatibilidad vs versión del motor SQL |
| 2 | **Tables** | Tablas HEAP, sin índices, vacías, top por filas |
| 3 | **Fragmentation** | Índices con >30% (REBUILD) y 5-30% (REORGANIZE) |
| 4 | **Queries** | Top 15 queries más pesadas por tiempo total |
| 5 | **Missing Indexes** | Índices sugeridos por el optimizador |
| 6 | **Recommendations** | Genera acciones concretas ordenadas por prioridad |

---

## 2. Requisitos

- GuLiN Agent con conexión SQL Server registrada
- La conexión debe tener permisos para leer `sys.dm_*` DMVs
- Permisos mínimos: `VIEW SERVER STATE` + `SELECT` en tablas del sistema

### Conexiones recomendadas

```
carner_nu_prod        → BD productiva (ya registrada)
fin_demo              → BD financiera demo
man_demo              → BD manufactura demo
```

> **Nota:** Si la BD no está registrada como conexión independiente, puedes usar una conexión existente y especificar el parámetro `db`.

---

## 3. Parámetros

| Parámetro | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `connection` | string | `carner_nu_prod` | Nombre de la conexión registrada en GuLiN |
| `db` | string | *vacío* (todas) | Base de datos específica a analizar |
| `action` | string | `all` | Módulo a ejecutar (ver tabla abajo) |

### Valores de `action`

| Valor | Ejecuta |
|-------|---------|
| `all` | Los 6 módulos completos |
| `compatibility` | Solo nivel de compatibilidad y config |
| `tables` | Solo inventario de tablas |
| `fragmentation` | Solo fragmentación de índices |
| `queries` | Queries pesadas + índices faltantes |
| `recommendations` | Solo genera recomendaciones (requiere datos previos) |

---

## 4. Modos de Uso

### 4.1. En el Chat (recomendado)

```
@mssql_health_check connection=carner_nu_prod db=fin_demo
```

### 4.2. Análisis completo de una BD

```
@mssql_health_check connection=carner_nu_prod db=man_demo action=all
```

### 4.3. Solo fragmentación

```
@mssql_health_check connection=carner_nu_prod db=fin_demo action=fragmentation
```

### 4.4. Solo queries pesadas

```
@mssql_health_check connection=carner_nu_prod db=fin_demo action=queries
```

### 4.5. Todas las BD del servidor

```
@mssql_health_check connection=carner_nu_prod
```

(Sin `db` analiza todas las BD de usuario)

---

## 5. Ejemplos Prácticos

### ⚙️ Ejemplo 1: Diagnóstico inicial post-migración

```bash
@mssql_health_check connection=carner_nu_prod db=fin_demo
```

**Salida esperada:**
```
🏥 MSSQL Health Check Plugin
   Conexión: carner_nu_prod
   BD: fin_demo
   Acción: all

═══════════════════════════════════════════
  📊 CONFIGURACIÓN GENERAL
═══════════════════════════════════════════
DatabaseName: fin_demo
CompatLevel: 160 → SQL 2022 ✅
State: ONLINE
RCSI: OFF (recomendado activar)
...
═══════════════════════════════════════════
  🎯 RECOMENDACIONES
═══════════════════════════════════════════
✅ Compatibilidad SQL 2022 (160) — correcta
🟡 [MEDIO] 12 tablas HEAP con datos. Agregar clustered index.
🔴 [ALTO] 3 índices requieren REBUILD (>30% fragmentación).
...
```

### ⚙️ Ejemplo 2: Monitoreo rápido semanal

```bash
@mssql_health_check connection=carner_nu_prod db=fin_demo action=fragmentation
```

### ⚙️ Ejemplo 3: Verificar compatibilidad de todas las BD

```bash
@mssql_health_check connection=carner_nu_prod action=compatibility
```

---

## 6. Interpretación de Resultados

### 🔴 Niveles de Severidad

| Icono | Significado | Acción requerida |
|-------|-------------|------------------|
| 🔴 **CRÍTICO** | Impacto alto en rendimiento | Resolver ASAP |
| 🟡 **MEDIO** | Problema que empeorará con el tiempo | Programar fix |
| 🟠 **BAJO** | Mejora opcional | Evaluar |
| ✅ | Correcto | Nada |

### 📊 Compatibilidad

| CompatLevel | Interpretación |
|-------------|----------------|
| 160 | ✅ SQL 2022 — óptimo |
| 150 | ✅ SQL 2019 — aceptable |
| 140 | 🟡 SQL 2017 — desactualizado |
| 130 o menor | 🔴 Crítico — perder rendimiento y features |

### 🔧 Fragmentación

| % Fragmentación | Acción |
|-----------------|--------|
| 0% - 5% | ✅ OK |
| 5% - 30% | 🟡 REORGANIZE (online, no bloquea) |
| >30% | 🔴 REBUILD (puede bloquear, programar en ventana) |

### ⚡ Queries Pesadas

Las queries listadas son las que más **tiempo acumulado** tienen en el caché de planes. Prioriza revisar:

- Queries con muchas **lecturas lógicas** (TotalLecturas)
- Queries con alto **promedio por ejecución** (PromedioSeg)
- Queries con **TABLE SCAN** en tablas grandes

### 🔍 Índices Faltantes

El motor sugiere índices basado en las consultas ejecutadas. El campo `Impacto` indica el % de mejora potencial. Validar antes de crear:

- No crear índices duplicados
- No crear más de 5-10 índices por tabla
- Revisar que las columnas `Include` no sean demasiadas

---

## 7. Acciones Recomendadas por el Plugin

El plugin genera estas recomendaciones automáticamente. Aquí cómo ejecutarlas:

### 7.1. Subir compatibilidad (si detecta < 160)

```sql
ALTER DATABASE [fin_demo] SET COMPATIBILITY_LEVEL = 160;
ALTER DATABASE [man_demo] SET COMPATIBILITY_LEVEL = 160;
```

**Riesgo:** Bajo. Reversible. Puede cambiar planes de ejecución.

### 7.2. REBUILD de índices fragmentados

```sql
ALTER INDEX [NombreIndice] ON [Schema].[Tabla] REBUILD;
```

**¿Online?** Solo en Enterprise Edition. Si no, programa en ventana de mantenimiento.

### 7.3. REORGANIZE de índices

```sql
ALTER INDEX [NombreIndice] ON [Schema].[Tabla] REORGANIZE;
```

**Siempre online** — no bloquea.

### 7.4. Agregar clustered index a HEAP

```sql
ALTER TABLE [Schema].[Tabla] ADD CONSTRAINT PK_Tabla PRIMARY KEY CLUSTERED (IdColumna);
```

### 7.5. Activar RCSI (Snapshot Isolation)

```sql
ALTER DATABASE [fin_demo] SET ALLOW_SNAPSHOT_ISOLATION ON;
ALTER DATABASE [fin_demo] SET READ_COMMITTED_SNAPSHOT ON;
```

**Beneficio:** Elimina bloqueos lectura/escritura.

### 7.6. Activar Accelerated Database Recovery

```sql
ALTER DATABASE [fin_demo] SET ACCELERATED_DATABASE_RECOVERY = ON;
```

**Beneficio:** Rollback instantáneo de transacciones largas.

### 7.7. Activar Query Store

```sql
ALTER DATABASE [fin_demo] SET QUERY_STORE = ON (OPERATION_MODE = READ_WRITE);
```

---

## 8. Resolución de Problemas

### Error: "No se puede conectar"

```
❌ Error: db ping failed: connection refused
```

**Causa:** La URL de conexión no es correcta o el servidor no está accesible desde esta máquina.

**Solución:** Usar una conexión que ya funcione (ej. `carner_nu_prod`) y especificar `db=nombre_bd`.

### Error: "No se encontraron queries"

```
Top 15 queries más pesadas: [] (vacío)
```

**Causa:** El servidor se reinició recientemente o el plan cache se limpió (`DBCC FREEPROCCACHE`).

**Solución:** Las queries aparecerán después de ejecutar consultas en producción. No es un error.

### Error: "Permiso denegado en DMV"

```
❌ Error: The SELECT permission was denied on the object 'dm_exec_query_stats'
```

**Causa:** El usuario de conexión no tiene `VIEW SERVER STATE`.

**Solución:** Conceder permiso:
```sql
GRANT VIEW SERVER STATE TO [usuario];
```

### Error: Plugin no listado

```
❌ Plugin 'mssql_health_check' no encontrado
```

**Causa:** El plugin se guardó pero no se refrescó la lista.

**Solución:** Esperar al próximo turno o ejecutar `@plugin_list` para recargar.

---

## 9. Mantenimiento Programado

### Rutina recomendada

| Frecuencia | Acción | Plugin Command |
|------------|--------|----------------|
| **Diario** | Monitoreo rápido de fragmentación | `action=fragmentation` |
| **Semanal** | Queries pesadas + missing indexes | `action=queries` |
| **Mensual** | Diagnóstico completo de salud | `action=all` |

### Script de ejemplo para automatización

```bash
#!/bin/bash
# health_check_weekly.sh
# Ejecutar cada lunes 8:00 AM

gulin "mssql_health_check connection=carner_nu_prod db=fin_demo action=queries"
gulin "mssql_health_check connection=carner_nu_prod db=man_demo action=queries"
gulin "mssql_health_check connection=carner_nu_prod action=compatibility"
```

---

## 📝 Notas Finales

- El plugin **no modifica nada** en la base de datos — solo lee información de DMVs
- Los resultados pueden variar si el servidor se reinicia (pérdida del plan cache)
- Para BD muy grandes (>1TB), los queries de fragmentación pueden demorar
- Las recomendaciones son genéricas — validar siempre en ambiente de pruebas antes de aplicar en producción

---

> **Plugin desarrollado durante análisis real de migración SQL 2005 → SQL 2025**  
> Bases analizadas: `fin_demo`, `man_demo`, `carner_nu_prod`  
> Creado por GuLiN Agent — Última actualización: 2025
