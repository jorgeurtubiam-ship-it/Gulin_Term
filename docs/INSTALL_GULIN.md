# 💻 Guía de Instalación y Despliegue de Gulin IA (Gulin Terminal)

Este documento detalla los pasos necesarios para instalar, compilar y ejecutar tu propia instancia de **Gulin IA** basándose en el repositorio modificado de Gulin Terminal. 

¡Sigue estos pasos para levantar el entorno de desarrollo y probar el asistente!

---

## 📋 1. Requisitos Previos (Pre-requisitos)

Antes de empezar, asegúrate de tener instalado el siguiente software en tu máquina (Windows, macOS o Linux):

1. **Go (Golang):** Versión 1.22 o superior.
   * [Descargar Go](https://go.dev/dl/)
2. **Node.js:** Versión 18 o superior (idealmente v20 LTS).
   * [Descargar Node.js](https://nodejs.org/)
3. **Task (Taskfile):** Es el orquestador de *scripts* que usa el proyecto (reemplaza a Make).
   * Instalación rápida en macOS (Homebrew): `brew install go-task/tap/go-task`
   * Instalación en NPM: `npm install -g @go-task/cli`
4. **Ollama (Opcional, pero recomendado):** Si deseas correr modelos locales privadamente sin gastar en API Keys.
   * [Descargar Ollama](https://ollama.com/)

---

## 🚀 2. Construcción del Proyecto (Primer Paso)

Una vez que tengas el repositorio clonado o extraído de tu archivo `.tar.gz`, abre una terminal, navega a la carpeta principal (`gulin-gulin/`) y ejecuta el comando de preparación general:

```bash
# Entrar a la carpeta
cd gulin

# Instalar dependencias globales y del frontend (React)
npm install

# Compilar los binarios y el entorno
task build
```

> **Nota:** La primera vez que compiles, Go descargará todas las librerías del backend y Node.js hará lo mismo para el frontend. Esto puede tardar varios minutos dependiendo de tu conexión a internet.

---

## ▶️ 3. Ejecutar la Aplicación en Modo Desarrollo

Para lanzar Gulin en tu pantalla y comenzar a interactuar, corre el comando principal de desarrollo:

```bash
task dev
```

Esto levantará el servidor local, los procesos *Electron* y te abrirá la ventana gráfica de Gulin Terminal con Gulin integrado en el panel izquierdo. 

*Para detener la aplicación, presiona `Ctrl + C` en la terminal donde corriste el comando.*

---

## 🌐 4. Compilar y Ver la Documentación (Docusaurus)

A lo largo de este proyecto, se redactó una Guía Técnica y Comercial para el cliente dentro del sistema Docusaurus. Para ver esa documentación como una página web:

1. Abre una nueva pestaña de terminal (o detén la app con `Ctrl + C`).
2. Tipea:
   ```bash
   task docsite
   ```
3. El terminal te indicará que el servidor arrancó.
4. Abre tu navegador de internet (Chrome, Firefox, Safari) y ve a:
   **http://localhost:3000**
5. En el menú del lado izquierdo, podrás navegar hasta la sección de **"Gulin IA"** para leer la arquitectura interna y la guía de usuario.

---

## ⚙️ 5. Configuración del LLM (Ollama o APIs en la nube)

Para que el asistente de Gulin *hable*, necesitas elegir un motor (Provider) en la configuración de la interfaz gráfica una vez que abra Gulin Terminal:

### Para usar modelos Locales (Gratis y Privada):
1. Asegúrate de tener Ollama abierto en tu computadora.
2. Abre una terminal normal y bájate un modelo rápido (ejemplo Llama 3):
   `ollama run llama3.2`
3. En la esquina superior izquierda de la app de Gulin, haz clic en el menú desplegable del modelo, elige *"Local (Ollama)"* o *"Custom"* y asegúrate de que esté apuntando a `http://localhost:11434`.

### Para usar APIs en la nube (Rendimiento Extremo):
1. Si prefieres la inteligencia superior de OpenAI, Gemini o Anthropic de pago.
2. Ve al menú desplegable arriba del chat y elige `OpenAI / DeepSeek / Claude`.
3. El sistema te pedirá insertar la API Key de tu proveedor. Introdúcela y Gulin tendrá el nivel máximo de razonamiento para planificar y ejecutar código en tu entorno.

---

¡Felicidades! Gulin IA ya está listo para ayudarte con tu proyecto.
