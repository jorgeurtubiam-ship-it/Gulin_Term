// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { adaptFromElectronKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { CHORD_TIMEOUT } from "@/util/sharedconst";
import { Rectangle, shell, WebContentsView } from "electron";
import { createNewGulinWindow, getGulinWindowById } from "emain/emain-window";
import path from "path";
import { configureAuthKeyRequestInjection } from "./authkey";
import { setWasActive } from "./emain-activity";
import { getElectronAppBasePath, isDevVite, unamePlatform } from "./emain-platform";
import {
    decreaseZoomLevel,
    handleCtrlShiftFocus,
    handleCtrlShiftState,
    increaseZoomLevel,
    shFrameNavHandler,
    shNavHandler,
} from "./emain-util";
import { ElectronWshClient } from "./emain-wsh";

function handleWindowsMenuAccelerators(
    gulinEvent: GulinKeyboardEvent,
    tabView: GulinTabView,
    fullConfig: FullConfigType
): boolean {
    const gulinWindow = getGulinWindowById(tabView.gulinWindowId);

    if (checkKeyPressed(gulinEvent, "Ctrl:Shift:n")) {
        createNewGulinWindow();
        return true;
    }

    if (checkKeyPressed(gulinEvent, "Ctrl:Shift:r")) {
        tabView.webContents.reloadIgnoringCache();
        return true;
    }

    if (checkKeyPressed(gulinEvent, "Ctrl:v")) {
        const ctrlVPaste = fullConfig?.settings?.["app:ctrlvpaste"];
        const shouldPaste = ctrlVPaste ?? true;
        if (!shouldPaste) {
            return false;
        }
        tabView.webContents.paste();
        return true;
    }

    if (checkKeyPressed(gulinEvent, "Ctrl:0")) {
        tabView.webContents.setZoomFactor(1);
        tabView.webContents.send("zoom-factor-change", 1);
        return true;
    }

    if (checkKeyPressed(gulinEvent, "Ctrl:=") || checkKeyPressed(gulinEvent, "Ctrl:Shift:=")) {
        increaseZoomLevel(tabView.webContents);
        return true;
    }

    if (checkKeyPressed(gulinEvent, "Ctrl:-") || checkKeyPressed(gulinEvent, "Ctrl:Shift:-")) {
        decreaseZoomLevel(tabView.webContents);
        return true;
    }

    if (checkKeyPressed(gulinEvent, "F11")) {
        if (gulinWindow) {
            gulinWindow.setFullScreen(!gulinWindow.isFullScreen());
        }
        return true;
    }

    for (let i = 1; i <= 9; i++) {
        if (checkKeyPressed(gulinEvent, `Alt:Ctrl:${i}`)) {
            const workspaceNum = i - 1;
            RpcApi.WorkspaceListCommand(ElectronWshClient).then((workspaceList) => {
                if (workspaceList && workspaceNum < workspaceList.length) {
                    const workspace = workspaceList[workspaceNum];
                    if (gulinWindow) {
                        gulinWindow.switchWorkspace(workspace.workspacedata.oid);
                    }
                }
            });
            return true;
        }
    }

    if (checkKeyPressed(gulinEvent, "Alt:Shift:i")) {
        tabView.webContents.toggleDevTools();
        return true;
    }

    return false;
}

function computeBgColor(fullConfig: FullConfigType): string {
    const settings = fullConfig?.settings;
    const isTransparent = settings?.["window:transparent"] ?? false;
    const isBlur = !isTransparent && (settings?.["window:blur"] ?? false);
    if (isTransparent) {
        return "#00000000";
    } else if (isBlur) {
        return "#00000000";
    } else {
        return "#222222";
    }
}

const wcIdToGulinTabMap = new Map<number, GulinTabView>();

export function getGulinTabViewByWebContentsId(webContentsId: number): GulinTabView {
    return wcIdToGulinTabMap.get(webContentsId);
}

export class GulinTabView extends WebContentsView {
    gulinWindowId: string; // this will be set for any tabviews that are initialized. (unset for the hot spare)
    isActiveTab: boolean;
    isGulinAIOpen: boolean;
    private _gulinTabId: string; // always set, GulinTabViews are unique per tab
    lastUsedTs: number; // ts milliseconds
    createdTs: number; // ts milliseconds
    initPromise: Promise<void>;
    initResolve: () => void;
    savedInitOpts: GulinInitOpts;
    gulinReadyPromise: Promise<void>;
    gulinReadyResolve: () => void;
    isInitialized: boolean = false;
    isGulinReady: boolean = false;
    isDestroyed: boolean = false;
    keyboardChordMode: boolean = false;
    resetChordModeTimeout: NodeJS.Timeout = null;

    constructor(fullConfig: FullConfigType) {
        console.log("createBareTabView");
        const webPreferences: any = {
            preload: path.join(getElectronAppBasePath(), "preload", "index.cjs"),
            webviewTag: true,
        };
        if (isDevVite) {
            // disable web security in dev mode to allow Vite HMR and module loading
            webPreferences.webSecurity = false;
        }
        super({
            webPreferences,
        });
        this.createdTs = Date.now();
        this.isGulinAIOpen = false;
        this.savedInitOpts = null;
        this.initPromise = new Promise((resolve, _) => {
            this.initResolve = resolve;
        });
        this.initPromise.then(() => {
            this.isInitialized = true;
            console.log("tabview init", Date.now() - this.createdTs + "ms");
        });
        this.gulinReadyPromise = new Promise((resolve, _) => {
            this.gulinReadyResolve = resolve;
        });
        this.gulinReadyPromise.then(() => {
            this.isGulinReady = true;
        });
        wcIdToGulinTabMap.set(this.webContents.id, this);
        const startTime = Date.now();
        this.webContents.on("console-message", (event, level, message, line, sourceId) => {
            const levelStr = ["verbose","info","warning","error"][level] || "unknown";
            console.log(`[renderer:${levelStr}] ${message} (at ${sourceId}:${line})`);
        });
        if (isDevVite) {
            const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
            const fullUrl = `${rendererUrl}/index.html`;
            console.log("DEV MODE: loading URL:", fullUrl);
            console.log("DEV MODE: ELECTRON_RENDERER_URL env:", process.env.ELECTRON_RENDERER_URL);
            this.webContents.loadURL(fullUrl).then(() => {
                console.log("loadURL SUCCESS in", Date.now() - startTime + "ms");
            }).catch((err) => {
                console.error("loadURL FAILED:", err);
            });
            this.webContents.on("did-finish-load", () => {
                console.log("[debug] did-finish-load fired");
                this.webContents.executeJavaScript(`
                    console.log("[gulin-debug] window loaded, checking React root...");
                    setTimeout(() => {
                        const root = document.getElementById("main");
                        console.log("[gulin-debug] #main element:", root);
                        console.log("[gulin-debug] #main innerHTML length:", root ? root.innerHTML.length : "N/A");
                        console.log("[gulin-debug] document.readyState:", document.readyState);
                    }, 5000);
                `).catch(e => console.error("[debug] executeJS failed:", e));
            });
            this.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
                console.error("[debug] did-fail-load:", errorCode, errorDescription);
            });
            this.webContents.openDevTools({ mode: 'bottom' });
        } else {
            this.webContents.loadFile(path.join(getElectronAppBasePath(), "frontend", "index.html"));
        }
        this.webContents.on("destroyed", () => {
            wcIdToGulinTabMap.delete(this.webContents.id);
            removeGulinTabView(this.gulinTabId);
            this.isDestroyed = true;
        });
        this.webContents.on("zoom-changed", (_event, zoomDirection) => {
            this.webContents.send("zoom-factor-change", this.webContents.getZoomFactor());
        });
        this.setBackgroundColor(computeBgColor(fullConfig));
    }

    get gulinTabId(): string {
        return this._gulinTabId;
    }

    set gulinTabId(gulinTabId: string) {
        this._gulinTabId = gulinTabId;
    }

    setKeyboardChordMode(mode: boolean) {
        this.keyboardChordMode = mode;
        if (mode) {
            if (this.resetChordModeTimeout) {
                clearTimeout(this.resetChordModeTimeout);
            }
            this.resetChordModeTimeout = setTimeout(() => {
                this.keyboardChordMode = false;
            }, CHORD_TIMEOUT);
        } else {
            if (this.resetChordModeTimeout) {
                clearTimeout(this.resetChordModeTimeout);
                this.resetChordModeTimeout = null;
            }
        }
    }

    positionTabOnScreen(winBounds: Rectangle) {
        const curBounds = this.getBounds();
        if (
            curBounds.width == winBounds.width &&
            curBounds.height == winBounds.height &&
            curBounds.x == 0 &&
            curBounds.y == 0
        ) {
            return;
        }
        this.setBounds({ x: 0, y: 0, width: winBounds.width, height: winBounds.height });
    }

    positionTabOffScreen(winBounds: Rectangle) {
        this.setBounds({
            x: -15000,
            y: -15000,
            width: winBounds.width,
            height: winBounds.height,
        });
    }

    isOnScreen() {
        const bounds = this.getBounds();
        return bounds.x == 0 && bounds.y == 0;
    }

    destroy() {
        console.log("destroy tab", this.gulinTabId);
        removeGulinTabView(this.gulinTabId);
        if (!this.isDestroyed) {
            this.webContents?.close();
        }
        this.isDestroyed = true;
    }
}

let MaxCacheSize = 10;
const wcvCache = new Map<string, GulinTabView>();

export function setMaxTabCacheSize(size: number) {
    console.log("setMaxTabCacheSize", size);
    MaxCacheSize = size;
}

export function getGulinTabView(gulinTabId: string): GulinTabView | undefined {
    const rtn = wcvCache.get(gulinTabId);
    if (rtn) {
        rtn.lastUsedTs = Date.now();
    }
    return rtn;
}

function tryEvictEntry(gulinTabId: string): boolean {
    const tabView = wcvCache.get(gulinTabId);
    if (!tabView) {
        return false;
    }
    if (tabView.isActiveTab) {
        return false;
    }
    const lastUsedDiff = Date.now() - tabView.lastUsedTs;
    if (lastUsedDiff < 1000) {
        return false;
    }
    const ww = getGulinWindowById(tabView.gulinWindowId);
    if (!ww) {
        // this shouldn't happen, but if it does, just destroy the tabview
        console.log("[error] GulinWindow not found for GulinTabView", tabView.gulinTabId);
        tabView.destroy();
        return true;
    } else {
        // will trigger a destroy on the tabview
        ww.removeTabView(tabView.gulinTabId, false);
        return true;
    }
}

function checkAndEvictCache(): void {
    if (wcvCache.size <= MaxCacheSize) {
        return;
    }
    const sorted = Array.from(wcvCache.values()).sort((a, b) => {
        // Prioritize entries which are active
        if (a.isActiveTab && !b.isActiveTab) {
            return -1;
        }
        // Otherwise, sort by lastUsedTs
        return a.lastUsedTs - b.lastUsedTs;
    });
    const now = Date.now();
    for (let i = 0; i < sorted.length - MaxCacheSize; i++) {
        tryEvictEntry(sorted[i].gulinTabId);
    }
}

export function clearTabCache() {
    const wcVals = Array.from(wcvCache.values());
    for (let i = 0; i < wcVals.length; i++) {
        const tabView = wcVals[i];
        tryEvictEntry(tabView.gulinTabId);
    }
}

// returns [tabview, initialized]
export async function getOrCreateWebViewForTab(gulinWindowId: string, tabId: string): Promise<[GulinTabView, boolean]> {
    let tabView = getGulinTabView(tabId);
    if (tabView) {
        return [tabView, true];
    }
    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    tabView = getSpareTab(fullConfig);
    tabView.gulinWindowId = gulinWindowId;
    tabView.lastUsedTs = Date.now();
    setGulinTabView(tabId, tabView);
    tabView.gulinTabId = tabId;
    tabView.webContents.on("will-navigate", shNavHandler);
    tabView.webContents.on("will-frame-navigate", shFrameNavHandler);
    tabView.webContents.on("did-attach-webview", (event, wc) => {
        wc.setWindowOpenHandler((details) => {
            tabView.webContents.send("webview-new-window", wc.id, details);
            return { action: "deny" };
        });
    });
    tabView.webContents.on("before-input-event", (e, input) => {
        const gulinEvent = adaptFromElectronKeyEvent(input);
        // console.log("WIN bie", tabView.gulinTabId.substring(0, 8), gulinEvent.type, gulinEvent.code);
        handleCtrlShiftState(tabView.webContents, gulinEvent);
        setWasActive(true);
        if (input.type == "keyDown" && tabView.keyboardChordMode) {
            e.preventDefault();
            tabView.setKeyboardChordMode(false);
            tabView.webContents.send("reinject-key", gulinEvent);
            return;
        }

        if (unamePlatform === "win32" && input.type == "keyDown") {
            if (handleWindowsMenuAccelerators(gulinEvent, tabView, fullConfig)) {
                e.preventDefault();
                return;
            }
        }
    });
    tabView.webContents.on("zoom-changed", (e) => {
        tabView.webContents.send("zoom-changed");
    });
    tabView.webContents.setWindowOpenHandler(({ url, frameName }) => {
        if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")) {
            console.log("openExternal fallback", url);
            shell.openExternal(url);
        }
        console.log("window-open denied", url);
        return { action: "deny" };
    });
    tabView.webContents.on("blur", () => {
        handleCtrlShiftFocus(tabView.webContents, false);
    });
    configureAuthKeyRequestInjection(tabView.webContents.session);
    return [tabView, false];
}

export function setGulinTabView(gulinTabId: string, wcv: GulinTabView): void {
    if (gulinTabId == null) {
        return;
    }
    wcvCache.set(gulinTabId, wcv);
    checkAndEvictCache();
}

function removeGulinTabView(gulinTabId: string): void {
    if (gulinTabId == null) {
        return;
    }
    wcvCache.delete(gulinTabId);
}

let HotSpareTab: GulinTabView = null;

export function ensureHotSpareTab(fullConfig: FullConfigType) {
    console.log("ensureHotSpareTab");
    if (HotSpareTab == null) {
        HotSpareTab = new GulinTabView(fullConfig);
    }
}

export function getSpareTab(fullConfig: FullConfigType): GulinTabView {
    setTimeout(() => ensureHotSpareTab(fullConfig), 500);
    if (HotSpareTab != null) {
        const rtn = HotSpareTab;
        HotSpareTab = null;
        console.log("getSpareTab: returning hotspare");
        return rtn;
    } else {
        console.log("getSpareTab: creating new tab");
        return new GulinTabView(fullConfig);
    }
}
