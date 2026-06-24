// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package windowservice

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/gulindev/gulin/pkg/eventbus"
	"github.com/gulindev/gulin/pkg/panichandler"
	"github.com/gulindev/gulin/pkg/tsgen/tsgenmeta"
	"github.com/gulindev/gulin/pkg/gulinobj"
	"github.com/gulindev/gulin/pkg/wcore"
	"github.com/gulindev/gulin/pkg/wps"
	"github.com/gulindev/gulin/pkg/wstore"
)

const DefaultTimeout = 2 * time.Second

type WindowService struct{}

func (svc *WindowService) GetWindow_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"windowId"},
	}
}

func (svc *WindowService) GetWindow(windowId string) (*gulinobj.Window, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	window, err := wstore.DBGet[*gulinobj.Window](ctx, windowId)
	if err != nil {
		return nil, fmt.Errorf("error getting window: %w", err)
	}
	return window, nil
}

func (svc *WindowService) CreateWindow_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"ctx", "winSize", "workspaceId"},
	}
}

func (svc *WindowService) CreateWindow(ctx context.Context, winSize *gulinobj.WinSize, workspaceId string) (*gulinobj.Window, error) {
	window, err := wcore.CreateWindow(ctx, winSize, workspaceId)
	if err != nil {
		return nil, fmt.Errorf("error creating window: %w", err)
	}
	return window, nil
}

func (svc *WindowService) SetWindowPosAndSize_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "set window position and size",
		ArgNames: []string{"ctx", "windowId", "pos", "size"},
	}
}

func (ws *WindowService) SetWindowPosAndSize(ctx context.Context, windowId string, pos *gulinobj.Point, size *gulinobj.WinSize) (gulinobj.UpdatesRtnType, error) {
	if pos == nil && size == nil {
		return nil, nil
	}
	ctx = gulinobj.ContextWithUpdates(ctx)
	win, err := wstore.DBMustGet[*gulinobj.Window](ctx, windowId)
	if err != nil {
		return nil, err
	}
	if pos != nil {
		win.Pos = *pos
	}
	if size != nil {
		win.WinSize = *size
	}
	win.IsNew = false
	err = wstore.DBUpdate(ctx, win)
	if err != nil {
		return nil, err
	}
	return gulinobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *WindowService) MoveBlockToNewWindow_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "move block to new window",
		ArgNames: []string{"ctx", "currentTabId", "blockId"},
	}
}

func (svc *WindowService) MoveBlockToNewWindow(ctx context.Context, currentTabId string, blockId string) (gulinobj.UpdatesRtnType, error) {
	log.Printf("MoveBlockToNewWindow(%s, %s)", currentTabId, blockId)
	ctx = gulinobj.ContextWithUpdates(ctx)
	tab, err := wstore.DBMustGet[*gulinobj.Tab](ctx, currentTabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab: %w", err)
	}
	log.Printf("tab.BlockIds[%s]: %v", tab.OID, tab.BlockIds)
	var foundBlock bool
	for _, tabBlockId := range tab.BlockIds {
		if tabBlockId == blockId {
			foundBlock = true
			break
		}
	}
	if !foundBlock {
		return nil, fmt.Errorf("block not found in current tab")
	}
	newWindow, err := wcore.CreateWindow(ctx, nil, "")
	if err != nil {
		return nil, fmt.Errorf("error creating window: %w", err)
	}
	ws, err := wcore.GetWorkspace(ctx, newWindow.WorkspaceId)
	if err != nil {
		return nil, fmt.Errorf("error getting workspace: %w", err)
	}
	err = wstore.MoveBlockToTab(ctx, currentTabId, ws.ActiveTabId, blockId)
	if err != nil {
		return nil, fmt.Errorf("error moving block to tab: %w", err)
	}
	eventbus.SendEventToElectron(eventbus.WSEventType{
		EventType: eventbus.WSEvent_ElectronNewWindow,
		Data:      newWindow.OID,
	})
	windowCreated := eventbus.BusyWaitForWindowId(newWindow.OID, 2*time.Second)
	if !windowCreated {
		return nil, fmt.Errorf("new window not created")
	}
	wcore.QueueLayoutActionForTab(ctx, currentTabId, gulinobj.LayoutActionData{
		ActionType: wcore.LayoutActionDataType_Remove,
		BlockId:    blockId,
	})
	wcore.QueueLayoutActionForTab(ctx, ws.ActiveTabId, gulinobj.LayoutActionData{
		ActionType: wcore.LayoutActionDataType_Insert,
		BlockId:    blockId,
		Focused:    true,
	})
	return gulinobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *WindowService) SwitchWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"ctx", "windowId", "workspaceId"},
	}
}

func (svc *WindowService) SwitchWorkspace(ctx context.Context, windowId string, workspaceId string) (*gulinobj.Workspace, error) {
	ctx = gulinobj.ContextWithUpdates(ctx)
	ws, err := wcore.SwitchWorkspace(ctx, windowId, workspaceId)

	updates := gulinobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WindowService:SwitchWorkspace:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return ws, err
}

func (svc *WindowService) CloseWindow_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"ctx", "windowId", "fromElectron"},
	}
}

func (svc *WindowService) CloseWindow(ctx context.Context, windowId string, fromElectron bool) error {
	ctx = gulinobj.ContextWithUpdates(ctx)
	return wcore.CloseWindow(ctx, windowId, fromElectron)
}
