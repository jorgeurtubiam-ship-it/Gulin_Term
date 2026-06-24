// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/gulindev/gulin/pkg/gulinobj"
	"github.com/gulindev/gulin/pkg/wshrpc"
	"github.com/gulindev/gulin/pkg/wshrpc/wshclient"
)

var editConfigMagnified bool

var editConfigCmd = &cobra.Command{
	Use:     "editconfig [configfile]",
	Short:   "edit Gulin configuration files",
	Long:    "Edit Gulin configuration files. Defaults to settings.json if no file specified. Common files: settings.json, presets.json, widgets.json",
	Args:    cobra.MaximumNArgs(1),
	RunE:    editConfigRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	editConfigCmd.Flags().BoolVarP(&editConfigMagnified, "magnified", "m", false, "open config in magnified mode")
	rootCmd.AddCommand(editConfigCmd)
}

func editConfigRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("editconfig", rtnErr == nil)
	}()

	configFile := "settings.json" // default
	if len(args) > 0 {
		configFile = args[0]
	}

	tabId := getTabIdFromEnv()
	if tabId == "" {
		return fmt.Errorf("no GULIN_TABID env var set")
	}

	wshCmd := &wshrpc.CommandCreateBlockData{
		TabId: tabId,
		BlockDef: &gulinobj.BlockDef{
			Meta: map[string]interface{}{
				gulinobj.MetaKey_View: "gulinconfig",
				gulinobj.MetaKey_File: configFile,
			},
		},
		Magnified: editConfigMagnified,
		Focused:   true,
	}

	_, err := wshclient.CreateBlockCommand(RpcClient, *wshCmd, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("opening config file: %w", err)
	}
	return nil
}
