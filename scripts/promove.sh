#!/usr/bin/env bash
#
# promove.sh — Promoción de GuLiN Terminal en GitHub
#
# Configura el repo público jorgeurtubiam-ship-it/Gulin_ia para máxima visibilidad:
#   1. Topics del repo (factores #1 de descubrimiento en github.com/topics/*)
#   2. Descripción amigable para motores de búsqueda
#
# REQUISITOS:
#   - Token personal de GitHub con permisos 'repo'. Crea uno en:
#     https://github.com/settings/tokens  → Generate new token (classic) → selecciona "repo"
#   - curl y jq instalados
#
# USO:
#   export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
#   ./promove.sh
#
set -euo pipefail

REPO="jorgeurtubiam-ship-it/Gulin_ia"
API="https://api.github.com/repos/${REPO}"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    echo "❌ Falta variable GITHUB_TOKEN. Exportala primero, ej:"
    echo '   export GITHUB_TOKEN=ghp_xxxxxxxxxxxx'
    exit 1
fi
command -v jq >/dev/null || { echo "❌ Requiere 'jq'. Instala con: brew install jq"; exit 1; }

AUTH_HEADER="Authorization: token ${GITHUB_TOKEN}"
ACCEPT="Accept: application/vnd.github+json"

echo "🚀 Promoción del repo ${REPO}"

# ---------------------------------------------------------------
# 1) TÓPICOS — hace que el repo aparezca en github.com/topics/*
# ---------------------------------------------------------------
TOPICS=(
    "shell" "terminal" "developer-tools" "ai" "llm-agents" "agent"
    "rag" "ollama" "openai" "claude" "gemini" "deepseek"
    "database" "sql" "bigdata" "dremio" "mongodb" "postgres"
    "infrastructure-as-code" "monitoring" "dashboards" "electron-app"
)

# Convierte a JSON array de strings
TOPICS_JSON=$(printf '%s\n' "${TOPICS[@]}" | jq -R . | jq -s .)

echo ""
echo "• Configurando ${#TOPICS[@]} topics..."
resp=$(curl -s -X PUT "${API}/topics" \
    -H "${AUTH_HEADER}" \
    -H "${ACCEPT}" \
    -H "Content-Type: application/json" \
    -d "{\"names\": ${TOPICS_JSON}}")

names_count=$(echo "$resp" | jq '.names | length' 2>/dev/null || echo 0)
if [[ "$names_count" -gt 0 ]]; then
    echo "  ✅ ${names_count} topics aplicados:"
    echo "$resp" | jq -r '.names[] | "  •  " + .'
else
    echo "  ⚠️  Nivela respuesta de topics:"
    echo "$resp" | jq .
fi

# ---------------------------------------------------------------
# 2) DESCRIPCIÓN — optimizada para búsqueda en GitHub/Google
# ---------------------------------------------------------------
DESC="GuLiN Terminal: the ultimate agentic OS & terminal for engineers. Multi-AI (Ollama, DeepSeek, Claude, Gemini, OpenAI), long-term RAG memory, DB Maestro (Oracle, Postgres, MySQL, MongoDB, SQLite, Dremio), dashboards & agentic browser."

echo ""
echo "• Actualizando descripción..."
curl -s -X PATCH "${API}" \
    -H "${AUTH_HEADER}" \
    -H "${ACCEPT}" \
    -H "Content-Type: application/json" \
    -d "{\"description\": \"${DESC}\"}" \
    | jq -r 'if .description then "  ✅ Descripción actualizada: " + .description else "  ⚠️  " + (.message // "error") end'

echo ""
echo "🎉 Promoción aplicada. Revisa: https://github.com/${REPO}/topics"
