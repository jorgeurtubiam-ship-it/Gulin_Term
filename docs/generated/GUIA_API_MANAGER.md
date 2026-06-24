# Guía del API Manager - GuLiN IA

El **API Manager** es el componente central de GuLiN IA para la gestión segura y dinámica de servicios externos. Permite al agente interactuar con cualquier API RESTful sin necesidad de hardcodear credenciales en el prompt del sistema.

## 1. Registro de Servicios (`apimanager_register`)
Para registrar un nuevo servicio, utiliza la herramienta `apimanager_register` especificando:
- `name`: Nombre del servicio (ej. `mi_api`).
- `url`: URL base de la API (ej. `https://api.midominio.com`).
- `auth_instructions`: Reglas de autenticación que el agente debe seguir (ej. "Llamar a /login con usuario y contraseña, y usar el token en las siguientes llamadas").

## 2. Invocación de Servicios (`apimanager_call`)
El agente puede invocar los servicios registrados usando la herramienta `apimanager_call`:
- Especificando el `api_name`.
- Definiendo el `method` (GET, POST, PUT, DELETE).
- Estableciendo el `path` (ej. `/v1/usuarios`).
- Enviando el `body` (opcional).

## 3. Seguridad y Marcadores Dinámicos
- **Placeholders automáticos:** Se permite el uso de variables como `{{username}}`, `{{password}}` y `{{token}}`. 
- Durante la ejecución de `apimanager_call`, el backend reemplazará automáticamente estos placeholders por las credenciales reales de la base de datos cifrada.
- Nunca se exponen las credenciales en el chat; el API Manager las maneja internamente.

## 4. Consultas y Mantenimiento
- **`apimanager_list`**: Devuelve la lista de todos los servicios registrados, incluyendo sus URLs y descripciones técnicas para que el agente sepa cómo interactuar con ellos.
- **`apimanager_delete`**: Elimina un servicio del catálogo.

## Flujo Recomendado de Trabajo
1. **Consulta:** El agente ejecuta `apimanager_list` para ver qué APIs hay y cuáles son sus `auth_instructions`.
2. **Login (si aplica):** El agente hace un `apimanager_call` POST al endpoint de login (usando `{{username}}` y `{{password}}`).
3. **Ejecución:** El agente utiliza el token obtenido (guardado en memoria temporal o usando `{{token}}` si está preconfigurado) para consumir otros endpoints.
