// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gulinbase

import (
	"path/filepath"
)

// GetWorkspacePath returns the appropriate path for GuLiN project data.
// It prioritizes a workspace setting if available, otherwise defaults to local.
func GetWorkspacePath(currentDir string) string {
	// TODO: Implementar lógica de búsqueda de configuración global/workspace
	// Si no hay configuración de workspace, fallback al comportamiento actual.
	return filepath.Join(currentDir, ".gulin")
}
