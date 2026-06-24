// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workspaceservice

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/gulindev/gulin/pkg/blockcontroller"
	"github.com/gulindev/gulin/pkg/panichandler"
	"github.com/gulindev/gulin/pkg/tsgen/tsgenmeta"
	"github.com/gulindev/gulin/pkg/gulinobj"
	"github.com/gulindev/gulin/pkg/wcore"
	"github.com/gulindev/gulin/pkg/wps"
	"github.com/gulindev/gulin/pkg/wstore"
)

const DefaultTimeout = 2 * time.Second

type WorkspaceService struct{}

func (svc *WorkspaceService) CreateWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"ctx", "name", "icon", "color", "applyDefaults"},
		ReturnDesc: "workspaceId",
	}
}

func (svc *WorkspaceService) CreateWorkspace(ctx context.Context, name string, icon string, color string, applyDefaults bool) (string, error) {
	newWS, err := wcore.CreateWorkspace(ctx, name, icon, color, applyDefaults, false)
	if err != nil {
		return "", fmt.Errorf("error creating workspace: %w", err)
	}
	return newWS.OID, nil
}

func (svc *WorkspaceService) UpdateWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"ctx", "workspaceId", "name", "icon", "color", "applyDefaults"},
	}
}

func (svc *WorkspaceService) UpdateWorkspace(ctx context.Context, workspaceId string, name string, icon string, color string, applyDefaults bool) (gulinobj.UpdatesRtnType, error) {
	ctx = gulinobj.ContextWithUpdates(ctx)
	_, updated, err := wcore.UpdateWorkspace(ctx, workspaceId, name, icon, color, applyDefaults)
	if err != nil {
		return nil, fmt.Errorf("error updating workspace: %w", err)
	}
	if !updated {
		return nil, nil
	}

	wps.Broker.Publish(wps.GulinEvent{
		Event: wps.Event_WorkspaceUpdate,
	})

	updates := gulinobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WorkspaceService:UpdateWorkspace:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return updates, nil
}

func (svc *WorkspaceService) GetWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"workspaceId"},
		ReturnDesc: "workspace",
	}
}

func (svc *WorkspaceService) GetWorkspace(workspaceId string) (*gulinobj.Workspace, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ws, err := wstore.DBGet[*gulinobj.Workspace](ctx, workspaceId)
	if err != nil {
		return nil, fmt.Errorf("error getting workspace: %w", err)
	}
	return ws, nil
}

func (svc *WorkspaceService) DeleteWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"workspaceId"},
	}
}

func (svc *WorkspaceService) DeleteWorkspace(workspaceId string) (gulinobj.UpdatesRtnType, string, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = gulinobj.ContextWithUpdates(ctx)
	deleted, claimableWorkspace, err := wcore.DeleteWorkspace(ctx, workspaceId, true)
	if claimableWorkspace != "" {
		return nil, claimableWorkspace, nil
	}
	if err != nil {
		return nil, claimableWorkspace, fmt.Errorf("error deleting workspace: %w", err)
	}
	if !deleted {
		return nil, claimableWorkspace, nil
	}
	updates := gulinobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WorkspaceService:DeleteWorkspace:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return updates, claimableWorkspace, nil
}

func (svc *WorkspaceService) ListWorkspaces() (gulinobj.WorkspaceList, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	return wcore.ListWorkspaces(ctx)
}

func (svc *WorkspaceService) CreateTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"workspaceId", "tabName", "activateTab"},
		ReturnDesc: "tabId",
	}
}

func (svc *WorkspaceService) GetColors_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ReturnDesc: "colors",
	}
}

func (svc *WorkspaceService) GetColors() []string {
	return wcore.WorkspaceColors[:]
}

func (svc *WorkspaceService) GetIcons_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ReturnDesc: "icons",
	}
}

func (svc *WorkspaceService) GetIcons() []string {
	return wcore.WorkspaceIcons[:]
}

func (svc *WorkspaceService) CreateTab(workspaceId string, tabName string, activateTab bool) (string, gulinobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = gulinobj.ContextWithUpdates(ctx)
	tabId, err := wcore.CreateTab(ctx, workspaceId, tabName, activateTab, false)
	if err != nil {
		return "", nil, fmt.Errorf("error creating tab: %w", err)
	}
	updates := gulinobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WorkspaceService:CreateTab:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return tabId, updates, nil
}

func (svc *WorkspaceService) UpdateTabIds_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "workspaceId", "tabIds"},
	}
}

func (svc *WorkspaceService) UpdateTabIds(uiContext gulinobj.UIContext, workspaceId string, tabIds []string) (gulinobj.UpdatesRtnType, error) {
	log.Printf("UpdateTabIds %s %v\n", workspaceId, tabIds)
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = gulinobj.ContextWithUpdates(ctx)
	err := wcore.UpdateWorkspaceTabIds(ctx, workspaceId, tabIds)
	if err != nil {
		return nil, fmt.Errorf("error updating workspace tab ids: %w", err)
	}
	return gulinobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *WorkspaceService) SetActiveTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"workspaceId", "tabId"},
	}
}

func (svc *WorkspaceService) SetActiveTab(workspaceId string, tabId string) (gulinobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = gulinobj.ContextWithUpdates(ctx)
	err := wcore.SetActiveTab(ctx, workspaceId, tabId)
	if err != nil {
		return nil, fmt.Errorf("error setting active tab: %w", err)
	}
	// check all blocks in tab and start controllers (if necessary)
	tab, err := wstore.DBMustGet[*gulinobj.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab: %w", err)
	}
	blockORefs := tab.GetBlockORefs()
	blocks, err := wstore.DBSelectORefs(ctx, blockORefs)
	if err != nil {
		return nil, fmt.Errorf("error getting tab blocks: %w", err)
	}
	updates := gulinobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WorkspaceService:SetActiveTab:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	var extraUpdates gulinobj.UpdatesRtnType
	extraUpdates = append(extraUpdates, updates...)
	extraUpdates = append(extraUpdates, gulinobj.MakeUpdate(tab))
	extraUpdates = append(extraUpdates, gulinobj.MakeUpdates(blocks)...)
	return extraUpdates, nil
}

type CloseTabRtnType struct {
	CloseWindow    bool   `json:"closewindow,omitempty"`
	NewActiveTabId string `json:"newactivetabid,omitempty"`
}

func (svc *WorkspaceService) CloseTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"ctx", "workspaceId", "tabId", "fromElectron"},
		ReturnDesc: "CloseTabRtn",
	}
}

// returns the new active tabid
func (svc *WorkspaceService) CloseTab(ctx context.Context, workspaceId string, tabId string, fromElectron bool) (*CloseTabRtnType, gulinobj.UpdatesRtnType, error) {
	ctx = gulinobj.ContextWithUpdates(ctx)
	tab, err := wstore.DBGet[*gulinobj.Tab](ctx, tabId)
	if err == nil && tab != nil {
		go func() {
			for _, blockId := range tab.BlockIds {
				blockcontroller.DestroyBlockController(blockId)
			}
		}()
	}
	newActiveTabId, err := wcore.DeleteTab(ctx, workspaceId, tabId, true)
	if err != nil {
		return nil, nil, fmt.Errorf("error closing tab: %w", err)
	}
	rtn := &CloseTabRtnType{}
	if newActiveTabId == "" {
		rtn.CloseWindow = true
	} else {
		rtn.NewActiveTabId = newActiveTabId
	}
	updates := gulinobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WorkspaceService:CloseTab:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return rtn, updates, nil
}
