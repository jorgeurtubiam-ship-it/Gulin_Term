// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gulindev/gulin/pkg/gulinbase"
)

func GulinAIPluginListHandler(w http.ResponseWriter, r *http.Request) {
	pluginsDir := filepath.Join(gulinbase.GetGulinConfigDir(), PluginsDirName)
	files, err := os.ReadDir(pluginsDir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var plugins []string
	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".js") {
			plugins = append(plugins, f.Name())
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(plugins)
}

func GulinAIPluginReadHandler(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	path := filepath.Join(gulinbase.GetGulinConfigDir(), PluginsDirName, name)
	content, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write(content)
}

func GulinAIPluginSaveHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name    string `json:"name"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.Content == "" {
		http.Error(w, "name and content are required", http.StatusBadRequest)
		return
	}

	if !strings.HasSuffix(req.Name, ".js") {
		req.Name += ".js"
	}

	pluginsDir := filepath.Join(gulinbase.GetGulinConfigDir(), PluginsDirName)
	os.MkdirAll(pluginsDir, 0755)

	path := filepath.Join(pluginsDir, req.Name)
	if err := os.WriteFile(path, []byte(req.Content), 0644); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func GulinAIPluginDeleteHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	path := filepath.Join(gulinbase.GetGulinConfigDir(), PluginsDirName, req.Name)
	if err := os.Remove(path); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}
