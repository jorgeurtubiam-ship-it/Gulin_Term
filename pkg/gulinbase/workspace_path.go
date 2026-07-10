// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gulinbase

import (
	"path/filepath"
)

// GetWorkspacePath returns the appropriate path for GuLiN project data.
// It prioritizes a workspace setting if available, otherwise defaults to local.
func GetWorkspacePath(currentDir string) string {
	// Ya no forzamos ".gulin". Devolvemos el directorio de configuración del sistema (usualmente Gulin_Workspace)
	// o si currentDir está provisto, un path relativo seguro.
	// Por defecto, apuntamos al root del GulinDataDir si no hay un path superior configurado.
	dataDir := GetGulinDataDir()
	if dataDir != "" {
		return filepath.Dir(dataDir) // Esto resolverá a ~/Gulin_Workspace
	}
	return filepath.Join(currentDir, "Gulin_Workspace")
}
