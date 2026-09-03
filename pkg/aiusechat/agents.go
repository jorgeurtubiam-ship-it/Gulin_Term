// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"strings"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

type AgentExpertType string

const (
	Expert_DB      AgentExpertType = "db_expert"
	Expert_File    AgentExpertType = "file_expert"
	Expert_Web     AgentExpertType = "web_expert"
	Expert_Command AgentExpertType = "command_expert"
)

type AgentExpert struct {
	ID               AgentExpertType
	Name             string
	SystemPromptFunc func() string
	Tools            []string // Nombres de las herramientas que este experto puede usar
	DefaultModel     string   // Modelo preferido para este experto
}

var Experts = map[AgentExpertType]AgentExpert{
	Expert_DB: {
		ID:               Expert_DB,
		Name:             "Experto en Bases de Datos",
		SystemPromptFunc: GetSystemPrompt_DBExpert,
		Tools:            []string{"db_query", "db_register_connection", "db_list_connections", "apimanager_list", "apimanager_call", "apimanager_register", "apimanager_delete", "brain_register_node", "brain_connect_nodes"},
		DefaultModel:     "gemini-3.1-flash-lite",
	},
	Expert_File: {
		ID:               Expert_File,
		Name:             "Especialista en Archivos",
		SystemPromptFunc: GetSystemPrompt_FileExpert,
		Tools:            []string{"read_text_file", "write_text_file", "edit_text_file", "delete_text_file", "read_dir", "brain_register_node", "brain_connect_nodes"},
		DefaultModel:     "gemini-3.1-flash-lite",
	},
	Expert_Web: {
		ID:               Expert_Web,
		Name:             "Investigador Web",
		SystemPromptFunc: GetSystemPrompt_WebExpert,
		Tools:            []string{"web_navigate", "web_read_page", "web_click", "web_type", "brain_register_node", "brain_connect_nodes"},
		DefaultModel:     "gemini-3.1-flash-lite",
	},
	Expert_Command: {
		ID:               Expert_Command,
		Name:             "Administrador de Sistemas",
		SystemPromptFunc: GetSystemPrompt_CommandExpert,
		Tools:            []string{"term_run_command", "term_send_signal", "term_command_output", "term_get_scrollback", "term_search", "apimanager_list", "apimanager_call", "apimanager_register", "apimanager_delete", "brain_register_node", "brain_connect_nodes"},
		DefaultModel:     "gemini-3.1-flash-lite", // Los comandos iniciales ahora son de Nivel 1 (Ahorro)
	},
}

// GetAgentTools filtra las herramientas disponibles para un agente específico
func (a AgentExpert) GetAgentTools(allTools []uctypes.ToolDefinition) []uctypes.ToolDefinition {
	var filtered []uctypes.ToolDefinition
	toolMap := make(map[string]bool)
	for _, tName := range a.Tools {
		toolMap[tName] = true
	}

	for _, tool := range allTools {
		if toolMap[tool.Name] {
			filtered = append(filtered, tool)
		}
	}
	return filtered
}

// OrchestratorDecision representa la decisión del orquestador sobre a quién llamar
type OrchestratorDecision struct {
	ExpertID AgentExpertType `json:"expert_id"`
	Reason   string          `json:"reason"`
	Task     string          `json:"task"`
}

func (d OrchestratorDecision) String() string {
	return fmt.Sprintf("[%s] %s: %s", d.ExpertID, d.Reason, d.Task)
}

// GetCallExpertToolDefinition define la herramienta para que el Orquestador llame a un experto
func GetCallExpertToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "call_expert",
		DisplayName: "Llamar a un Experto",
		Description: "Delega una tarea técnica específica a un experto (DB, File, Web, Command).",
		ToolLogName: "orch:call_expert",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"expert_id": map[string]any{
					"type":        "string",
					"enum":        []string{string(Expert_DB), string(Expert_File), string(Expert_Web), string(Expert_Command)},
					"description": "El ID del experto al que quieres delegar la tarea.",
				},
				"task": map[string]any{
					"type":        "string",
					"description": "La tarea específica que el experto debe realizar.",
				},
				"reason": map[string]any{
					"type":        "string",
					"description": "El porqué estás delegando esta tarea a este experto.",
				},
			},
			"required":             []string{"expert_id", "task", "reason"},
			"additionalProperties": false,
		},
		ToolApproval: func(input any, chatOpts uctypes.GulinChatOpts) string {
			if strings.Contains(chatOpts.Config.Model, "@plan") {
				return uctypes.ApprovalNeedsApproval
			}
			return uctypes.ApprovalAutoApproved
		},
		// El callback se manejará en el loop principal de usechat.go
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			return "Tarea delegada al experto. Esperando resultados...", nil
		},
	}
}
