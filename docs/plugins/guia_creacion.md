# 🛠️ Guía de Creación: Tu primer Plugin

Cada plugin es un archivo de Javascript (`.js`) que Gulin interpreta para obtener nuevas funcionalidades.

## 1. Estructura de Metadatos (Obligatorio)
Gulin necesita leer los comentarios al inicio del archivo para saber qué hace la herramienta:

```javascript
// @name: nombre_de_la_herramienta
// @description: Explica qué hace para que la IA sepa cuándo usarla.
// @param: parametro1 (string) - Descripción del parámetro.
```

## 2. La Función `execute`
Todos los plugins deben tener una función llamada `execute` que reciba un objeto `args`:

```javascript
function execute(args) {
    // Tu lógica aquí
    var respuesta = "Procesando " + args.parametro1;
    return respuesta;
}
```

## 3. Uso del Puente (Bridge)
Tus plugins pueden interactuar con Gulin usando el objeto global `gulin`:

### Consultar APIs Externas
```javascript
var resp = gulin.api_call("https://api.ejemplo.com/data");
```

### Consultar Bases de Datos
```javascript
var filas = gulin.db_query("mi_conexion", "SELECT * FROM tabla");
```

### Ejecutar Comandos
```javascript
var salida = gulin.run_command("ls -la");
```

## 4. Consejos
- Mantén las funciones cortas y enfocadas en una sola tarea.
- Devuelve siempre strings o JSON para que la IA pueda leer el resultado fácilmente.
