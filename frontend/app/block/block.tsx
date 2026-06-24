// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    BlockComponentModel2,
    BlockNodeModel,
    BlockProps,
    FullBlockProps,
    FullSubBlockProps,
    SubBlockProps,
} from "@/app/block/blocktypes";
import { AiFileDiffViewModel } from "@/app/view/aifilediff/aifilediff";
import { LauncherViewModel } from "@/app/view/launcher/launcher";
import { PreviewModel } from "@/app/view/preview/preview-model";
import { SysinfoViewModel } from "@/app/view/sysinfo/sysinfo";
import { TsunamiViewModel } from "@/app/view/tsunami/tsunami";
import { APIEndpointManagerViewModel } from "@/app/view/gulinai/apimanager";
import { DBConnectionsViewModel } from "@/app/view/gulinai/dbconnections";
import { DBExplorerViewModel } from "@/app/view/gulinai/dbexplorer";
import { MemoryGridViewModel } from "@/app/view/gulinai/memorygrid";
import { ErrorBoundary } from "@/element/errorboundary";
import { VDomModel } from "@/app/view/vdom/vdom-model";
import { DebugLogsViewModel } from "@/app/view/debuglogs/debuglogs-model";
import { ServiceMapViewModel } from "@/app/view/servicemap/servicemap";
import { OracleMonitorViewModel } from "@/app/view/oraclemonitor/oraclemonitor";
import { AutoAgentsViewModel } from "@/app/view/autoagents/autoagents";
import { CenteredDiv } from "@/element/quickelems";
import { useDebouncedNodeInnerRect } from "@/layout/index";
import { counterInc } from "@/store/counters";
import {
    atoms,
    getBlockComponentModel,
    getSettingsKeyAtom,
    registerBlockComponentModel,
    unregisterBlockComponentModel,
} from "@/store/global";
import type { TabModel } from "@/app/store/tab-model";
import { useTabModel } from "@/app/store/tab-model";
import { getGulinObjectAtom, makeORef, useGulinObjectValue } from "@/store/wos";
import { focusedBlockId, getElemAsStr } from "@/util/focusutil";
import { isBlank, useAtomValueSafe } from "@/util/util";
import { HelpViewModel } from "@/view/helpview/helpview";
import { TermViewModel } from "@/view/term/term-model";
import { GulinAiModel } from "@/view/gulinai/gulinai";
import { WebViewModel } from "@/view/webview/webview";
import clsx from "clsx";
import { atom, useAtomValue } from "jotai";
import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { QuickTipsViewModel } from "../view/quicktipsview/quicktipsview";
import { GulinConfigViewModel } from "../view/gulinconfig/gulinconfig-model";
import "./block.scss";
import { BlockFrame } from "./blockframe";
import { blockViewToIcon, blockViewToName } from "./blockutil";

import { DashboardViewModel } from "@/app/view/dashboard/dashboard-model";
import { BrainViewModel } from "@/app/view/brain/brain-model";
import { ToolsAdminViewModel } from "@/app/view/toolsadmin/toolsadmin-model";

const BlockRegistry: Map<string, ViewModelClass> = new Map();
BlockRegistry.set("term", TermViewModel);
BlockRegistry.set("preview", PreviewModel);
BlockRegistry.set("web", WebViewModel);
BlockRegistry.set("gulinai", GulinAiModel);
BlockRegistry.set("cpuplot", SysinfoViewModel);
BlockRegistry.set("sysinfo", SysinfoViewModel);
BlockRegistry.set("vdom", VDomModel);
BlockRegistry.set("tips", QuickTipsViewModel);
BlockRegistry.set("help", HelpViewModel);
BlockRegistry.set("launcher", LauncherViewModel);
BlockRegistry.set("tsunami", TsunamiViewModel);
BlockRegistry.set("aifilediff", AiFileDiffViewModel);
BlockRegistry.set("gulinconfig", GulinConfigViewModel);
BlockRegistry.set("memory-grid", MemoryGridViewModel);
BlockRegistry.set("db-connections", DBConnectionsViewModel);
BlockRegistry.set("db-explorer", DBExplorerViewModel);
BlockRegistry.set("api-manager", APIEndpointManagerViewModel);
BlockRegistry.set("dashboard", DashboardViewModel);
BlockRegistry.set("debug-logs", DebugLogsViewModel);
BlockRegistry.set("service-map", ServiceMapViewModel);
BlockRegistry.set("oracle-monitor", OracleMonitorViewModel);
// BlockRegistry.set("codeeditor", ...); // codeeditor currently does not have a viewmodel
BlockRegistry.set("brain", BrainViewModel);
BlockRegistry.set("auto-agents", AutoAgentsViewModel);
BlockRegistry.set("tools-admin", ToolsAdminViewModel);

function makeViewModel(blockId: string, blockView: string, nodeModel: BlockNodeModel, tabModel: TabModel): ViewModel {
    const ctor = BlockRegistry.get(blockView);
    if (ctor != null) {
        return new ctor(blockId, nodeModel, tabModel);
    }
    return makeDefaultViewModel(blockId, blockView);
}

function getViewElem(
    blockId: string,
    blockRef: React.RefObject<HTMLDivElement>,
    contentRef: React.RefObject<HTMLDivElement>,
    blockView: string,
    viewModel: ViewModel
): React.ReactElement {
    if (isBlank(blockView)) {
        return <CenteredDiv>No View</CenteredDiv>;
    }
    if (viewModel.viewComponent == null) {
        return <CenteredDiv>No View Component</CenteredDiv>;
    }
    const VC = viewModel.viewComponent;
    return <VC key={blockId} blockId={blockId} blockRef={blockRef} contentRef={contentRef} model={viewModel} />;
}

function makeDefaultViewModel(blockId: string, viewType: string): ViewModel {
    const blockDataAtom = getGulinObjectAtom<Block>(makeORef("block", blockId));
    let viewModel: ViewModel = {
        viewType: viewType,
        viewIcon: atom((get) => {
            const blockData = get(blockDataAtom);
            return blockViewToIcon(blockData?.meta?.view);
        }),
        viewName: atom((get) => {
            const blockData = get(blockDataAtom);
            return blockViewToName(blockData?.meta?.view);
        }),
        preIconButton: atom(null),
        endIconButtons: atom(null),
        viewComponent: null,
    };
    return viewModel;
}

const BlockPreview = memo(({ nodeModel, viewModel }: FullBlockProps) => {
    const [blockData] = useGulinObjectValue<Block>(makeORef("block", nodeModel.blockId));
    if (!blockData) {
        return null;
    }
    return (
        <BlockFrame
            key={nodeModel.blockId}
            nodeModel={nodeModel}
            preview={true}
            blockModel={null}
            viewModel={viewModel}
        />
    );
});

const BlockSubBlock = memo(({ nodeModel, viewModel }: FullSubBlockProps) => {
    const [blockData] = useGulinObjectValue<Block>(makeORef("block", nodeModel.blockId));
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const viewElem = useMemo(
        () => getViewElem(nodeModel.blockId, blockRef, contentRef, blockData?.meta?.view, viewModel),
        [nodeModel.blockId, blockData?.meta?.view, viewModel]
    );
    const noPadding = useAtomValueSafe(viewModel.noPadding);
    if (!blockData) {
        return null;
    }
    return (
        <div key="content" className={clsx("block-content", { "block-no-padding": noPadding })} ref={contentRef}>
            <ErrorBoundary>
                <Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</Suspense>
            </ErrorBoundary>
        </div>
    );
});

const BlockFull = memo(({ nodeModel, viewModel }: FullBlockProps) => {
    counterInc("render-BlockFull");
    const focusElemRef = useRef<HTMLInputElement>(null);
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [blockClicked, setBlockClicked] = useState(false);
    const [blockData] = useGulinObjectValue<Block>(makeORef("block", nodeModel.blockId));
    const isFocused = useAtomValue(nodeModel.isFocused);
    const disablePointerEvents = useAtomValue(nodeModel.disablePointerEvents);
    const isResizing = useAtomValue(nodeModel.isResizing);
    const isMagnified = useAtomValue(nodeModel.isMagnified);
    const anyMagnified = useAtomValue(nodeModel.anyMagnified);
    const modalOpen = useAtomValue(atoms.modalOpen);
    const focusFollowsCursorMode = useAtomValue(getSettingsKeyAtom("app:focusfollowscursor")) ?? "off";
    const innerRect = useDebouncedNodeInnerRect(nodeModel);
    const noPadding = useAtomValueSafe(viewModel.noPadding);

    useLayoutEffect(() => {
        setBlockClicked(isFocused);
    }, [isFocused]);

    useLayoutEffect(() => {
        if (!blockClicked) {
            return;
        }
        setBlockClicked(false);
        const focusWithin = focusedBlockId() == nodeModel.blockId;
        if (!focusWithin) {
            setFocusTarget();
        }
        if (!isFocused) {
            nodeModel.focusNode();
        }
    }, [blockClicked, isFocused]);

    const setBlockClickedTrue = useCallback(() => {
        setBlockClicked(true);
    }, []);

    const [blockContentOffset, setBlockContentOffset] = useState<Dimensions>();

    useEffect(() => {
        if (blockRef.current && contentRef.current) {
            const blockRect = blockRef.current.getBoundingClientRect();
            const contentRect = contentRef.current.getBoundingClientRect();
            setBlockContentOffset({
                top: 0,
                left: 0,
                width: blockRect.width - contentRect.width,
                height: blockRect.height - contentRect.height,
            });
        }
    }, [blockRef, contentRef]);

    const blockContentStyle = useMemo<React.CSSProperties>(() => {
        const retVal: React.CSSProperties = {
            pointerEvents: disablePointerEvents ? "none" : undefined,
        };
        if (innerRect?.width && innerRect.height && blockContentOffset) {
            retVal.width = `calc(${innerRect?.width} - ${blockContentOffset.width}px)`;
            retVal.height = `calc(${innerRect?.height} - ${blockContentOffset.height}px)`;
        }
        return retVal;
    }, [innerRect, disablePointerEvents, blockContentOffset]);

    const viewElem = useMemo(
        () => getViewElem(nodeModel.blockId, blockRef, contentRef, blockData?.meta?.view, viewModel),
        [nodeModel.blockId, blockData?.meta?.view, viewModel]
    );

    const handleChildFocus = useCallback(
        (event: React.FocusEvent<HTMLDivElement, Element>) => {
            console.log("setFocusedChild", nodeModel.blockId, getElemAsStr(event.target));
            if (!isFocused) {
                console.log("focusedChild focus", nodeModel.blockId);
                nodeModel.focusNode();
            }
        },
        [isFocused]
    );

    const setFocusTarget = useCallback(() => {
        const ok = viewModel?.giveFocus?.();
        if (ok) {
            return;
        }
        focusElemRef.current?.focus({ preventScroll: true });
    }, [viewModel]);

    const focusFromPointerEnter = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            const focusFollowsCursorEnabled =
                focusFollowsCursorMode === "on" ||
                (focusFollowsCursorMode === "term" && blockData?.meta?.view === "term");
            if (!focusFollowsCursorEnabled || event.pointerType === "touch" || event.buttons > 0) {
                return;
            }
            if (modalOpen || disablePointerEvents || isResizing || (anyMagnified && !isMagnified)) {
                return;
            }
            if (isFocused && focusedBlockId() === nodeModel.blockId) {
                return;
            }
            setFocusTarget();
            if (!isFocused) {
                nodeModel.focusNode();
            }
        },
        [
            focusFollowsCursorMode,
            blockData?.meta?.view,
            modalOpen,
            disablePointerEvents,
            isResizing,
            isMagnified,
            anyMagnified,
            isFocused,
            nodeModel,
            setFocusTarget,
        ]
    );

    const blockModel = useMemo<BlockComponentModel2>(
        () => ({
            onClick: setBlockClickedTrue,
            onPointerEnter: focusFromPointerEnter,
            onFocusCapture: handleChildFocus,
            blockRef: blockRef,
        }),
        [setBlockClickedTrue, focusFromPointerEnter, handleChildFocus, blockRef]
    );

    return (
        <BlockFrame
            key={nodeModel.blockId}
            nodeModel={nodeModel}
            preview={false}
            blockModel={blockModel}
            viewModel={viewModel}
        >
            <div key="focuselem" className="block-focuselem">
                <input
                    type="text"
                    value=""
                    ref={focusElemRef}
                    id={`${nodeModel.blockId}-dummy-focus`} // don't change this name (used in refocusNode)
                    className="dummy-focus"
                    onChange={() => { }}
                />
            </div>
            <div
                key="content"
                className={clsx("block-content", { "block-no-padding": noPadding })}
                ref={contentRef}
                style={blockContentStyle}
            >
                <ErrorBoundary>
                    <Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</Suspense>
                </ErrorBoundary>
            </div>
        </BlockFrame>
    );
});

const Block = memo((props: BlockProps) => {
    counterInc("render-Block");
    counterInc("render-Block-" + props.nodeModel?.blockId?.substring(0, 8));
    const tabModel = useTabModel();
    const [blockData, loading] = useGulinObjectValue<Block>(makeORef("block", props.nodeModel.blockId));
    const bcm = getBlockComponentModel(props.nodeModel.blockId);
    let viewModel = bcm?.viewModel;
    if (viewModel == null || viewModel.viewType != blockData?.meta?.view) {
        viewModel = makeViewModel(props.nodeModel.blockId, blockData?.meta?.view, props.nodeModel, tabModel);
        registerBlockComponentModel(props.nodeModel.blockId, { viewModel });
    }
    useEffect(() => {
        return () => {
            unregisterBlockComponentModel(props.nodeModel.blockId);
            viewModel?.dispose?.();
        };
    }, []);
    if (loading || isBlank(props.nodeModel.blockId) || blockData == null) {
        return null;
    }
    if (props.preview) {
        return <BlockPreview {...props} viewModel={viewModel} />;
    }
    return <BlockFull {...props} viewModel={viewModel} />;
});

const SubBlock = memo((props: SubBlockProps) => {
    counterInc("render-Block");
    counterInc("render-Block-" + props.nodeModel?.blockId?.substring(0, 8));
    const tabModel = useTabModel();
    const [blockData, loading] = useGulinObjectValue<Block>(makeORef("block", props.nodeModel.blockId));
    const bcm = getBlockComponentModel(props.nodeModel.blockId);
    let viewModel = bcm?.viewModel;
    if (viewModel == null || viewModel.viewType != blockData?.meta?.view) {
        viewModel = makeViewModel(props.nodeModel.blockId, blockData?.meta?.view, props.nodeModel, tabModel);
        registerBlockComponentModel(props.nodeModel.blockId, { viewModel });
    }
    useEffect(() => {
        return () => {
            unregisterBlockComponentModel(props.nodeModel.blockId);
            viewModel?.dispose?.();
        };
    }, []);
    if (loading || isBlank(props.nodeModel.blockId) || blockData == null) {
        return null;
    }
    return <BlockSubBlock {...props} viewModel={viewModel} />;
});

export { Block, SubBlock };
