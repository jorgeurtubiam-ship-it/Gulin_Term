// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import { WOS, globalStore } from "@/store/global";
import { getGulinObjectAtom, makeORef } from "@/store/wos";
import { ErrorBoundary } from "@/element/errorboundary";
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    Handle,
    Position,
    useNodesState,
    useEdgesState,
    MarkerType,
    BackgroundVariant,
} from "@xyflow/react";
import dagre from "dagre";
import { parseSqlToGraph, type SqlFlowNode, type SqlNodeType } from "./sql-parser";
import "@xyflow/react/dist/style.css";
import "./sqlflow.scss";

// ─── Node type icons & labels ────────────────────────────────────────────────
const NODE_META: Record<SqlNodeType, { icon: string; label: string; color: string }> = {
    TABLE:     { icon: "fa-table",        label: "Table",     color: "#3b82f6" },
    JOIN:      { icon: "fa-code-fork",    label: "Join",      color: "#ec4899" },
    FILTER:    { icon: "fa-filter",       label: "Filter",    color: "#a855f7" },
    AGGREGATE: { icon: "fa-layer-group",  label: "Aggregate", color: "#f59e0b" },
    WINDOW:    { icon: "fa-chart-area",   label: "Window",    color: "#ec4899" },
    CTE:       { icon: "fa-cube",         label: "CTE",       color: "#8b5cf6" },
    SUBQUERY:  { icon: "fa-brackets-curly", label: "Subquery", color: "#6366f1" },
    SORT:      { icon: "fa-sort",         label: "Sort",      color: "#84cc16" },
    LIMIT:     { icon: "fa-compress",     label: "Limit",     color: "#06b6d4" },
    RESULT:    { icon: "fa-circle-check", label: "Result",    color: "#22c55e" },
};

// ─── Custom React Flow node component ────────────────────────────────────────
function SqlNodeComponent({ data }: { data: SqlFlowNode }) {
    const meta = NODE_META[data.sqlType] ?? NODE_META.TABLE;
    return (
        <div className={`sqlflow-node type-${data.sqlType}`}>
            <Handle type="target" position={Position.Top} style={{ background: meta.color, width: 8, height: 8 }} />
            <div className="sqlflow-node-header">
                <div className="sqlflow-node-icon">
                    <i className={`fa ${meta.icon} text-[8px]`} />
                </div>
                <span className="sqlflow-node-type">{meta.label}</span>
            </div>
            <div className="sqlflow-node-label">{String(data.label)}</div>
            {data.details && data.details.length > 0 && (
                <div className="sqlflow-node-details">
                    {(data.details as string[]).slice(0, 3).map((d, i) => (
                        <div key={i} className="sqlflow-node-detail" title={d}>{d}</div>
                    ))}
                </div>
            )}
            <Handle type="source" position={Position.Bottom} style={{ background: meta.color, width: 8, height: 8 }} />
        </div>
    );
}

const nodeTypes = { sqlNode: SqlNodeComponent };

// ─── Dagre layout helper ──────────────────────────────────────────────────────
function applyDagreLayout(nodes: any[], edges: any[], direction = "TB") {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: direction, ranksep: 80, nodesep: 50 });

    nodes.forEach((node) => g.setNode(node.id, { width: 200, height: 90 }));
    edges.forEach((edge) => g.setEdge(edge.source, edge.target));

    dagre.layout(g);

    return nodes.map((node) => {
        const pos = g.node(node.id);
        return { ...node, position: { x: pos.x - 100, y: pos.y - 45 } };
    });
}

// ─── Legend ───────────────────────────────────────────────────────────────────
const LEGEND_ITEMS: SqlNodeType[] = ["TABLE", "JOIN", "FILTER", "AGGREGATE", "CTE", "SORT", "RESULT"];

function SqlFlowLegend() {
    return (
        <div className="sqlflow-legend">
            <span className="sqlflow-legend-label">Legend</span>
            {LEGEND_ITEMS.map((type) => {
                const meta = NODE_META[type];
                return (
                    <div key={type} className="sqlflow-legend-item">
                        <div className="sqlflow-legend-dot" style={{ background: meta.color }} />
                        {meta.label}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Main View Component ──────────────────────────────────────────────────────
function SqlFlowView({ model }: { model: SqlFlowViewModel }) {
    const blockDataAtom = React.useMemo(
        () => getGulinObjectAtom<Block>(makeORef("block", model.blockId)),
        [model.blockId]
    );
    const blockData = jotai.useAtomValue(blockDataAtom);

    const sql: string = (blockData?.meta?.["sql"] as string) ?? "";
    const dialect: string = (blockData?.meta?.["dialect"] as string) ?? "oracle";
    const connName: string = (blockData?.meta?.["connection"] as string) ?? "";

    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [parseError, setParseError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!sql?.trim()) {
            setNodes([]);
            setEdges([]);
            setParseError(null);
            return;
        }

        const result = parseSqlToGraph(sql, dialect);
        setParseError(result.error ?? null);

        const laid = applyDagreLayout(result.nodes, result.edges);
        setNodes(laid);
        setEdges(
            result.edges.map((e) => ({
                ...e,
                type: "smoothstep",
                animated: false,
                style: { stroke: "#3f3f46", strokeWidth: 1.5 },
                markerEnd: { type: MarkerType.ArrowClosed, color: "#52525b", width: 14, height: 14 },
            }))
        );
    }, [sql, dialect]);

    const dialectLabel = dialect?.toUpperCase() ?? "SQL";

    return (
        <ErrorBoundary>
            <div className="sqlflow-view">
                {/* Header */}
                <div className="sqlflow-header">
                    <div className="sqlflow-header-left">
                        <div className="sqlflow-icon">
                            <i className="fa fa-diagram-project text-white text-xs" />
                        </div>
                        <div>
                            <div className="sqlflow-title">SQL Flow</div>
                            {connName && (
                                <div className="sqlflow-subtitle">{connName}</div>
                            )}
                        </div>
                    </div>
                    <div className="sqlflow-dialect-badge">{dialectLabel}</div>
                </div>

                {/* Error banner */}
                {parseError && (
                    <div className="sqlflow-error-banner">
                        <i className="fa fa-triangle-exclamation mr-2" />
                        Parser fallback: {parseError.slice(0, 120)}
                    </div>
                )}

                {/* Canvas or Empty state */}
                {!sql?.trim() ? (
                    <div className="sqlflow-empty">
                        <i className="fa fa-diagram-project sqlflow-empty-icon" />
                        <div className="sqlflow-empty-title">No SQL to visualize</div>
                        <div className="sqlflow-empty-hint">Escribe una query y haz clic en SQL Flow</div>
                    </div>
                ) : (
                    <div className="sqlflow-canvas">
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            nodeTypes={nodeTypes}
                            fitView
                            fitViewOptions={{ padding: 0.3 }}
                            minZoom={0.2}
                            maxZoom={2}
                            proOptions={{ hideAttribution: true }}
                        >
                            <Background
                                variant={BackgroundVariant.Dots}
                                gap={20}
                                size={1}
                                color="#27272a"
                            />
                            <Controls
                                showInteractive={false}
                                style={{
                                    background: "#111113",
                                    border: "1px solid #27272a",
                                    borderRadius: 8,
                                }}
                            />
                            <MiniMap
                                style={{
                                    background: "#0c0c0e",
                                    border: "1px solid #27272a",
                                    borderRadius: 8,
                                }}
                                nodeColor={(n) => {
                                    const t = (n.data as SqlFlowNode).sqlType;
                                    return NODE_META[t]?.color ?? "#3f3f46";
                                }}
                                maskColor="rgba(9,9,11,0.7)"
                            />
                        </ReactFlow>
                    </div>
                )}

                {/* Legend */}
                {sql?.trim() && <SqlFlowLegend />}
            </div>
        </ErrorBoundary>
    );
}

// ─── ViewModel ────────────────────────────────────────────────────────────────
class SqlFlowViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<string>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "sql-flow";
        this.viewIcon = jotai.atom<string>("diagram-project");
        this.viewName = jotai.atom<string>("SQL Flow");
        this.viewText = jotai.atom<string>("SQL Flow");
    }

    get viewComponent(): ViewComponent {
        return SqlFlowView;
    }
}

export { SqlFlowViewModel };
