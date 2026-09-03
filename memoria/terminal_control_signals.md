# Memoria de GuLiN: Manejo de Señales de Control de Terminal y Códigos ASCII

## 1. Contexto y Problema
En emuladores de terminal y shells (bash, zsh, sh, pwsh), los atajos de teclado como `Ctrl+C` o `Ctrl+Z` **no son texto plano**.
Cuando un usuario presiona `Ctrl+C`, el teclado emite el código de control binario **ASCII 3 (`\x03`)** al driver TTY/PTY, el cual genera la señal del sistema operativo `SIGINT` para interrumpir el proceso en primer plano.

Si un agente de IA intenta enviar `"Ctrl+C"`, `"^C"` o `"SIGINT"` como una cadena de texto común con retorno de carro (`\r\n`), el terminal solo recibe letras escritas y el proceso en ejecución **no se detiene**.

---

## 2. Tabla de Mapeo de Códigos de Control ASCII

| Combinación | Carácter de Control | Código ASCII (Dec) | Hexadecimal / Escape | Señal / Acción POSIX |
| :--- | :--- | :--- | :--- | :--- |
| **Ctrl + C** | ETX (End of Text) | `3` | `\x03` | `SIGINT` (Interrumpir proceso activo) |
| **Ctrl + Z** | SUB (Substitute) | `26` | `\x1a` | `SIGTSTP` (Suspender proceso a segundo plano) |
| **Ctrl + D** | EOT (End of Transmission) | `4` | `\x04` | `EOF` / Logout / Salir de prompts interactivos (Python, Node) |
| **Ctrl + \\** | FS (File Separator) | `28` | `\x1c` | `SIGQUIT` (Terminar con Core Dump) |
| **Escape** | ESC | `27` | `\x1b` | Salir de modos de edición (Vim, Nano, etc.) |
| **Ctrl + L** | FF (Form Feed) | `12` | `\x0c` | Limpiar pantalla sin matar proceso |
| **Ctrl + U** | NAK | `21` | `\x15` | Borrar línea actual en la shell |

---

## 3. Reglas de Operación para el Agente GuLiN

1. **Nunca enviar `"Ctrl+C"` o `"^C"` como texto plano**:
   - Para detener un comando colgado, un bucle infinito o un proceso continuo (`tail -f`, `ping`, `top`), se debe enviar el byte `\x03` en Base64 (`Aw==`) directamente mediante la herramienta de control / entrada al bloque de terminal.
2. **Salir de prompts interactivos sin matar la sesión**:
   - Para salir de prompts de Python, Node o consolas interactivas, usar `\x04` (Ctrl+D) o `\x03` (Ctrl+C).
   - Queda prohibido ejecutar `exit` en la shell local primaria para evitar cerrar la ventana del usuario.
3. **Manejo de timeouts y procesos colgados**:
   - Si un comando no responde o entra en estado interactivo, interrumpir con `\x03` para recuperar el prompt antes de intentar un nuevo comando.
