// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/gulindev/gulin/pkg/gulinobj"
	"github.com/gulindev/gulin/pkg/wstore"
)

const (
	LayoutActionDataType_Insert          = "insert"
	LayoutActionDataType_InsertAtIndex   = "insertatindex"
	LayoutActionDataType_Remove          = "delete"
	LayoutActionDataType_ClearTree       = "clear"
	LayoutActionDataType_Replace         = "replace"
	LayoutActionDataType_SplitHorizontal = "splithorizontal"
	LayoutActionDataType_SplitVertical   = "splitvertical"
	LayoutActionDataType_CleanupOrphaned = "cleanuporphaned"
)

type PortableLayout []struct {
	IndexArr []int             `json:"indexarr"`
	Size     *uint             `json:"size,omitempty"`
	BlockDef *gulinobj.BlockDef `json:"blockdef"`
	Focused  bool              `json:"focused"`
}

func GetStarterLayout() PortableLayout {
	return PortableLayout{
		{IndexArr: []int{0}, BlockDef: &gulinobj.BlockDef{
			Meta: gulinobj.MetaMapType{
				gulinobj.MetaKey_View:       "term",
				gulinobj.MetaKey_Controller: "shell",
			},
		}, Focused: true},
		{IndexArr: []int{1}, BlockDef: &gulinobj.BlockDef{
			Meta: gulinobj.MetaMapType{
				gulinobj.MetaKey_View: "sysinfo",
			},
		}},
		{IndexArr: []int{1, 1}, BlockDef: &gulinobj.BlockDef{
			Meta: gulinobj.MetaMapType{
				gulinobj.MetaKey_View: "web",
				gulinobj.MetaKey_Url:  "https://github.com/gulindev/gulin",
			},
		}},
		{IndexArr: []int{1, 2}, BlockDef: &gulinobj.BlockDef{
			Meta: gulinobj.MetaMapType{
				gulinobj.MetaKey_View: "preview",
				gulinobj.MetaKey_File: "~",
			},
		}},
	}
}

func GetNewTabLayout() PortableLayout {
	return PortableLayout{
		{IndexArr: []int{0}, BlockDef: &gulinobj.BlockDef{
			Meta: gulinobj.MetaMapType{
				gulinobj.MetaKey_View:       "term",
				gulinobj.MetaKey_Controller: "shell",
			},
		}, Focused: true},
	}
}

func GetLayoutIdForTab(ctx context.Context, tabId string) (string, error) {
	tabObj, err := wstore.DBGet[*gulinobj.Tab](ctx, tabId)
	if err != nil {
		return "", fmt.Errorf("unable to get layout id for given tab id %s: %w", tabId, err)
	}
	return tabObj.LayoutState, nil
}

func QueueLayoutAction(ctx context.Context, layoutStateId string, actions ...gulinobj.LayoutActionData) error {
	layoutStateObj, err := wstore.DBGet[*gulinobj.LayoutState](ctx, layoutStateId)
	if err != nil {
		return fmt.Errorf("unable to get layout state for given id %s: %w", layoutStateId, err)
	}

	for i := range actions {
		if actions[i].ActionId == "" {
			actions[i].ActionId = uuid.New().String()
		}
	}

	if layoutStateObj.PendingBackendActions == nil {
		layoutStateObj.PendingBackendActions = &actions
	} else {
		*layoutStateObj.PendingBackendActions = append(*layoutStateObj.PendingBackendActions, actions...)
	}

	err = wstore.DBUpdate(ctx, layoutStateObj)
	if err != nil {
		return fmt.Errorf("unable to update layout state with new actions: %w", err)
	}
	return nil
}

func QueueLayoutActionForTab(ctx context.Context, tabId string, actions ...gulinobj.LayoutActionData) error {
	layoutStateId, err := GetLayoutIdForTab(ctx, tabId)
	if err != nil {
		return err
	}

	return QueueLayoutAction(ctx, layoutStateId, actions...)
}

func ApplyPortableLayout(ctx context.Context, tabId string, layout PortableLayout, recordTelemetry bool) error {
	actions := make([]gulinobj.LayoutActionData, len(layout)+1)
	actions[0] = gulinobj.LayoutActionData{ActionType: LayoutActionDataType_ClearTree}
	for i := 0; i < len(layout); i++ {
		layoutAction := layout[i]

		blockData, err := CreateBlockWithTelemetry(ctx, tabId, layoutAction.BlockDef, &gulinobj.RuntimeOpts{}, recordTelemetry)
		if err != nil {
			return fmt.Errorf("unable to create block to apply portable layout to tab %s: %w", tabId, err)
		}

		actions[i+1] = gulinobj.LayoutActionData{
			ActionType: LayoutActionDataType_InsertAtIndex,
			BlockId:    blockData.OID,
			IndexArr:   &layoutAction.IndexArr,
			NodeSize:   layoutAction.Size,
			Focused:    layoutAction.Focused,
		}
	}

	err := QueueLayoutActionForTab(ctx, tabId, actions...)
	if err != nil {
		return fmt.Errorf("unable to queue layout actions for portable layout: %w", err)
	}

	return nil
}

func BootstrapStarterLayout(ctx context.Context) error {
	ctx, cancelFn := context.WithTimeout(ctx, 2*time.Second)
	defer cancelFn()
	client, err := wstore.DBGetSingleton[*gulinobj.Client](ctx)
	if err != nil {
		log.Printf("unable to find client: %v\n", err)
		return fmt.Errorf("unable to find client: %w", err)
	}

	if len(client.WindowIds) < 1 {
		return fmt.Errorf("error bootstrapping layout, no windows exist")
	}

	windowId := client.WindowIds[0]

	window, err := wstore.DBMustGet[*gulinobj.Window](ctx, windowId)
	if err != nil {
		return fmt.Errorf("error getting window: %w", err)
	}

	workspace, err := wstore.DBMustGet[*gulinobj.Workspace](ctx, window.WorkspaceId)
	if err != nil {
		return fmt.Errorf("error getting workspace: %w", err)
	}

	tabId := workspace.ActiveTabId

	starterLayout := GetStarterLayout()
	err = ApplyPortableLayout(ctx, tabId, starterLayout, false)
	if err != nil {
		return fmt.Errorf("error applying starter layout: %w", err)
	}

	return nil
}
