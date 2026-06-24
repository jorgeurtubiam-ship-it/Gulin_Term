// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { App } from "@/app/app";
import { loadMonaco } from "@/app/monaco/monaco-env";
import { GlobalModel } from "@/app/store/global-model";
import {
    globalRefocus,
    registerBuilderGlobalKeys,
    registerControlShiftStateUpdateHandler,
    registerElectronReinjectKeyHandler,
    registerGlobalKeys,
} from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeBuilderRouteId, makeTabRouteId } from "@/app/store/wshrouter";
import { initWshrpc, TabRpcClient } from "@/app/store/wshrpcutil";
import { BuilderApp } from "@/builder/builder-app";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { countersClear, countersPrint } from "@/store/counters";
import {
    atoms,
    getApi,
    globalStore,
    initGlobal,
    initGlobalGulinEventSubs,
    loadConnStatus,
    loadTabIndicators,
    subscribeToConnEvents,
} from "@/store/global";
import { activeTabIdAtom } from "@/store/tab-model";
import * as WOS from "@/store/wos";
import { loadFonts } from "@/util/fontutil";
import { setKeyUtilPlatform } from "@/util/keyutil";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

const platform = getApi().getPlatform();
document.title = `Gulin Terminal`;
let savedInitOpts: GulinInitOpts = null;

(window as any).WOS = WOS;
(window as any).globalStore = globalStore;
(window as any).globalAtoms = atoms;
(window as any).RpcApi = RpcApi;
(window as any).isFullScreen = false;
(window as any).countersPrint = countersPrint;
(window as any).countersClear = countersClear;
(window as any).getLayoutModelForStaticTab = getLayoutModelForStaticTab;
(window as any).modalsModel = modalsModel;

function updateZoomFactor(zoomFactor: number) {
    console.log("update zoomfactor", zoomFactor);
    document.documentElement.style.setProperty("--zoomfactor", String(zoomFactor));
    document.documentElement.style.setProperty("--zoomfactor-inv", String(1 / zoomFactor));
}

async function initBare() {
    getApi().sendLog("Init Bare");
    document.body.style.visibility = "hidden";
    document.body.style.opacity = "0";
    document.body.classList.add("is-transparent");
    getApi().onGulinInit(initGulinWrap);
    getApi().onBuilderInit(initBuilderWrap);
    setKeyUtilPlatform(platform);
    loadFonts();
    updateZoomFactor(getApi().getZoomFactor());
    getApi().onZoomFactorChange((zoomFactor) => {
        updateZoomFactor(zoomFactor);
    });
    document.fonts.ready.then(() => {
        console.log("Init Bare Done");
        getApi().setWindowInitStatus("ready");
    });
}

document.addEventListener("DOMContentLoaded", initBare);

async function initGulinWrap(initOpts: GulinInitOpts) {
    try {
        if (savedInitOpts) {
            await reinitGulin();
            return;
        }
        savedInitOpts = initOpts;
        await initGulin(initOpts);
    } catch (e) {
        getApi().sendLog("Error in initGulin " + e.message + "\n" + e.stack);
        console.error("Error in initGulin", e);
    } finally {
        document.body.style.visibility = null;
        document.body.style.opacity = null;
        document.body.classList.remove("is-transparent");
    }
}

async function reinitGulin() {
    console.log("Reinit Gulin");
    getApi().sendLog("Reinit Gulin");

    // We use this hack to prevent a flicker of the previously-hovered tab when this view was last active.
    document.body.classList.add("nohover");
    requestAnimationFrame(() =>
        setTimeout(() => {
            document.body.classList.remove("nohover");
        }, 100)
    );

    await WOS.reloadGulinObject<Client>(WOS.makeORef("client", savedInitOpts.clientId));
    const gulinWindow = await WOS.reloadGulinObject<GulinWindow>(WOS.makeORef("window", savedInitOpts.windowId));
    const ws = await WOS.reloadGulinObject<Workspace>(WOS.makeORef("workspace", gulinWindow.workspaceid));
    const initialTab = await WOS.reloadGulinObject<Tab>(WOS.makeORef("tab", savedInitOpts.tabId));
    await WOS.reloadGulinObject<LayoutState>(WOS.makeORef("layout", initialTab.layoutstate));
    reloadAllWorkspaceTabs(ws);
    document.title = `Gulin Terminal - ${initialTab.name}`; // TODO update with tab name change
    getApi().setWindowInitStatus("gulin-ready");
    globalStore.set(atoms.reinitVersion, globalStore.get(atoms.reinitVersion) + 1);
    globalStore.set(atoms.updaterStatusAtom, getApi().getUpdaterStatus());
    setTimeout(() => {
        globalRefocus();
    }, 50);
}

function reloadAllWorkspaceTabs(ws: Workspace) {
    if (ws == null || !ws.tabids?.length) {
        return;
    }
    ws.tabids?.forEach((tabid) => {
        WOS.reloadGulinObject<Tab>(WOS.makeORef("tab", tabid));
    });
}

function loadAllWorkspaceTabs(ws: Workspace) {
    if (ws == null || !ws.tabids?.length) {
        return;
    }
    ws.tabids?.forEach((tabid) => {
        WOS.getObjectValue<Tab>(WOS.makeORef("tab", tabid));
    });
}

async function initGulin(initOpts: GulinInitOpts) {
    getApi().sendLog("Init Gulin " + JSON.stringify(initOpts));
    const globalInitOpts: GlobalInitOptions = {
        tabId: initOpts.tabId,
        clientId: initOpts.clientId,
        windowId: initOpts.windowId,
        platform,
        environment: "renderer",
        primaryTabStartup: initOpts.primaryTabStartup,
    };
    console.log("Gulin Init", globalInitOpts);
    globalStore.set(activeTabIdAtom, initOpts.tabId);
    await GlobalModel.getInstance().initialize(globalInitOpts);
    initGlobal(globalInitOpts);
    (window as any).globalAtoms = atoms;

    // Init WPS event handlers
    const globalWS = initWshrpc(makeTabRouteId(initOpts.tabId));
    (window as any).globalWS = globalWS;
    (window as any).TabRpcClient = TabRpcClient;
    await loadConnStatus();
    await loadTabIndicators();
    initGlobalGulinEventSubs(initOpts);
    subscribeToConnEvents();

    // ensures client/window/workspace are loaded into the cache before rendering
    try {
        const [client, gulinWindow, initialTab] = await Promise.all([
            WOS.loadAndPinGulinObject<Client>(WOS.makeORef("client", initOpts.clientId)),
            WOS.loadAndPinGulinObject<GulinWindow>(WOS.makeORef("window", initOpts.windowId)),
            WOS.loadAndPinGulinObject<Tab>(WOS.makeORef("tab", initOpts.tabId)),
        ]);
        const [ws, layoutState] = await Promise.all([
            WOS.loadAndPinGulinObject<Workspace>(WOS.makeORef("workspace", gulinWindow.workspaceid)),
            WOS.reloadGulinObject<LayoutState>(WOS.makeORef("layout", initialTab.layoutstate)),
        ]);
        loadAllWorkspaceTabs(ws);
        WOS.wpsSubscribeToObject(WOS.makeORef("workspace", gulinWindow.workspaceid));
        document.title = `Gulin Terminal - ${initialTab.name}`; // TODO update with tab name change
    } catch (e) {
        console.error("Failed initialization error", e);
        getApi().sendLog("Error in initialization (gulin.ts, loading required objects) " + e.message + "\n" + e.stack);
    }
    registerGlobalKeys();
    registerElectronReinjectKeyHandler();
    registerControlShiftStateUpdateHandler();
    await loadMonaco();
    const fullConfig = await RpcApi.GetFullConfigCommand(TabRpcClient);
    console.log("fullconfig", fullConfig);
    globalStore.set(atoms.fullConfigAtom, fullConfig);
    const gulinaiModeConfig = await RpcApi.GetGulinAIModeConfigCommand(TabRpcClient);
    globalStore.set(atoms.gulinaiModeConfigAtom, gulinaiModeConfig.configs);
    console.log("Gulin First Render");
    let firstRenderResolveFn: () => void = null;
    let firstRenderPromise = new Promise<void>((resolve) => {
        firstRenderResolveFn = resolve;
    });
    const reactElem = createElement(App, { onFirstRender: firstRenderResolveFn }, null);
    const elem = document.getElementById("main");
    const root = createRoot(elem);
    root.render(reactElem);
    await firstRenderPromise;
    console.log("Gulin First Render Done");
    getApi().setWindowInitStatus("gulin-ready");
}

async function initBuilderWrap(initOpts: BuilderInitOpts) {
    try {
        await initBuilder(initOpts);
    } catch (e) {
        getApi().sendLog("Error in initBuilder " + e.message + "\n" + e.stack);
        console.error("Error in initBuilder", e);
    } finally {
        document.body.style.visibility = null;
        document.body.style.opacity = null;
        document.body.classList.remove("is-transparent");
    }
}

async function initBuilder(initOpts: BuilderInitOpts) {
    getApi().sendLog("Init Builder " + JSON.stringify(initOpts));
    const globalInitOpts: GlobalInitOptions = {
        clientId: initOpts.clientId,
        windowId: initOpts.windowId,
        platform,
        environment: "renderer",
        builderId: initOpts.builderId,
    };
    console.log("Tsunami Builder Init", globalInitOpts);
    await GlobalModel.getInstance().initialize(globalInitOpts);
    initGlobal(globalInitOpts);
    (window as any).globalAtoms = atoms;

    const globalWS = initWshrpc(makeBuilderRouteId(initOpts.builderId));
    (window as any).globalWS = globalWS;
    (window as any).TabRpcClient = TabRpcClient;
    await loadConnStatus();

    let appIdToUse: string = null;
    try {
        const oref = WOS.makeORef("builder", initOpts.builderId);
        const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, { oref });
        if (rtInfo && rtInfo["builder:appid"]) {
            appIdToUse = rtInfo["builder:appid"];
        }
    } catch (e) {
        console.log("Could not load saved builder appId from rtinfo:", e);
    }

    document.title = appIdToUse ? `GulinApp Builder (${appIdToUse})` : "GulinApp Builder";

    globalStore.set(atoms.builderAppId, appIdToUse);

    const client = await WOS.loadAndPinGulinObject<Client>(WOS.makeORef("client", initOpts.clientId));

    registerBuilderGlobalKeys();
    registerElectronReinjectKeyHandler();
    await loadMonaco();
    const fullConfig = await RpcApi.GetFullConfigCommand(TabRpcClient);
    console.log("fullconfig", fullConfig);
    globalStore.set(atoms.fullConfigAtom, fullConfig);
    const gulinaiModeConfig = await RpcApi.GetGulinAIModeConfigCommand(TabRpcClient);
    globalStore.set(atoms.gulinaiModeConfigAtom, gulinaiModeConfig.configs);

    console.log("Tsunami Builder First Render");
    let firstRenderResolveFn: () => void = null;
    let firstRenderPromise = new Promise<void>((resolve) => {
        firstRenderResolveFn = resolve;
    });
    const reactElem = createElement(BuilderApp, { initOpts, onFirstRender: firstRenderResolveFn }, null);
    const elem = document.getElementById("main");
    const root = createRoot(elem);
    root.render(reactElem);
    await firstRenderPromise;
    console.log("Tsunami Builder First Render Done");
}
