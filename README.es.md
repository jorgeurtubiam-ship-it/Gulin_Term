<div align="center">

# ⚡ GuLiN IA & Terminal
### *El Sistema Operativo Cognitivo de Terminal & DBA Autónomo para Oracle*

[![GitHub Stars](https://img.shields.io/github/stars/jorgeurtubiam-ship-it/Gulin_ia?style=for-the-badge&logo=github&color=38bdf8)](https://github.com/jorgeurtubiam-ship-it/Gulin_ia/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/jorgeurtubiam-ship-it/Gulin_ia?style=for-the-badge&logo=github&color=818cf8)](https://github.com/jorgeurtubiam-ship-it/Gulin_ia/network/members)
[![Version](https://img.shields.io/badge/Release-v2.1.0-emerald?style=for-the-badge&logo=rocket)](https://github.com/jorgeurtubiam-ship-it/Gulin_ia/releases)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge&logo=apache)](./LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.25+-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://golang.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Platforms](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=for-the-badge&logo=apple&logoColor=white)]()

<br/>

```
  ██████╗ ██╗   ██╗██╗     ██╗███╗   ██╗    ██╗ █████╗ 
 ██╔════╝ ██║   ██║██║     ██║████╗  ██║    ██║██╔══██╗
 ██║  ███╗██║   ██║██║     ██║██╔██╗ ██║    ██║███████║
 ██║   ██║██║   ██║██║     ██║██║╚██╗██║    ██║██╔══██║
 ╚██████╔╝╚██████╔╝███████╗██║██║ ╚████║    ██║██║  ██║
  ╚═════╝  ╚═════╝ ╚══════╝╚═╝╚═╝  ╚═══╝    ╚═╝╚═╝  ╚═╝
```

**[Español](./README.es.md)** · **[English](./docs/en/README.md)** · **[한국어](./README.ko.md)** · **[Documentación](./docs/es/01-introduccion.md)**

<p align="center">
  <b>GuLiN</b> transforma tu terminal en un <b>Centro de Operaciones Agéntico Autónomo</b>.<br/>
  Instala, diagnostica y configura infraestructuras complejas como <b>Oracle Database y Data Guard Standby</b> usando <b>puro Lenguaje Natural</b>.
</p>

</div>

---

## 🌟 ¿Qué es GuLiN?

**GuLiN Terminal** es el primer sistema operativo cognitivo para terminales diseñado para **DevOps, DBAs y Cloud Architects**. Integra modelos de frontera (**Max 3, Claude 3.5, Gemini 2.0, DeepSeek R1/V3, GPT-4o y Ollama**) directamente con tu shell, bases de datos y herramientas de generación de reportes ejecutivos.

```
+---------------------------------------------------------------------------------------+
|  👤 USUARIO (Lenguaje Natural):                                                       |
|  "Instala Oracle DB 23ai, configura réplica Data Guard Standby y dame un reporte PPT" |
+---------------------------------------------------------------------------------------+
                                           │
                                           ▼
+───────────────────────────────────────────────────────────────────────────────────────+
|  🤖 GULIN AUTONOMOUS AGENT CORE (Max 3 / Claude / DeepSeek / Gemini / Ollama)         |
|  ├── 🧠 Gulin Brain: Memoria semántica infinita y Auto-RAG contextual                 |
|  ├── 🗄️ Oracle Autonomous Engine: Playbooks DBA, DDL/DML, RAC, Standby & Diagnostics |
|  ├── 💻 Live Terminal Bridge: Ejecución segura y piping bidireccional en tiempo real  |
|  └── 📊 DocGen Suite: Generación directa de .pptx, .docx, .xlsx y Dashboards BI       |
+───────────────────────────────────────────────────────────────────────────────────────+
                                           │
                                           ▼
+───────────────────────────────────────────────────────────────────────────────────────+
|  🎯 RESULTADOS:                                                                       |
|  [✓] Oracle DB 23ai instalado y parámetros de kernel optimizados                     |
|  [✓] Data Guard Standby sincronizado con log-shipping activo                          |
|  [✓] Presentación ejecutiva generada: executive_dba_report.pptx                      |
|  [✓] Dashboard en vivo: Oracle Gulin-Insights (PDBs, RAC, Tablespaces, SGA/PGA)       |
+───────────────────────────────────────────────────────────────────────────────────────+
```

---

## 🚀 Superpoderes y Características Destacadas

### 🗄️ 1. Oracle DBA Autónomo & Data Guard Standby en Lenguaje Natural
* **Instalación Zero-Touch:** Despliega motores **Oracle Database 19c / 21c / 23ai** con todas las dependencias, usuarios `oracle`, configuración de kernel (`sysctl`, `limits.conf`) y listener con una sola frase.
* **Configuración de Oracle Standby / Data Guard:** Creación automática de bases de datos Standby física/lógica, configuración de `tnsnames.ora`, `listener.ora`, transporte de redo logs, sincronización MRP y verificación de lag.
* **Diagnóstico y Health Check Proactivo:** Detección de bloqueos (locks), análisis de *alert logs*, monitoreo de *Tablespaces*, optimización de consultas lentas y ajuste de memoria *SGA / PGA*.
* **Dashboard Visual en Vivo (Oracle Gulin-Insights):** Vista dedicada integrada para monitorear Pluggable Databases (PDBs), clústeres RAC, sesiones activas y flujos de replicación.

### 🧠 2. Orquestador Multi-IA de Frontera
* Soporte nativo para **Max 3**, **Claude 3.5 Sonnet**, **Gemini 2.0 Pro/Flash**, **OpenAI GPT-4o**, **DeepSeek R1 / V3** y ejecución local **100% offline con Ollama**.
* **Hot-Swap sin pérdida de contexto:** Cambia de modelo al instante según el tipo de tarea (ej. razonamiento profundo con Max 3/DeepSeek R1, streaming ultra-rápido con Gemini Flash).

### 📑 3. DocGen Suite: Presentaciones, Informes Word y Hojas Excel
* Genera presentaciones en **PowerPoint (`.pptx`)**, reportes ejecutivos en **Word (`.docx`)** y hojas de cálculo con gráficos en **Excel (`.xlsx`)** a partir del diagnóstico de tus servidores o bases de datos.
* Integra visualizaciones ejecutivas **Visual BI** con gráficos interactivos directo en el espacio de trabajo.

### 💻 4. Terminal Híbrido Split & Workspace Cognitivo
* Panel dividido interactivo: Terminal de alto rendimiento (Go + PTY) + Chat IA con razonamiento aislado (*chain-of-thought*).
* Botones de ejecución directa en el terminal con 1 clic y soporte para control por voz manos libres (*wake-word*).
* Memoria persistente **Gulin Brain** que recuerda tu infraestructura, servidores SSH y reglas de negocio.

---

## ⚡ Instalación Rápida

### 📦 Opción 1: Instalación Rápida (Recomendada)

```bash
# Clonar y compilar instalador nativo (.dmg / .AppImage / .deb / .exe)
git clone https://github.com/jorgeurtubiam-ship-it/Gulin_ia.git
cd Gulin_ia
chmod +x install.sh
./install.sh
```

### 🛠️ Opción 2: Modo Desarrollo (Hot-Reload)

```bash
npm install && task build
task dev
```

---

## 💡 Ejemplos de Uso en Lenguaje Natural

| Tu solicitud a GuLiN | Acción que ejecuta el Agente |
| :--- | :--- |
| `> "Instala Oracle DB 23ai en este servidor Linux y crea una PDB llamada ERP_PROD"` | Configura paquetes, variables de entorno, ejecuta instalador silencioso y crea la PDB. |
| `> "Revisa el estado de la réplica Standby y dime si hay lag de archivados"` | Consulta `V$ARCHIVE_DEST_STATUS`, `V$DATAGUARD_STATS`, calcula el desfase y reporta el estado. |
| `> "Analiza el uso de CPU y memoria de la base de datos y genera un informe Word para el cliente"` | Extrae AWR/ASH metrics, arma tablas estadísticas y compila `reporte_rendimiento.docx`. |
| `> "Hay lentitud en el servidor; identifica queries bloqueantes y genera el script de kill/tune"` | Inspecciona `V$SESSION` y `V$SQL`, identifica la sesión raíz del lock y genera el plan de resolución. |

---

## 🏗️ Arquitectura y Stack Tecnológico

- **Frontend:** React, TypeScript, Vite, Electron, Monaco Editor, Tailwind CSS, Recharts, xterm.js
- **Backend:** Go Core, Go PTY, SQLite, Native Oracle (`go-ora`), PostgreSQL, MySQL, MongoDB, Dremio
- **IA Engine:** Max 3, Claude 3.5, Gemini 2.0, DeepSeek R1/V3, OpenAI, Ollama

---

## 📄 Licencia

Distribuido bajo la Licencia **Apache 2.0**. Consulta [`LICENSE`](./LICENSE) para más detalles.

<div align="center">
  <sub>Desarrollado con ❤️ por <b><a href="https://github.com/jorgeurtubiam-ship-it">Jorge Urtubia</a></b> y el equipo de <b><a href="mailto:contacto@ecogulin.cl">EcoGulin</a></b>.</sub>
</div>
