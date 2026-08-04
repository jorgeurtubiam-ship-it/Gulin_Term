# 🔷 GUILN 2.1 — PLAN MAESTRO ÚNICO Y CONSOLIDADO (para retomar en otra sesión)

> Este archivo es el ÚNICO punto de entrada para continuar el proyecto en otra sesión.
> Conserva TODO lo hablado. La sesión nueva debe leer este archivo COMPLETO antes de tocar código.

Fecha de creación: 2026-08-04. Autor: sesión principal (GuLiN + usuario lordzero1).
Estado: pendiente de ejecución. NO iniciar sin completar la FASE A (backup).

---

## ⚠️ REGLA DE ORO N°1 — NOMBRES DE PRODUCTOS DE TERCEROS
El nombre comercial del benchmark web multi-agente de datos que inspira este rediseño
**NO debe aparecer en ninguna parte** del código de gulin-term ni de la memoria del proyecto:
ni en código fuente, comentarios, nombres de archivo, variables, componentes, docs, README, ni memoria .md.
Usar SIEMPRE referencias neutras: "patrón DocGen", "chat moderno de documentos", "benchmark IA-datos".
(Verificado: el código de gulin-term está limpio. Residuos solo en la DB interna de GuLiN, NO son el producto.)

## ⚠️ REGLA DE ORO N°2 — SEGURIDAD ANTES DE TOCAR CÓDIGO
- NUNCA modificar gulin-term sin correr primero la FASE A (backup).
- NO versionar: node_modules/, dist/, build/, .git, test.db, test_sqlite.go.
- Respetar 2 archivos con trabajo real SIN commitear: frontend/app/aipanel/aipanelinput.tsx y aitooluse.tsx.

---

# FASE A — RED DE SEGURIDAD (obligatoria)
1. Backup físico en ~/Gulin_Workspace/backups/gulin-term-safe-<fecha>/ (excluir node_modules, dist, .git, build/gulin-server, test.db, test_sqlite.go).
2. INCLUIR los 2 archivos sin commitear: aipanelinput.tsx, aitooluse.tsx.
3. Commit checkpoint "estado estable antes de rediseño del chat" en rama main.
4. Copiar este plan a /Users/lordzero1/Gulin_Workspace/ideas/gulin-term/.

# FASE B — REDISEÑO DEL CHAT (prioridad #1)
## B1. Fix SCROLL — frontend/app/aipanel/aipanelmessages.tsx
- Eliminar doble auto-scroll (followOutput="smooth" + requestAnimationFrame loop).
- Detectar scroll manual del usuario hacia arriba → NO empujar al fondo durante streaming.
- Manejar dummy {id:"last-message"} sin desestabilizar data de Virtuoso.
- Scroll estable (scrollTop=scrollHeight) o Virtuoso corregido.

## B2. Barra DocGen debajo del input (patrón de chat moderno de documentos)
- Toggle "Visual BI" (icono gráfico barras).
- Selector "Sample / Full data" (DocScope): sample~100 rows preview, full~50k.
- Selector "Browser·fast / Deep·slow" (DocGenMode).
- Botones PPT / Word / Excel (click arma formato → describe en chat → Enter genera+descarga).

## B3. Gráfico BI inline en mensaje assistant
- Reutilizar recharts + DashboardView (dashboard.tsx). Visual BI ON + respuesta con datos → gráfico inline + SQL fuente + narrativa basada en datos reales.
- Multi-visual con split (chatBiSplit, MAX_CHAT_VISUALS).

## B4. Export en cada mensaje assistant: CSV / XLSX / PNG inline.

## B5. Selector de modelo/catálogo + Ollama local (reutilizar use-provider-models.ts / use-ollama-models.ts, marcar gratis Ollama).

## B6. Flujo columnar: separar actividad/tools de la respuesta.

### Librerías
- ✅ ya: recharts, xlsx, papaparse, @tanstack/react-table, @observablehq/plot, react-virtuoso, streamdown.
- ❌ instalar: pptxgenjs (PPT), docx (Word).

### Referencias de implementación (patrón neutro interno)
- lib/chatBi.ts (generateChatWidget → narrative+widgets), lib/chatBiSplit.ts (scope sample/full), lib/docGen/* (DocFormat/DocScope/DocGenMode), lib/presentations.ts (PPT).
- components/playground/MarkdownMessage.tsx.
- components/swarms/SwarmChatDialog.tsx (scroll sano: scrollTop=scrollHeight).

# FASE C — FEATURES DE ESCALA (roadmap 2.1)
- C1 🔴 Swarm canvas visual con FLUJO REAL de datos entre nodos + inspector lateral + nodos router/condition/loop/foreach/evaluate/extract + edges etiquetados + RunPanel. (Ya tienes @xyflow/react ^12.11.2.) Esfuerzo MEDIO.
- C2 🔴 Conectores: ClickHouse, MariaDB, TimescaleDB. Esfuerzo MEDIO.
- C3 🟠 Data catalog + detección PII (Ley 21719/21595). Esfuerzo ALTO.
- C4 🟠 Secrets Manager + {{secret:NAME}} + IAM. Esfuerzo MEDIO.
- C5 🟠 Execution traces viewer + costos por proveedor. Esfuerzo MEDIO.
- C6 🟡 IAM básico (grupos, model allow-lists, invite-only). Esfuerzo ALTO.
- C7 🟡 Semantic layer (métricas reutilizables, metric_query). Esfuerzo ALTO.

# ORDEN DE EJECUCIÓN
FASE A → FASE B (B1→B2→B3→B4→B5→B6) → FASE C (C1→C2→C3→C4→C5→C6→C7).

# ESTADO REAL DE GUILN (verificado en código 2026-07-30) — LO QUE YA EXISTE
- Auto-agentes multi-agente: frontend/app/element/auto-agents.tsx (47KB) + auto-agents-types.ts + auto-agents-map.tsx (3D). Canvas XYFlow con nodos custom, edges, chat individual por agente + grupal con streaming, multi-proveedor por nodo. Persistencia agents_autonomos.json. Registrado defwidget@auto-agents.
- DB Connections UI: frontend/app/view/gulinai/dbconn-ui.tsx (63KB): Query History, side-by-side, Table Detail, export XLSX/CSV/PDF, presentation mode. + dbconn-table.tsx, dbconn-export.tsx, dbexplorer.tsx.
- 20 monitores DB: sqlserver, mysql, postgres, oracle, mongodb, cassandra, couchbase, redis, memcached, neo4j, hadoop, hbase, hazelcast, db2, dameng, informix, saphana, sybase, maxdb, sqlite + universalmonitor.
- servicemap.tsx (mapa infra), sqlflow.tsx + sql-parser.ts (grafo SQL con XYFlow+dagre), apimanager.tsx (API/secrets).
- dashboard.tsx + dashboard-model.ts (BI interactivo). webview.tsx (41KB navegador agéntico). toolsadmin.tsx (51KB). memorygrid.tsx.
- Backend Go: pkg/gulinapp/brain_route.go (Brain+XP), pkg/service/service.go, secretstore, jobmanager, jobcontroller.
- Widgets: terminal, files, web, ai, sysinfo, memorias, db_explorer, api_manager, widget-builder, debug-logs, db-monitor, plugin-manager, auto-agents.

# LO QUE NO ESTÁ (verificar antes de asumir)
- No hay conector WhatsApp/Telegram/mensajería social.
- No hay pipeline de datos real entre agentes (edges del canvas = visuales; lógica es chat paralelo, no flow de datos entre nodos). → objetivo C1.

# LECCIÓN CLAVE
NO asumir que algo no está implementado sin revisar el código. GuLiN ya tiene mucho. Verificar frontend/app/view + frontend/app/element antes de proponer features.
