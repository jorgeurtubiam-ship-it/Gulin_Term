// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientService, ObjectService, WindowService, WorkspaceService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { fireAndForget } from "@/util/util";
import { BaseWindow, BaseWindowConstructorOptions, dialog, globalShortcut, ipcMain, screen } from "electron";
import { globalEvents } from "emain/emain-events";
import path from "path";
import { debounce } from "throttle-debounce";
import {
    getGlobalIsQuitting,
    getGlobalIsRelaunching,
    setGlobalIsRelaunching,
    setWasActive,
    setWasInFg,
} from "./emain-activity";
import { log } from "./emain-log";
import { getElectronAppBasePath, unamePlatform } from "./emain-platform";
import { getOrCreateWebViewForTab, getGulinTabViewByWebContentsId, GulinTabView } from "./emain-tabview";
import { delay, ensureBoundsAreVisible, gulinKeyToElectronKey } from "./emain-util";
import { ElectronWshClient } from "./emain-wsh";
import { updater } from "./updater";

export type WindowOpts = {
    unamePlatform: NodeJS.Platform;
    isPrimaryStartupWindow?: boolean;
    foregroundWindow?: boolean;
};

export const MinWindowWidth = 800;
export const MinWindowHeight = 500;

export function calculateWindowBounds(
    winSize?: { width?: number; height?: number },
    pos?: { x?: number; y?: number },
    settings?: any
): { x: number; y: number; width: number; height: number } {
    let winWidth = winSize?.width;
    let winHeight = winSize?.height;
    let winPosX = pos?.x ?? 100;
    let winPosY = pos?.y ?? 100;

    if (
        (winWidth == null || winWidth === 0 || winHeight == null || winHeight === 0) &&
        settings?.["window:dimensions"]
    ) {
        const dimensions = settings["window:dimensions"];
        const match = dimensions.match(/^(\d+)[xX](\d+)$/);

        if (match) {
            const [, dimensionWidth, dimensionHeight] = match;
            const parsedWidth = parseInt(dimensionWidth, 10);
            const parsedHeight = parseInt(dimensionHeight, 10);

            if ((!winWidth || winWidth === 0) && Number.isFinite(parsedWidth) && parsedWidth > 0) {
                winWidth = parsedWidth;
            }
            if ((!winHeight || winHeight === 0) && Number.isFinite(parsedHeight) && parsedHeight > 0) {
                winHeight = parsedHeight;
            }
        } else {
            console.warn('Invalid window:dimensions format. Expected "widthxheight".');
        }
    }

    if (winWidth == null || winWidth == 0) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width } = primaryDisplay.workAreaSize;
        winWidth = width - winPosX - 100;
        if (winWidth > 2000) {
            winWidth = 2000;
        }
    }
    if (winHeight == null || winHeight == 0) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { height } = primaryDisplay.workAreaSize;
        winHeight = height - winPosY - 100;
        if (winHeight > 1200) {
            winHeight = 1200;
        }
    }

    winWidth = Math.max(winWidth, MinWindowWidth);
    winHeight = Math.max(winHeight, MinWindowHeight);

    let winBounds = {
        x: winPosX,
        y: winPosY,
        width: winWidth,
        height: winHeight,
    };
    return ensureBoundsAreVisible(winBounds);
}

export const gulinWindowMap = new Map<string, GulinBrowserWindow>(); // gulinWindowId -> GulinBrowserWindow

// on blur we do not set this to null (but on destroy we do), so this tracks the *last* focused window
// e.g. it persists when the app itself is not focused
export let focusedGulinWindow: GulinBrowserWindow = null;

let cachedClientId: string = null;
let hasCompletedFirstRelaunch = false;

async function getClientId() {
    if (cachedClientId != null) {
        return cachedClientId;
    }
    const clientData = await ClientService.GetClientData();
    cachedClientId = clientData?.oid;
    return cachedClientId;
}

type WindowActionQueueEntry =
    | {
          op: "switchtab";
          tabId: string;
          setInBackend: boolean;
          primaryStartupTab?: boolean;
      }
    | {
          op: "createtab";
      }
    | {
          op: "closetab";
          tabId: string;
      }
    | {
          op: "switchworkspace";
          workspaceId: string;
      };

function isNonEmptyUnsavedWorkspace(workspace: Workspace): boolean {
    return !workspace.name && !workspace.icon && workspace.tabids?.length > 1;
}

export class GulinBrowserWindow extends BaseWindow {
    gulinWindowId: string;
    workspaceId: string;
    allLoadedTabViews: Map<string, GulinTabView>;
    activeTabView: GulinTabView;
    private canClose: boolean;
    private deleteAllowed: boolean;
    private actionQueue: WindowActionQueueEntry[];

    constructor(gulinWindow: GulinWindow, fullConfig: FullConfigType, opts: WindowOpts) {
        const settings = fullConfig?.settings;

        console.log("create win", gulinWindow.oid);
        const winBounds = calculateWindowBounds(gulinWindow.winsize, gulinWindow.pos, settings);
        const winOpts: BaseWindowConstructorOptions = {
            x: winBounds.x,
            y: winBounds.y,
            width: winBounds.width,
            height: winBounds.height,
            minWidth: MinWindowWidth,
            minHeight: MinWindowHeight,
            show: true,
        };

        const isTransparent = settings?.["window:transparent"] ?? false;
        const isBlur = settings?.["window:blur"] ?? false;

        if (opts.unamePlatform === "darwin") {
            winOpts.titleBarStyle = "hiddenInset";
            winOpts.titleBarOverlay = false;
            winOpts.autoHideMenuBar = !settings?.["window:showmenubar"];
            if (isTransparent) {
                winOpts.transparent = true;
            }
            if (isBlur) {
                winOpts.vibrancy = "under-window";
            }
        } else if (opts.unamePlatform === "linux") {
            winOpts.titleBarStyle = settings["window:nativetitlebar"] ? "default" : "hidden";
            winOpts.titleBarOverlay = {
                symbolColor: "white",
                color: "#00000000",
            };
            winOpts.icon = path.join(getElectronAppBasePath(), "public/logos/gulin-logo-dark.png");
            winOpts.autoHideMenuBar = !settings?.["window:showmenubar"];
            if (isTransparent) {
                winOpts.transparent = true;
            } else {
                winOpts.backgroundColor = "#222222";
            }
        } else if (opts.unamePlatform === "win32") {
            winOpts.titleBarStyle = "hidden";
            winOpts.titleBarOverlay = {
                color: "#222222",
                symbolColor: "#c3c8c2",
                height: 32,
            };
            if (isTransparent) {
                winOpts.transparent = true;
            } else if (isBlur) {
                winOpts.backgroundMaterial = "acrylic";
            } else {
                winOpts.backgroundColor = "#222222";
            }
        }

        super(winOpts);

        if (opts.unamePlatform === "win32") {
            this.setMenu(null);
        }

        const fullscreenOnLaunch = fullConfig?.settings["window:fullscreenonlaunch"];
        if (fullscreenOnLaunch && opts.foregroundWindow) {
            this.once("show", () => {
                this.setFullScreen(true);
            });
        }
        this.actionQueue = [];
        this.gulinWindowId = gulinWindow.oid;
        this.workspaceId = gulinWindow.workspaceid;
        this.allLoadedTabViews = new Map<string, GulinTabView>();
        const winBoundsPoller = setInterval(() => {
            if (this.isDestroyed()) {
                clearInterval(winBoundsPoller);
                return;
            }
            if (this.actionQueue.length > 0) {
                return;
            }
            this.finalizePositioning();
        }, 1000);
        this.on(
            // @ts-expect-error -- "resize" event with debounce handler not in Electron type definitions
            "resize",
            debounce(400, (e) => this.mainResizeHandler(e))
        );
        this.on("resize", () => {
            if (this.isDestroyed()) {
                return;
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on(
            // @ts-expect-error -- "move" event with debounce handler not in Electron type definitions
            "move",
            debounce(400, (e) => this.mainResizeHandler(e))
        );
        this.on("enter-full-screen", async () => {
            if (this.isDestroyed()) {
                return;
            }
            console.log("enter-full-screen event", this.getContentBounds());
            const tabView = this.activeTabView;
            if (tabView) {
                tabView.webContents.send("fullscreen-change", true);
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on("leave-full-screen", async () => {
            if (this.isDestroyed()) {
                return;
            }
            const tabView = this.activeTabView;
            if (tabView) {
                tabView.webContents.send("fullscreen-change", false);
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on("focus", () => {
            if (this.isDestroyed()) {
                return;
            }
            if (getGlobalIsRelaunching()) {
                return;
            }
            console.log("focus win", this.gulinWindowId);
            fireAndForget(() => ClientService.FocusWindow(this.gulinWindowId));
            setWasInFg(true);
            setWasActive(true);
            setTimeout(() => globalEvents.emit("windows-updated"), 50);
        });
        this.on("blur", () => {
            setTimeout(() => globalEvents.emit("windows-updated"), 50);
        });
        this.on("close", (e) => {
            if (this.canClose) {
                return;
            }
            if (this.isDestroyed()) {
                return;
            }
            console.log("win 'close' handler fired", this.gulinWindowId);
            if (getGlobalIsQuitting() || updater?.status == "installing" || getGlobalIsRelaunching()) {
                return;
            }
            e.preventDefault();
            fireAndForget(async () => {
                const numWindows = gulinWindowMap.size;
                const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
                if (numWindows > 1 || !fullConfig.settings["window:savelastwindow"]) {
                    if (fullConfig.settings["window:confirmclose"]) {
                        const workspace = await WorkspaceService.GetWorkspace(this.workspaceId);
                        if (isNonEmptyUnsavedWorkspace(workspace)) {
                            const choice = dialog.showMessageBoxSync(this, {
                                type: "question",
                                buttons: ["Cancel", "Close Window"],
                                title: "Confirm",
                                message:
                                    "Window has unsaved tabs, closing window will delete existing tabs.\n\nContinue?",
                            });
                            if (choice === 0) {
                                return;
                            }
                        }
                    }
                    this.deleteAllowed = true;
                }
                this.canClose = true;
                this.close();
            });
        });
        this.on("closed", () => {
            console.log("win 'closed' handler fired", this.gulinWindowId);
            if (getGlobalIsQuitting() || updater?.status == "installing") {
                console.log("win quitting or updating", this.gulinWindowId);
                return;
            }
            setTimeout(() => globalEvents.emit("windows-updated"), 50);
            gulinWindowMap.delete(this.gulinWindowId);
            if (focusedGulinWindow == this) {
                focusedGulinWindow = null;
            }
            this.removeAllChildViews();
            if (getGlobalIsRelaunching()) {
                console.log("win relaunching", this.gulinWindowId);
                this.destroy();
                return;
            }
            if (this.deleteAllowed) {
                console.log("win removing window from backend DB", this.gulinWindowId);
                fireAndForget(() => WindowService.CloseWindow(this.gulinWindowId, true));
            }
        });
        gulinWindowMap.set(gulinWindow.oid, this);
        setTimeout(() => globalEvents.emit("windows-updated"), 50);
    }

    private removeAllChildViews() {
        for (const tabView of this.allLoadedTabViews.values()) {
            if (!this.isDestroyed()) {
                this.contentView.removeChildView(tabView);
            }
            tabView?.destroy();
        }
    }

    async switchWorkspace(workspaceId: string) {
        console.log("switchWorkspace", workspaceId, this.gulinWindowId);
        if (workspaceId == this.workspaceId) {
            console.log("switchWorkspace already on this workspace", this.gulinWindowId);
            return;
        }

        // If the workspace is already owned by a window, then we can just call SwitchWorkspace without first prompting the user, since it'll just focus to the other window.
        const workspaceList = await WorkspaceService.ListWorkspaces();
        if (!workspaceList?.find((wse) => wse.workspaceid === workspaceId)?.windowid) {
            const curWorkspace = await WorkspaceService.GetWorkspace(this.workspaceId);

            if (curWorkspace && isNonEmptyUnsavedWorkspace(curWorkspace)) {
                console.log(
                    `existing unsaved workspace ${this.workspaceId} has content, opening workspace ${workspaceId} in new window`
                );
                await createWindowForWorkspace(workspaceId);
                return;
            }
        }
        await this._queueActionInternal({ op: "switchworkspace", workspaceId });
    }

    async setActiveTab(tabId: string, setInBackend: boolean, primaryStartupTab = false) {
        console.log(
            "setActiveTab",
            tabId,
            this.gulinWindowId,
            this.workspaceId,
            setInBackend,
            primaryStartupTab ? "(primary startup)" : ""
        );
        await this._queueActionInternal({ op: "switchtab", tabId, setInBackend, primaryStartupTab });
    }

    private async initializeTab(tabView: GulinTabView, primaryStartupTab: boolean) {
        const clientId = await getClientId();
        await tabView.initPromise;
        this.contentView.addChildView(tabView);
        const initOpts: GulinInitOpts = {
            tabId: tabView.gulinTabId,
            clientId: clientId,
            windowId: this.gulinWindowId,
            activate: true,
        };
        if (primaryStartupTab) {
            initOpts.primaryTabStartup = true;
        }
        tabView.savedInitOpts = { ...initOpts };
        tabView.savedInitOpts.activate = false;
        delete tabView.savedInitOpts.primaryTabStartup;
        let startTime = Date.now();
        console.log(
            "before gulin ready, init tab, sending gulin-init",
            tabView.gulinTabId,
            primaryStartupTab ? "(primary startup)" : ""
        );
        tabView.webContents.send("gulin-init", initOpts);
        await tabView.gulinReadyPromise;
        console.log("gulin-ready init time", Date.now() - startTime + "ms");
    }

    private async setTabViewIntoWindow(tabView: GulinTabView, tabInitialized: boolean, primaryStartupTab = false) {
        if (this.activeTabView == tabView) {
            return;
        }
        const oldActiveView = this.activeTabView;
        tabView.isActiveTab = true;
        if (oldActiveView != null) {
            oldActiveView.isActiveTab = false;
        }
        this.activeTabView = tabView;
        this.allLoadedTabViews.set(tabView.gulinTabId, tabView);
        if (!tabInitialized) {
            console.log("initializing a new tab", primaryStartupTab ? "(primary startup)" : "");
            const p1 = this.initializeTab(tabView, primaryStartupTab);
            const p2 = this.repositionTabsSlowly(100);
            await Promise.all([p1, p2]);
        } else {
            console.log("reusing an existing tab, calling gulin-init", tabView.gulinTabId);
            const p1 = this.repositionTabsSlowly(35);
            const p2 = tabView.webContents.send("gulin-init", tabView.savedInitOpts); // reinit
            await Promise.all([p1, p2]);
        }

        // something is causing the new tab to lose focus so it requires manual refocusing
        tabView.webContents.focus();
        setTimeout(() => {
            if (tabView.webContents && this.activeTabView == tabView && !tabView.webContents.isFocused()) {
                tabView.webContents.focus();
            }
        }, 10);
        setTimeout(() => {
            if (tabView.webContents && this.activeTabView == tabView && !tabView.webContents.isFocused()) {
                tabView.webContents.focus();
            }
        }, 30);
    }

    private async repositionTabsSlowly(delayMs: number) {
        const activeTabView = this.activeTabView;
        const winBounds = this.getContentBounds();
        if (activeTabView == null) {
            return;
        }
        if (activeTabView.isOnScreen()) {
            activeTabView.setBounds({
                x: 0,
                y: 0,
                width: winBounds.width,
                height: winBounds.height,
            });
        } else {
            activeTabView.setBounds({
                x: winBounds.width - 10,
                y: winBounds.height - 10,
                width: winBounds.width,
                height: winBounds.height,
            });
        }
        await delay(delayMs);
        if (this.activeTabView != activeTabView) {
            // another tab view has been set, do not finalize this layout
            return;
        }
        this.finalizePositioning();
    }

    private finalizePositioning() {
        if (this.isDestroyed()) {
            return;
        }
        const curBounds = this.getContentBounds();
        this.activeTabView?.positionTabOnScreen(curBounds);
        for (const tabView of this.allLoadedTabViews.values()) {
            if (tabView == this.activeTabView) {
                continue;
            }
            tabView?.positionTabOffScreen(curBounds);
        }
    }

    async queueCreateTab() {
        await this._queueActionInternal({ op: "createtab" });
    }

    async queueCloseTab(tabId: string) {
        await this._queueActionInternal({ op: "closetab", tabId });
    }

    private async _queueActionInternal(entry: WindowActionQueueEntry) {
        if (this.actionQueue.length >= 2) {
            this.actionQueue[1] = entry;
            return;
        }
        const wasEmpty = this.actionQueue.length === 0;
        this.actionQueue.push(entry);
        if (wasEmpty) {
            await this.processActionQueue();
        }
    }

    private removeTabViewLater(tabId: string, delayMs: number) {
        setTimeout(() => {
            this.removeTabView(tabId, false);
        }, 1000);
    }

    // the queue and this function are used to serialize operations that update the window contents view
    // processActionQueue will replace [1] if it is already set
    // we don't mess with [0] because it is "in process"
    // we replace [1] because there is no point to run an action that is going to be overwritten
    private async processActionQueue() {
        while (this.actionQueue.length > 0) {
            try {
                if (this.isDestroyed()) {
                    break;
                }
                const entry = this.actionQueue[0];
                let tabId: string = null;
                // have to use "===" here to get the typechecker to work :/
                switch (entry.op) {
                    case "createtab":
                        tabId = await WorkspaceService.CreateTab(this.workspaceId, null, true);
                        if (this.isDestroyed()) {
                            return;
                        }
                        break;
                    case "switchtab":
                        tabId = entry.tabId;
                        if (this.activeTabView?.gulinTabId == tabId) {
                            continue;
                        }
                        if (entry.setInBackend) {
                            await WorkspaceService.SetActiveTab(this.workspaceId, tabId);
                            if (this.isDestroyed()) {
                                return;
                            }
                        }
                        break;
                    case "closetab": {
                        tabId = entry.tabId;
                        const rtn = await WorkspaceService.CloseTab(this.workspaceId, tabId, true);
                        if (this.isDestroyed()) {
                            return;
                        }
                        if (rtn == null) {
                            console.log(
                                "[error] closeTab: no return value",
                                tabId,
                                this.workspaceId,
                                this.gulinWindowId
                            );
                            return;
                        }
                        this.removeTabViewLater(tabId, 1000);
                        if (rtn.closewindow) {
                            this.close();
                            return;
                        }
                        if (!rtn.newactivetabid) {
                            return;
                        }
                        tabId = rtn.newactivetabid;
                        break;
                    }
                    case "switchworkspace": {
                        const newWs = await WindowService.SwitchWorkspace(this.gulinWindowId, entry.workspaceId);
                        if (this.isDestroyed()) {
                            return;
                        }
                        if (!newWs) {
                            return;
                        }
                        console.log("processActionQueue switchworkspace newWs", newWs);
                        this.removeAllChildViews();
                        console.log("destroyed all tabs", this.gulinWindowId);
                        this.workspaceId = entry.workspaceId;
                        this.allLoadedTabViews = new Map();
                        tabId = newWs.activetabid;
                        break;
                    }
                }
                if (tabId == null) {
                    return;
                }
                const [tabView, tabInitialized] = await getOrCreateWebViewForTab(this.gulinWindowId, tabId);
                if (this.isDestroyed()) {
                    return;
                }
                const primaryStartupTabFlag = entry.op === "switchtab" ? (entry.primaryStartupTab ?? false) : false;
                await this.setTabViewIntoWindow(tabView, tabInitialized, primaryStartupTabFlag);
                if (this.isDestroyed()) {
                    return;
                }
            } catch (e) {
                console.log("error caught in processActionQueue", e);
            } finally {
                this.actionQueue.shift();
            }
        }
    }

    private async mainResizeHandler(_: any) {
        if (this == null || this.isDestroyed() || this.fullScreen) {
            return;
        }
        const bounds = this.getBounds();
        try {
            await WindowService.SetWindowPosAndSize(
                this.gulinWindowId,
                { x: bounds.x, y: bounds.y },
                { width: bounds.width, height: bounds.height }
            );
        } catch (e) {
            console.log("error sending new window bounds to backend", e);
        }
    }

    removeTabView(tabId: string, force: boolean) {
        if (!force && this.activeTabView?.gulinTabId == tabId) {
            console.log("cannot remove active tab", tabId, this.gulinWindowId);
            return;
        }
        const tabView = this.allLoadedTabViews.get(tabId);
        if (tabView == null) {
            console.log("removeTabView -- tabView not found", tabId, this.gulinWindowId);
            // the tab was never loaded, so just return
            return;
        }
        this.contentView.removeChildView(tabView);
        this.allLoadedTabViews.delete(tabId);
        tabView.destroy();
    }

    destroy() {
        console.log("destroy win", this.gulinWindowId);
        this.deleteAllowed = true;
        super.destroy();
    }
}

export function getGulinWindowByTabId(tabId: string): GulinBrowserWindow {
    for (const ww of gulinWindowMap.values()) {
        if (ww.allLoadedTabViews.has(tabId)) {
            return ww;
        }
    }
}

export function getGulinWindowByWebContentsId(webContentsId: number): GulinBrowserWindow {
    const tabView = getGulinTabViewByWebContentsId(webContentsId);
    if (tabView == null) {
        return null;
    }
    return getGulinWindowByTabId(tabView.gulinTabId);
}

export function getGulinWindowById(windowId: string): GulinBrowserWindow {
    return gulinWindowMap.get(windowId);
}

export function getGulinWindowByWorkspaceId(workspaceId: string): GulinBrowserWindow {
    for (const gulinWindow of gulinWindowMap.values()) {
        if (gulinWindow.workspaceId === workspaceId) {
            return gulinWindow;
        }
    }
}

export function getAllGulinWindows(): GulinBrowserWindow[] {
    return Array.from(gulinWindowMap.values());
}

export async function createWindowForWorkspace(workspaceId: string) {
    const newWin = await WindowService.CreateWindow(null, workspaceId);
    if (!newWin) {
        console.log("error creating new window", this.gulinWindowId);
    }
    const newBwin = await createBrowserWindow(newWin, await RpcApi.GetFullConfigCommand(ElectronWshClient), {
        unamePlatform,
        isPrimaryStartupWindow: false,
    });
    newBwin.show();
}

// note, this does not *show* the window.
// to show, await win.readyPromise and then win.show()
export async function createBrowserWindow(
    gulinWindow: GulinWindow,
    fullConfig: FullConfigType,
    opts: WindowOpts
): Promise<GulinBrowserWindow> {
    if (!gulinWindow) {
        console.log("createBrowserWindow: no gulinWindow");
        gulinWindow = await WindowService.CreateWindow(null, "");
    }
    let workspace = await WorkspaceService.GetWorkspace(gulinWindow.workspaceid);
    if (!workspace) {
        console.log("createBrowserWindow: no workspace, creating new window");
        await WindowService.CloseWindow(gulinWindow.oid, true);
        gulinWindow = await WindowService.CreateWindow(null, "");
        workspace = await WorkspaceService.GetWorkspace(gulinWindow.workspaceid);
    }
    console.log("createBrowserWindow", gulinWindow.oid, workspace.oid, workspace);
    const bwin = new GulinBrowserWindow(gulinWindow, fullConfig, opts);
    if (workspace.activetabid) {
        await bwin.setActiveTab(workspace.activetabid, false, opts.isPrimaryStartupWindow ?? false);
    }
    return bwin;
}

ipcMain.on("set-active-tab", async (event, tabId) => {
    const ww = getGulinWindowByWebContentsId(event.sender.id);
    console.log("set-active-tab", tabId, ww?.gulinWindowId);
    await ww?.setActiveTab(tabId, true);
});

ipcMain.on("create-tab", async (event, opts) => {
    const senderWc = event.sender;
    const ww = getGulinWindowByWebContentsId(senderWc.id);
    if (ww != null) {
        await ww.queueCreateTab();
    }
    event.returnValue = true;
    return null;
});

ipcMain.on("set-gulinai-open", (event, isOpen: boolean) => {
    const tabView = getGulinTabViewByWebContentsId(event.sender.id);
    if (tabView) {
        tabView.isGulinAIOpen = isOpen;
    }
});

ipcMain.handle("close-tab", async (event, workspaceId: string, tabId: string, confirmClose: boolean) => {
    const ww = getGulinWindowByWorkspaceId(workspaceId);
    if (ww == null) {
        console.log(`close-tab: no window found for workspace ws=${workspaceId} tab=${tabId}`);
        return false;
    }
    if (confirmClose) {
        const choice = dialog.showMessageBoxSync(ww, {
            type: "question",
            defaultId: 1, // Enter activates "Close Tab"
            cancelId: 0, // Esc activates "Cancel"
            buttons: ["Cancel", "Close Tab"],
            title: "Confirm",
            message: "Are you sure you want to close this tab?",
        });
        if (choice === 0) {
            return false;
        }
    }
    await ww.queueCloseTab(tabId);
    return true;
});

ipcMain.on("switch-workspace", (event, workspaceId) => {
    fireAndForget(async () => {
        const ww = getGulinWindowByWebContentsId(event.sender.id);
        console.log("switch-workspace", workspaceId, ww?.gulinWindowId);
        await ww?.switchWorkspace(workspaceId);
    });
});

export async function createWorkspace(window: GulinBrowserWindow) {
    const newWsId = await WorkspaceService.CreateWorkspace("", "", "", true);
    if (newWsId) {
        if (window) {
            await window.switchWorkspace(newWsId);
        } else {
            await createWindowForWorkspace(newWsId);
        }
    }
}

ipcMain.on("create-workspace", (event) => {
    fireAndForget(async () => {
        const ww = getGulinWindowByWebContentsId(event.sender.id);
        console.log("create-workspace", ww?.gulinWindowId);
        await createWorkspace(ww);
    });
});

ipcMain.on("delete-workspace", (event, workspaceId) => {
    fireAndForget(async () => {
        const ww = getGulinWindowByWebContentsId(event.sender.id);
        console.log("delete-workspace", workspaceId, ww?.gulinWindowId);

        const workspaceList = await WorkspaceService.ListWorkspaces();

        const workspaceHasWindow = !!workspaceList.find((wse) => wse.workspaceid === workspaceId)?.windowid;

        const choice = dialog.showMessageBoxSync(this, {
            type: "question",
            buttons: ["Cancel", "Delete Workspace"],
            title: "Confirm",
            message: `Deleting workspace will also delete its contents.\n\nContinue?`,
        });
        if (choice === 0) {
            console.log("user cancelled workspace delete", workspaceId, ww?.gulinWindowId);
            return;
        }

        const newWorkspaceId = await WorkspaceService.DeleteWorkspace(workspaceId);
        console.log("delete-workspace done", workspaceId, ww?.gulinWindowId);
        if (ww?.workspaceId == workspaceId) {
            if (newWorkspaceId) {
                await ww.switchWorkspace(newWorkspaceId);
            } else {
                console.log("delete-workspace closing window", workspaceId, ww?.gulinWindowId);
                ww.destroy();
            }
        }
    });
});

export async function createNewGulinWindow() {
    log("createNewGulinWindow");
    const clientData = await ClientService.GetClientData();
    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    let recreatedWindow = false;
    const allWindows = getAllGulinWindows();
    if (allWindows.length === 0 && clientData?.windowids?.length >= 1) {
        console.log("no windows, but clientData has windowids, recreating first window");
        // reopen the first window
        const existingWindowId = clientData.windowids[0];
        const existingWindowData = (await ObjectService.GetObject("window:" + existingWindowId)) as GulinWindow;
        if (existingWindowData != null) {
            const win = await createBrowserWindow(existingWindowData, fullConfig, {
                unamePlatform,
                isPrimaryStartupWindow: false,
            });
            win.show();
            recreatedWindow = true;
        }
    }
    if (recreatedWindow) {
        console.log("recreated window, returning");
        return;
    }
    console.log("creating new window");
    const newBrowserWindow = await createBrowserWindow(null, fullConfig, {
        unamePlatform,
        isPrimaryStartupWindow: false,
    });
    newBrowserWindow.show();
}

export async function relaunchBrowserWindows() {
    console.log("relaunchBrowserWindows");
    setGlobalIsRelaunching(true);
    const windows = getAllGulinWindows();
    if (windows.length > 0) {
        for (const window of windows) {
            console.log("relaunch -- closing window", window.gulinWindowId);
            window.close();
        }
        await delay(1200);
    }
    setGlobalIsRelaunching(false);

    const clientData = await ClientService.GetClientData();
    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    const windowIds = clientData.windowids ?? [];
    const wins: GulinBrowserWindow[] = [];
    const isFirstRelaunch = !hasCompletedFirstRelaunch;
    const primaryWindowId = windowIds.length > 0 ? windowIds[0] : null;
    for (const windowId of windowIds.slice().reverse()) {
        const windowData: GulinWindow = await WindowService.GetWindow(windowId);
        if (windowData == null) {
            console.log("relaunch -- window data not found, closing window", windowId);
            await WindowService.CloseWindow(windowId, true);
            continue;
        }
        const isPrimaryStartupWindow = isFirstRelaunch && windowId === primaryWindowId;
        console.log(
            "relaunch -- creating window",
            windowId,
            windowData,
            isPrimaryStartupWindow ? "(primary startup)" : ""
        );
        const win = await createBrowserWindow(windowData, fullConfig, {
            unamePlatform,
            isPrimaryStartupWindow,
            foregroundWindow: windowId === primaryWindowId,
        });
        wins.push(win);
    }
    hasCompletedFirstRelaunch = true;
    for (const win of wins) {
        console.log("show window", win.gulinWindowId);
        win.show();
        win.focus();
    }
}

export function registerGlobalHotkey(rawGlobalHotKey: string) {
    try {
        const electronHotKey = gulinKeyToElectronKey(rawGlobalHotKey);
        console.log("registering globalhotkey of ", electronHotKey);
        globalShortcut.register(electronHotKey, () => {
            const selectedWindow = focusedGulinWindow;
            const firstGulinWindow = getAllGulinWindows()[0];
            if (focusedGulinWindow) {
                selectedWindow.focus();
            } else if (firstGulinWindow) {
                firstGulinWindow.focus();
            } else {
                fireAndForget(createNewGulinWindow);
            }
        });
    } catch (e) {
        console.log("error registering global hotkey: ", e);
    }
}
