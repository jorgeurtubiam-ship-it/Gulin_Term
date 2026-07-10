// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"github.com/gulindev/gulin/pkg/gulinbase"
)

func GetSystemPromptText_OpenAI() string {
	return gulinbase.GetPrompt("MainPrompt.md")
}

func GetSystemPrompt_Plan() string {
	return gulinbase.GetPrompt("Plan.md")
}

func GetSystemPrompt_Act() string {
	return gulinbase.GetPrompt("Act.md")
}

func GetSystemPromptText_NoTools() string {
	return gulinbase.GetPrompt("NoTools.md")
}

func GetSystemPromptText_StrictToolAddOn() string {
	return gulinbase.GetPrompt("StrictToolAddOn.md")
}

// GetSystemPrompt_Orchestrator define el rol del comandante que delega tareas
func GetSystemPrompt_Orchestrator() string {
	return gulinbase.GetPrompt("Orchestrator.md")
}

// GetSystemPrompt_DBExpert especializado en bases de datos
func GetSystemPrompt_DBExpert() string {
	return gulinbase.GetPrompt("DBExpert.md")
}

// GetSystemPrompt_FileExpert especializado en archivos
func GetSystemPrompt_FileExpert() string {
	return gulinbase.GetPrompt("FileExpert.md")
}

// GetSystemPrompt_WebExpert especializado en navegación
func GetSystemPrompt_WebExpert() string {
	return gulinbase.GetPrompt("WebExpert.md")
}

// GetSystemPrompt_CommandExpert especializado en terminal y sistema
func GetSystemPrompt_CommandExpert() string {
	return gulinbase.GetPrompt("CommandExpert.md")
}
// GetSystemPrompt_NeuralBrain define las instrucciones para el Mapa 3D y registro de infraestructura
func GetSystemPrompt_NeuralBrain() string {
	return gulinbase.GetPrompt("NeuralBrain.md")
}
