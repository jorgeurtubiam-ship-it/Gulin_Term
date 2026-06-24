# Plan de Resolución: GuLiN App (Modo Piloto)

## 1. Restauración de UI
Restaurar `index.html` a la raíz del proyecto para compatibilidad con `electron.vite.config.ts`:
```bash
git show cfa0501ae^:index.html > index.html
```

## 2. Configuración de Entorno (WCLOUD)
Asegurar las variables para `gulinsrv`:
- WCLOUD_ENDPOINT
- WCLOUD_WS_ENDPOINT
- WCLOUD_PING_ENDPOINT

## 3. Dependencias
Instalar `sharp` para la optimización de imágenes (build de producción):
```bash
npm install sharp
```
