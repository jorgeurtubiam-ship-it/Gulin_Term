# GUÍA DE PLUGINS - GuLiN

## 1. Estructura
Los plugins son archivos `.js` ubicados en el sistema.
Estructura mínima:
```javascript
// @name: MiPlugin
// @description: Descripción breve
function execute(args) {
    // Lógica aquí
    // Usar gulin.run_command(cmd) para comandos externos
}
```

## 2. Registro
Se gestionan a través del comando interno `plugin_list` y se guardan en `plugins/`.

## 3. Debugging
- Usar `plugin_debug` para verificar carga.
- Los logs de errores aparecen en el terminal embebido.
