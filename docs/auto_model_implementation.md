# Implementación del Modo "Auto" en Gulin Agent

## Resumen
Esta documentación describe los cambios realizados para habilitar y configurar correctamente el modo de IA **"Auto"** dentro de Gulin Agent, asegurando que la selección dinámica del modelo sea gestionada directamente por el **Gulin Bridge**.

## Problema Original
El modo "Auto" (identificado por el ID `auto/model`) no estaba disponible en el panel de IA de la interfaz por las siguientes razones:
1. El modelo estaba incluido en la lista de modelos inactivos (`inactiveModels`) dentro del código del backend, ocultándolo de la sincronización.
2. El sistema no categorizaba correctamente el proveedor del modelo como "auto", lo que causaba problemas al intentar agruparlo en el componente UI de selección de modelos.
3. El código forzaba estáticamente el uso de `claude-haiku-4-5-20251001` a nivel local y lo mostraba como "Auto (Claude Haiku 4.5)", impidiendo que la verdadera naturaleza "automática" de enrutamiento del bridge funcionara.

## Solución Implementada

Se realizaron modificaciones en el backend de Go (`waveterm/pkg/aiusechat/usechat-mode.go`) para resolver estos inconvenientes:

### 1. Eliminación de la Restricción (Lista Inactiva)
Se eliminó la entrada `"auto/model": true` del mapa `inactiveModels` dentro de la función `SyncGulinBridgeModels`. Esto permitió que el modelo, tras ser reportado por el Gulin Bridge, sea finalmente procesado e incluido en los modos disponibles de la aplicación.

### 2. Categorización del Proveedor
Se actualizó la función `getProviderFromModelID` para detectar patrones de modelos "auto" y asignarles el proveedor correspondiente.
```go
if strings.Contains(m, "auto/") {
    return "auto"
}
```

### 3. Configuración Genérica y Delegación al Bridge
Se eliminó la asignación forzada del modelo `claude-haiku-4-5-20251001`. El backend ahora conserva el ID original (`auto/model`) al comunicarse, delegando la decisión final de enrutamiento y selección de modelo inteligente al Gulin Bridge. 
Además, se simplificó su presentación visual.
```go
if m.ID == "auto/model" {
    effectiveDisplayName = "Auto"
    effectiveDisplayDesc = "Selección automática de modelo optimizada por Gulin Bridge"
}
```

## Archivos Modificados
- `waveterm/pkg/aiusechat/usechat-mode.go`

## Proceso de Verificación
1. Guardado de los cambios en el archivo `usechat-mode.go`.
2. Reinicio del servidor backend (`gulinsrv`) o del proceso de desarrollo (`task dev`).
3. Sincronización automática de modelos a través del Bridge (visible en `/tmp/bridge_sync.log`).
4. Verificación visual en la interfaz de Gulin: el proveedor **"Auto"** ahora aparece disponible y lista el modelo **"Auto"**.
