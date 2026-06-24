// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"sync"

	"github.com/gulindev/gulin/pkg/util/utilfn"
	"github.com/gulindev/gulin/pkg/gulinbase"
	"github.com/gulindev/gulin/pkg/gulinobj"
)

func init() {
	for _, rtype := range gulinobj.AllGulinObjTypes() {
		gulinobj.RegisterType(rtype)
	}
}

var (
	clientIdLock   sync.Mutex
	cachedClientId string
)

func SetClientId(clientId string) {
	clientIdLock.Lock()
	defer clientIdLock.Unlock()
	cachedClientId = clientId
}

// in the main server, this will not return empty string
// it does return empty in wsh, but all wstore methods are invalid in wsh mode, so that shouldn't be an issue
func GetClientId() string {
	clientIdLock.Lock()
	defer clientIdLock.Unlock()
	if gulinbase.IsDevMode() && cachedClientId == "" {
		panic("cachedClientId is empty")
	}
	return cachedClientId
}

func UpdateTabName(ctx context.Context, tabId, name string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		tab, _ := DBGet[*gulinobj.Tab](tx.Context(), tabId)
		if tab == nil {
			return fmt.Errorf("tab not found: %q", tabId)
		}
		if tabId != "" {
			tab.Name = name
			DBUpdate(tx.Context(), tab)
		}
		return nil
	})
}

func UpdateObjectMeta(ctx context.Context, oref gulinobj.ORef, meta gulinobj.MetaMapType, mergeSpecial bool) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		if oref.IsEmpty() {
			return fmt.Errorf("empty object reference")
		}
		obj, _ := DBGetORef(tx.Context(), oref)
		if obj == nil {
			return ErrNotFound
		}
		objMeta := gulinobj.GetMeta(obj)
		if objMeta == nil {
			objMeta = make(map[string]any)
		}
		newMeta := gulinobj.MergeMeta(objMeta, meta, mergeSpecial)
		gulinobj.SetMeta(obj, newMeta)
		DBUpdate(tx.Context(), obj)
		return nil
	})
}

func MoveBlockToTab(ctx context.Context, currentTabId string, newTabId string, blockId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		block, _ := DBGet[*gulinobj.Block](tx.Context(), blockId)
		if block == nil {
			return fmt.Errorf("block not found: %q", blockId)
		}
		currentTab, _ := DBGet[*gulinobj.Tab](tx.Context(), currentTabId)
		if currentTab == nil {
			return fmt.Errorf("current tab not found: %q", currentTabId)
		}
		newTab, _ := DBGet[*gulinobj.Tab](tx.Context(), newTabId)
		if newTab == nil {
			return fmt.Errorf("new tab not found: %q", newTabId)
		}
		blockIdx := utilfn.FindStringInSlice(currentTab.BlockIds, blockId)
		if blockIdx == -1 {
			return fmt.Errorf("block not found in current tab: %q", blockId)
		}
		currentTab.BlockIds = utilfn.RemoveElemFromSlice(currentTab.BlockIds, blockId)
		newTab.BlockIds = append(newTab.BlockIds, blockId)
		block.ParentORef = gulinobj.MakeORef(gulinobj.OType_Tab, newTabId).String()
		DBUpdate(tx.Context(), block)
		DBUpdate(tx.Context(), currentTab)
		DBUpdate(tx.Context(), newTab)
		return nil
	})
}
