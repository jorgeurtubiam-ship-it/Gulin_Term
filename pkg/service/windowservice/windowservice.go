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

func (svc *WindowService) PopOutBlockDefToNewWindow_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "create a new window and insert a block created from blockDef",
		ArgNames: []string{"ctx", "blockDef"},
	}
}

func (svc *WindowService) PopOutBlockDefToNewWindow(ctx context.Context, blockDef *gulinobj.BlockDef) (gulinobj.UpdatesRtnType, error) {
	log.Printf("PopOutBlockDefToNewWindow()")
	ctx = gulinobj.ContextWithUpdates(ctx)
	newWindow, err := wcore.CreateWindow(ctx, nil, "")
	if err != nil {
		return nil, fmt.Errorf("error creating window: %w", err)
	}

	if newWindow.Meta == nil {
		newWindow.Meta = make(gulinobj.MetaMapType)
	}
	newWindow.Meta["bare"] = true
	wstore.DBUpdate(ctx, newWindow)

	ws, err := wcore.GetWorkspace(ctx, newWindow.WorkspaceId)
	if err != nil {
		return nil, fmt.Errorf("error getting workspace: %w", err)
	}
	if blockDef.Meta == nil {
		blockDef.Meta = make(gulinobj.MetaMapType)
	}
	blockDef.Meta["noheader"] = true

	newTab, err := wstore.DBMustGet[*gulinobj.Tab](ctx, ws.ActiveTabId)
	if err == nil && len(newTab.BlockIds) > 0 {
		for _, bId := range newTab.BlockIds {
			wcore.DeleteBlock(ctx, bId, false)
		}
	}

	err = wcore.ApplyPortableLayout(ctx, ws.ActiveTabId, wcore.PortableLayout{
		{
			IndexArr: []int{0},
			BlockDef: blockDef,
			Focused:  true,
		},
	}, false)
	if err != nil {
		return nil, fmt.Errorf("error applying portable layout for popout: %w", err)
	}

	eventbus.SendEventToElectron(eventbus.WSEventType{
		EventType: eventbus.WSEvent_ElectronNewWindow,
		Data:      newWindow.OID,
	})

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
	block, err := wstore.DBMustGet[*gulinobj.Block](ctx, blockId)
	if err != nil || block == nil {
		return nil, fmt.Errorf("error getting block: %v", err)
	}
	parentORef := gulinobj.ParseORefNoErr(block.ParentORef)
	if parentORef == nil || parentORef.OType != gulinobj.OType_Tab {
		return nil, fmt.Errorf("block parent is not a tab")
	}
	actualTabId := parentORef.OID

	newWindow, err := wcore.CreateWindow(ctx, nil, "")
	if err != nil {
		return nil, fmt.Errorf("error creating window: %w", err)
	}
	if newWindow.Meta == nil {
		newWindow.Meta = make(gulinobj.MetaMapType)
	}
	newWindow.Meta["bare"] = true
	wstore.DBUpdate(ctx, newWindow)
	ws, err := wcore.GetWorkspace(ctx, newWindow.WorkspaceId)
	if err != nil {
		return nil, fmt.Errorf("error getting workspace: %w", err)
	}
	
	var targetBlockId string
	// The new window has a default terminal block. Delete it so the window only has our block.
	newTab, err := wstore.DBMustGet[*gulinobj.Tab](ctx, ws.ActiveTabId)
	if err == nil && len(newTab.BlockIds) > 0 {
		targetBlockId = newTab.BlockIds[0]
		wcore.DeleteBlock(ctx, targetBlockId, false)
	}

	err = wstore.MoveBlockToTab(ctx, actualTabId, ws.ActiveTabId, blockId)
	if err != nil {
		return nil, fmt.Errorf("error moving block to tab: %w", err)
	}

	wcore.QueueLayoutActionForTab(ctx, actualTabId, gulinobj.LayoutActionData{
		ActionType: wcore.LayoutActionDataType_Remove,
		BlockId:    blockId,
	})

	actionType := wcore.LayoutActionDataType_Insert
	if targetBlockId != "" {
		actionType = wcore.LayoutActionDataType_Replace
	}

	wcore.QueueLayoutActionForTab(ctx, ws.ActiveTabId, gulinobj.LayoutActionData{
		ActionType:    actionType,
		BlockId:       blockId,
		TargetBlockId: targetBlockId,
		Focused:       true,
	})

	eventbus.SendEventToElectron(eventbus.WSEventType{
		EventType: eventbus.WSEvent_ElectronNewWindow,
		Data:      newWindow.OID,
	})
	// Note: We do NOT send a Remove layout action to the original tab here.
	// MoveBlockToTab already removed the block from the original tab's blockids.
	// Sending a Remove layout action would cause the original TileLayout to call
	// onNodeDelete, which would permanently delete the block from the database.
	

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
