// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIPanel } from "@/app/aipanel/aipanel";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { Widgets } from "@/app/workspace/widgets";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { GulinSidebar } from "@/app/workspace/gulin-sidebar";
import { atoms, getApi } from "@/store/global";
import { GlobalModel } from "@/app/store/global-model";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";
import {
    ImperativePanelGroupHandle,
    ImperativePanelHandle,
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from "react-resizable-panels";

const WorkspaceElem = memo(() => {
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const windowData = useAtomValue(GlobalModel.getInstance().windowDataAtom);
    const isBare = (windowData?.meta as any)?.bare === true;
    const initialAiPanelPercentage = workspaceLayoutModel.getAIPanelPercentage(window.innerWidth);
    const panelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const aiPanelRef = useRef<ImperativePanelHandle>(null);
    const terminalPanelRef = useRef<ImperativePanelHandle>(null);
    const panelContainerRef = useRef<HTMLDivElement>(null);
    const aiPanelWrapperRef = useRef<HTMLDivElement>(null);
    const terminalVisible = useAtomValue(workspaceLayoutModel.terminalPanelVisibleAtom);
    const aiVisible = useAtomValue(workspaceLayoutModel.panelVisibleAtom);

    useEffect(() => {
        if (aiPanelRef.current && panelGroupRef.current && panelContainerRef.current && aiPanelWrapperRef.current) {
            workspaceLayoutModel.registerRefs(
                aiPanelRef.current,
                panelGroupRef.current,
                panelContainerRef.current,
                aiPanelWrapperRef.current
            );
        }
        if (terminalPanelRef.current) {
            workspaceLayoutModel.registerTerminalRef(terminalPanelRef.current);
        }
    }, []);

    useEffect(() => {
        const isVisible = workspaceLayoutModel.getAIPanelVisible();
        getApi().setGulinAIOpen(isVisible);
    }, []);

    useEffect(() => {
        window.addEventListener("resize", workspaceLayoutModel.handleWindowResize);
        return () => window.removeEventListener("resize", workspaceLayoutModel.handleWindowResize);
    }, []);

    return (
        <div className="flex flex-col w-full flex-grow overflow-hidden">
            {!isBare && <TabBar key={ws.oid} workspace={ws} />}
            <div ref={panelContainerRef} className="flex flex-row flex-grow overflow-hidden">
                {!isBare && (
                    <ErrorBoundary>
                        <GulinSidebar />
                    </ErrorBoundary>
                )}
                <ErrorBoundary key={tabId}>
                    {isBare ? (
                        <div className="w-full h-full flex-1 flex flex-col relative min-h-0 min-w-0 overflow-hidden" style={{height: "100%", minHeight: 0}}>
                            {/* Drag region for bare windows (allows moving the window) */}
                            <div className="w-full h-6 flex-shrink-0 z-50 pointer-events-auto" style={{ WebkitAppRegion: 'drag' } as any}></div>
                            <div className="w-full flex-1 relative overflow-hidden flex flex-row min-h-0 min-w-0">
                                {tabId === "" ? (
                                    <CenteredDiv>No Active Tab</CenteredDiv>
                                ) : (
                                    <TabContent key={tabId} tabId={tabId} />
                                )}
                            </div>
                        </div>
                    ) : (
                        <PanelGroup
                            direction="horizontal"
                            onLayout={workspaceLayoutModel.handlePanelLayout}
                            ref={panelGroupRef}
                        >
                            <Panel
                                ref={aiPanelRef}
                                collapsible
                                minSize={20}
                                defaultSize={100}
                                order={1}
                                className="overflow-hidden"
                            >
                                <div ref={aiPanelWrapperRef} className="w-full h-full box-border">
                                    {tabId !== "" && <AIPanel />}
                                </div>
                            </Panel>
                            <PanelResizeHandle className={`w-[2px] transition-colors cursor-col-resize ${terminalVisible ? "bg-zinc-700/50 hover:bg-accent/60" : "bg-transparent pointer-events-none"}`} />
                            <Panel
                                ref={terminalPanelRef}
                                collapsible
                                defaultSize={0}
                                minSize={20}
                                order={2}
                                className="overflow-hidden"
                            >
                                {(!aiVisible || terminalVisible) && (
                                    tabId === "" ? (
                                        <CenteredDiv>No Active Tab</CenteredDiv>
                                    ) : (
                                        <div className="flex flex-row h-full">
                                            <TabContent key={tabId} tabId={tabId} />
                                            <Widgets />
                                        </div>
                                    )
                                )}
                            </Panel>
                        </PanelGroup>
                    )}
                    <ModalsRenderer />
                </ErrorBoundary>
            </div>
        </div>
    );
});

WorkspaceElem.displayName = "WorkspaceElem";

export { WorkspaceElem as Workspace };
