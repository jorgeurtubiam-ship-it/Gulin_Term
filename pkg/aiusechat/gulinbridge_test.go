// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGulinBridgeSync(t *testing.T) {
	// 1. Simular servidor Gulin Bridge
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(GulinBridgeLoginResponse{Token: "test-jwt-token"})
			return
		}
		if r.URL.Path == "/api/admin/discover-models" {
			w.Header().Set("Content-Type", "application/json")
			models := []GulinBridgeModel{
				{ID: "gpt-4o", Provider: "openai", Name: "GPT-4o", Available: true},
				{ID: "claude-3-5-sonnet", Provider: "anthropic", Name: "Claude 3.5 Sonnet", Available: true},
			}
			json.NewEncoder(w).Encode(models)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	// 2. Probar el cliente
	client := NewGulinBridgeClient(server.URL)
	token, err := client.Login("admin@test.com", "password")
	if err != nil {
		t.Fatalf("Error en login: %v", err)
	}
	if token != "test-jwt-token" {
		t.Fatalf("Token incorrecto: %s", token)
	}

	models, err := client.DiscoverModels(token)
	if err != nil {
		t.Fatalf("Error al descubrir modelos: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("Número de modelos incorrecto: %d", len(models))
	}
}
