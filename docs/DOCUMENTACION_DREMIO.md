# Guía Técnica: Integración Gulin IA + Dremio

Esta documentación detalla la implementación técnica realizada para conectar Gulin IA con Dremio de forma dinámica, segura y robusta.

## 1. Arquitectura de Conexión (API Manager)

Gulin IA utiliza un sistema de **API Manager** que permite gestionar endpoints de forma dinámica sin necesidad de recompilar el código.

### Configuración de Dremio
- **Login Endpoint:** `/apiv2/login` (Método POST)
- **SQL Endpoint:** `/api/v3/sql` (Método POST)
- **Status Endpoint:** `/api/v3/job/{jobid}`
- **Results Endpoint:** `/api/v3/job/{jobid}/results`

## 2. Sistemas de Protección y Robustez

Se han implementado tres capas de seguridad exclusivas para este proyecto:

### A. Freno de Mano Físico (Loop Detector)
Se ha modificado el motor de ejecución (`plai-backend.go`) para detectar bucles infinitos. Si el agente intenta llamar a la misma herramienta con los mismos parámetros más de 3 veces seguidas, el sistema bloquea la ejecución automáticamente.

### B. Blindaje de Credenciales
Para evitar errores de "alucinación" (donde el agente intenta usar usuarios como `admin`), se ha programado un filtro en el núcleo de las herramientas. Este filtro detecta intentos de uso de credenciales genéricas y las reemplaza automáticamente por las credenciales reales de Jorge (`jurtubia`) almacenadas en la base de datos cifrada.

### C. Soporte de Big Data (Scripts Locales)
Dremio suele devolver volúmenes de datos inmensos (100KB+). El sistema ahora instruye al agente a no saturar el chat. En su lugar, el agente:
1. Descarga los datos a un archivo `.json` local.
2. Utiliza scripts de `Python` o `jq` para filtrar la información.
3. Envía solo el resumen o los primeros registros al dashboard.

## 3. Flujo de Trabajo del Agente

El agente sigue este protocolo dinámico:
1. **Descubrimiento:** Consulta `apimanager_list` para obtener las instrucciones vigentes.
2. **Autenticación:** Obtiene el token de sesión.
3. **Ejecución SQL:** Lanza la consulta y extrae el `jobid` dinámicamente.
4. **Polling:** Espera a que el estado sea `COMPLETED`.
5. **Visualización:** Extrae los resultados y genera el Dashboard interactivo.

---
*Documentación generada automáticamente por Antigravity para Jorge Urtubia.*
