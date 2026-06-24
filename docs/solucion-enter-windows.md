# Solución de Problemas con el 'Enter' en Terminales de Windows

## Descripción del Problema
El usuario reportó un problema donde los agentes no eran capaces de enviar comandos o simular correctamente la tecla *Enter* (nueva línea, `\n`) al interactuar con terminales de Windows como PowerShell.

## Análisis de la Causa Raíz
Se identificó que el problema residía en cómo el backend manejaba los terminadores de línea al interactuar con la consola de pseudoterminal (PTY) de Windows.
Históricamente, en entornos Unix el terminador estándar de línea es `\n` (salto de línea), y en algunos casos en PowerShell se configuró el terminador `\r` (retorno de carro). Sin embargo, Windows (y las consolas como `pwsh`, `powershell`, y el tradicional `cmd.exe`) normalmente requieren la secuencia completa `\r\n` (CRLF) para procesar correctamente y evaluar las entradas ingresadas.

## Cambios Implementados
Los cambios se realizaron en dos archivos principales del proyecto `waveterm`:

### 1. `pkg/util/shellutil/shellutil.go`
Se extendió la lista de tipos de shells soportados para abarcar también el intérprete `cmd` original de Windows, ya que solo se tenía soporte oficial para `pwsh`, `powershell`, `zsh`, `bash`, `fish`.

- Se agregó la nueva constante para `cmd`:
  ```go
  const ShellType_cmd = "cmd"
  ```
- Se añadió la lógica de detección en la función `GetShellTypeFromShellPath`:
  ```go
  if strings.Contains(shellBase, "cmd") {
      return ShellType_cmd
  }
  ```

### 2. `pkg/aiusechat/tools_term.go`
Se corrigió y amplió la lógica que decide qué terminador de línea agregar al final de los comandos del agente de IA destinados a las terminales, forzando el uso de `\r\n` para todas las shells comunes en el ecosistema Windows.

- En la función que define la herramienta `term_run_command`, se actualizó el bloque condicional del terminador:
  ```go
  cleanCmd := strings.TrimRight(parsed.Command, "\r\n")
  terminator := "\n"
  if rtInfo != nil && (rtInfo.ShellType == "pwsh" || rtInfo.ShellType == "powershell" || rtInfo.ShellType == "cmd") {
      terminator = "\r\n"
  }
  cmdWithTerminator := cleanCmd + terminator
  ```

## Conclusión
La inclusión explícita del terminador `\r\n` (CRLF) para `powershell`, `pwsh` y `cmd.exe` garantiza que cualquier comando enviado automáticamente a la consola por la Inteligencia Artificial sea correctamente confirmado ("presionar Enter") y ejecutado, evitando errores de silencio o paralización por comandos en espera de validación de salto de línea en Windows.
