// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"github.com/gulindev/gulin/cmd/wsh/cmd"
	"github.com/gulindev/gulin/pkg/gulinbase"
)

// set by main-server.go
var GulinVersion = "0.0.0"
var BuildTime = "0"

func main() {
	gulinbase.GulinVersion = GulinVersion
	gulinbase.BuildTime = BuildTime
	cmd.Execute()
}
