// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"github.com/gulindev/gulin/pkg/wconfig"
)

// GetOllamaEmbeddingEndpoint devuelve el endpoint de Ollama configurado o el valor por defecto.
func GetOllamaEmbeddingEndpoint() string {
	watcher := wconfig.GetWatcher()
	if watcher == nil {
		return "http://localhost:11434"
	}
	fullConfig := watcher.GetFullConfig()
	if fullConfig.Settings.AiOllamaEmbeddingEndpoint != "" {
		return fullConfig.Settings.AiOllamaEmbeddingEndpoint
	}
	return "http://localhost:11434"
}

// GetOllamaEmbeddingModel devuelve el modelo de Ollama configurado o el valor por defecto.
func GetOllamaEmbeddingModel() string {
	watcher := wconfig.GetWatcher()
	if watcher == nil {
		return "nomic-embed-text"
	}
	fullConfig := watcher.GetFullConfig()
	if fullConfig.Settings.AiOllamaEmbeddingModel != "" {
		return fullConfig.Settings.AiOllamaEmbeddingModel
	}
	return "nomic-embed-text"
}
