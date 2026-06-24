// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/gulindev/gulin/pkg/wconfig"
	"github.com/gulindev/gulin/pkg/gulinobj"
)

// WidgetSaveRequest represents the payload for creating/updating a custom widget.
type WidgetSaveRequest struct {
	ID          string                 `json:"id"`
	Label       string                 `json:"label"`
	Icon        string                 `json:"icon"`
	Color       string                 `json:"color"`
	Description string                 `json:"description"`
	BlockDef    map[string]interface{} `json:"blockdef"`
	Order       float64                `json:"display:order,omitempty"`
}

// WidgetListItem is returned in the list response.
type WidgetListItem struct {
	ID          string                 `json:"id"`
	Label       string                 `json:"label"`
	Icon        string                 `json:"icon"`
	Color       string                 `json:"color"`
	Description string                 `json:"description"`
	BlockDef    map[string]interface{} `json:"blockdef"`
	Order       float64                `json:"display:order,omitempty"`
}

const widgetsFile = "widgets.json"

// WidgetListHandler handles GET /gulin/widgets-list
// Returns all custom widgets stored in the user's widgets.json config.
func WidgetListHandler(w http.ResponseWriter, r *http.Request) {
	m, cerrs := wconfig.ReadGulinHomeConfigFile(widgetsFile)
	if len(cerrs) > 0 {
		WriteJsonError(w, fmt.Errorf("error reading widgets config: %v", cerrs[0].Err))
		return
	}
	if m == nil {
		WriteJsonSuccess(w, []WidgetListItem{})
		return
	}

	var items []WidgetListItem
	for id, rawVal := range m {
		// Each value is a map representing a widget config
		valMap, ok := rawVal.(map[string]interface{})
		if !ok {
			continue
		}
		item := WidgetListItem{ID: id}
		if v, ok := valMap["label"].(string); ok {
			item.Label = v
		}
		if v, ok := valMap["icon"].(string); ok {
			item.Icon = v
		}
		if v, ok := valMap["color"].(string); ok {
			item.Color = v
		}
		if v, ok := valMap["description"].(string); ok {
			item.Description = v
		}
		if v, ok := valMap["display:order"].(float64); ok {
			item.Order = v
		}
		if v, ok := valMap["blockdef"].(map[string]interface{}); ok {
			item.BlockDef = v
		}
		items = append(items, item)
	}

	WriteJsonSuccess(w, items)
}

// WidgetSaveHandler handles POST /gulin/widgets-save
// Creates or updates a widget in the user's widgets.json config.
func WidgetSaveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error reading request body: %v", err))
		return
	}
	defer r.Body.Close()

	var req WidgetSaveRequest
	if err := json.Unmarshal(body, &req); err != nil {
		WriteJsonError(w, fmt.Errorf("invalid JSON: %v", err))
		return
	}
	if req.ID == "" {
		WriteJsonError(w, fmt.Errorf("widget id is required"))
		return
	}
	if req.Label == "" {
		WriteJsonError(w, fmt.Errorf("widget label is required"))
		return
	}

	// Read existing file
	m, cerrs := wconfig.ReadGulinHomeConfigFile(widgetsFile)
	if len(cerrs) > 0 {
		WriteJsonError(w, fmt.Errorf("error reading widgets config: %v", cerrs[0].Err))
		return
	}
	if m == nil {
		m = make(gulinobj.MetaMapType)
	}

	// Build the widget entry
	widgetEntry := gulinobj.MetaMapType{
		"label":       req.Label,
		"icon":        req.Icon,
		"color":       req.Color,
		"description": req.Description,
		"blockdef":    req.BlockDef,
	}
	if req.Order != 0 {
		widgetEntry["display:order"] = req.Order
	}

	m[req.ID] = widgetEntry

	if err := wconfig.WriteGulinHomeConfigFile(widgetsFile, m); err != nil {
		WriteJsonError(w, fmt.Errorf("error saving widget: %v", err))
		return
	}

	WriteJsonSuccess(w, map[string]string{"id": req.ID})
}

// WidgetDeleteHandler handles DELETE /gulin/widgets-delete?id=...
// Removes a widget from the user's widgets.json config.
func WidgetDeleteHandler(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		WriteJsonError(w, fmt.Errorf("id query param is required"))
		return
	}

	m, cerrs := wconfig.ReadGulinHomeConfigFile(widgetsFile)
	if len(cerrs) > 0 {
		WriteJsonError(w, fmt.Errorf("error reading widgets config: %v", cerrs[0].Err))
		return
	}
	if m == nil {
		WriteJsonSuccess(w, nil)
		return
	}

	delete(m, id)

	if err := wconfig.WriteGulinHomeConfigFile(widgetsFile, m); err != nil {
		WriteJsonError(w, fmt.Errorf("error deleting widget: %v", err))
		return
	}

	WriteJsonSuccess(w, nil)
}
