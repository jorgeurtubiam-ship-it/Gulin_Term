# Guía del API Manager de GuLiN IA

El **API Manager** es el componente central de GuLiN IA para la gestión segura y dinámica de servicios externos. Permite al agente interactuar con cualquier API RESTful sin necesidad de hardcodear credenciales en el prompt del sistema.

## 🌟 Funcionalidades Clave

- **Persistencia Segura:** Almacena URLs base, tokens de autenticación y credenciales (usuario/contraseña) en una base de datos local cifrada.
- **Inyección Dinámica:** El agente puede consultar la lista de APIs disponibles y sus instrucciones de uso en tiempo real.
- **Soporte de Marcadores:** Permite el uso de placeholders como `{{token}}`, `{{username}}` y `{{password}}` en las rutas y cuerpos de las peticiones para una sustitución automática y segura.
- **Instrucciones de Autenticación:** Cada endpoint puede incluir reglas específicas de "login" que el agente sigue paso a paso.

## 🛠️ Herramientas Disponibles

El agente tiene acceso a las siguientes herramientas para gestionar el API Manager:

1.  **`apimanager_list`**: Devuelve la lista de todos los servicios registrados, incluyendo sus URLs y descripciones técnicas.
2.  **`apimanager_call`**: Realiza peticiones HTTP (GET, POST, PUT, DELETE, PATCH) a un servicio registrado. Gestiona automáticamente la autenticación configurada.
3.  **`apimanager_register`**: Permite al usuario (o al agente bajo supervisión) registrar un nuevo endpoint.
4.  **`apimanager_delete`**: Elimina un servicio del catálogo.

## 🚀 Ejemplo de Uso: Dremio

Dremio se gestiona mediante el API Manager bajo el nombre `dremio`. El flujo de trabajo típico del agente es:

1.  **Consulta:** Ejecuta `apimanager_list` para obtener la URL base (ej. `http://127.0.0.1:9047`) y las `auth_instructions`.
2.  **Login:** Realiza un `apimanager_call` POST a `/apiv2/login` para obtener un token de sesión.
3.  **Ejecución:** Usa el token para realizar consultas SQL vía `/api/v3/sql`.

## 🔒 Seguridad y Mejores Prácticas

- **Nunca expongas credenciales en el chat:** El API Manager maneja los secretos internamente.
- **Usa Instrucciones Claras:** Al registrar una API, asegúrate de llenar el campo `auth_instructions` para que el agente sepa exactamente qué endpoints de login o cabeceras usar.
- **Validación de Endpoints:** Si una llamada falla con 401 (No autorizado) o 404 (No encontrado), el agente está entrenado para revisar las instrucciones y corregir la ruta automáticamente.

---
**GuLiN IA - Conectividad Inteligente**
