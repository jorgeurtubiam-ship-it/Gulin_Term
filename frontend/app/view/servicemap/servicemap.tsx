// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import { WOS } from "@/store/global";
import { cn, fireAndForget } from "@/util/util";
import { TransformWrapper, TransformComponent, useTransformContext } from "react-zoom-pan-pinch";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { GulinAIModel } from "@/app/aipanel/gulinai-model";

interface ServiceNode {
    id: string;
    x: number;
    y: number;
    label: string;
    type: string;
    status: string;
    icon: string;
    parent_id?: string;
    xp_value?: number;
    status_color?: string;
    metadata?: any;
    description?: string;
}

interface ServiceEdge {
    from: string;
    to: string;
    traffic: string;
}

class ServiceMapViewModel implements ViewModel {
    viewType: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    blockId: string;
    blockAtom: jotai.Atom<Block>;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "service-map";
        this.blockId = blockId;
        this.blockAtom = WOS.getGulinObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = jotai.atom("network-wired");
        this.viewName = jotai.atom("Mapa de Servicios");
    }

    get viewComponent(): ViewComponent {
        return ServiceMapView;
    }
}

const SOURCES = [
    { id: 'source-docker', label: 'DOCKER CONTAINERS', color: 'blue' },
    { id: 'source-aws', label: 'AWS INFRASTRUCTURE', color: 'orange' },
    { id: 'source-vbox', label: 'VIRTUALBOX VMs', color: 'purple' },
    { id: 'source-host', label: 'LOCAL HOST', color: 'emerald' }
];

function ServiceMapView({ model, blockId }: { model: ServiceMapViewModel, blockId: string }) {
    const isMagnified = jotai.useAtomValue(model.nodeModel.isMagnified);
    const [nodes, setNodes] = React.useState<ServiceNode[]>([]);
    const [edges, setEdges] = React.useState<any[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

    const debugNode: ServiceNode = {
        id: 'debug-check',
        label: 'SISTEMA OPERATIVO',
        type: 'host',
        status: 'online',
        icon: 'desktop',
        x: 500,
        y: 100,
        parent_id: 'source-host'
    };

    const [draggingNode, setDraggingNode] = React.useState<string | null>(null);
    const [selectedNode, setSelectedNode] = React.useState<ServiceNode | null>(null);

    const fetchData = React.useCallback(async () => {
        if (draggingNode) return;
        setLoading(true);
        try {
            const nodesJson = await RpcApi.PathCommand(TabRpcClient, {
                pathtype: "sql:SELECT id, label, type, status, icon, x, y, description, parent_id, xp_value, status_color, metadata FROM infra_nodes ORDER BY id ASC",
                tabid: model.tabModel.tabId
            });
            
            if (nodesJson) {
                const nodesData = JSON.parse(nodesJson);
                if (Array.isArray(nodesData)) {
                    setNodes(nds => {
                        const mergedNodes = nodesData.map((node, idx) => {
                            // Auto-asignación de padre por prefijo
                            let pid = node.parent_id;
                            if (!pid && node.id) {
                                if (node.id.startsWith('vbox-')) pid = 'source-vbox';
                                else if (node.id.startsWith('aws-')) pid = 'source-aws';
                                else if (node.id.startsWith('docker-') || node.id.includes('bridge')) pid = 'source-docker';
                                else pid = 'source-host';
                            } else if (!pid) pid = 'source-host';

                            // Si la DB tiene 0,0 O si el nodo es nuevo, forzamos posición por grupo
                            if (node.x === 0 && node.y === 0) {
                                const sourceIdx = SOURCES.findIndex(s => s.id === pid);
                                const groupOffset = sourceIdx * 650 + 200; // Colocar grupos más juntos
                                const itemsInGroup = nodesData.filter(n => {
                                    if (n.id.startsWith('vbox-')) return pid === 'source-vbox';
                                    if (n.id.startsWith('aws-')) return pid === 'source-aws';
                                    if (n.id.startsWith('docker-') || n.id.includes('bridge')) return pid === 'source-docker';
                                    return pid === 'source-host';
                                }).indexOf(node);

                                return {
                                    ...node,
                                    x: groupOffset + (idx % 2) * 260,
                                    y: 250 + Math.floor(idx / 2) * 240,
                                    parent_id: pid
                                };
                            }
                            
                            return { ...node, parent_id: pid };
                        });
                        return [debugNode, ...mergedNodes];
                    });
                }
            }
            
            const edgesJson = await RpcApi.PathCommand(TabRpcClient, {
                pathtype: "sql:SELECT source, target, traffic FROM infra_edges",
                tabid: model.tabModel.tabId
            });
            if (edgesJson) {
                const edgesData = JSON.parse(edgesJson);
                setEdges(Array.isArray(edgesData) ? edgesData : []);
            }
        } catch (e: any) {
            console.error("Fetch error", e);
        } finally {
            setLoading(false);
        }
    }, [model.tabModel.tabId, draggingNode]);

    React.useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const isOnline = (status: string) => {
        const s = (status || "").toLowerCase();
        return s.includes("up") || s.includes("online") || s.includes("active") || s.includes("corriendo") || s.includes("running");
    };

    const saveNodePosition = async (nodeId: string, x: number, y: number) => {
        if (nodeId === 'debug-check') return;
        try {
            await RpcApi.PathCommand(TabRpcClient, {
                pathtype: `sql:UPDATE infra_nodes SET x = ${Math.round(x)}, y = ${Math.round(y)} WHERE id = '${nodeId}'`,
                tabid: model.tabModel.tabId
            });
        } catch (e) {
            console.error("Error saving position", e);
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-[#0a0a0c] text-white font-sans overflow-hidden">
            <header className="p-4 border-b border-white/10 flex items-center justify-between bg-zinc-900/50 backdrop-blur-md z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center shadow-[0_0_15px_rgba(79,70,229,0.4)]">
                        <i className="fa fa-network-wired text-white text-xl"></i>
                    </div>
                    <div>
                        <h1 className="text-lg font-bold tracking-tight uppercase">Gulin Service Map</h1>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-black">Visualización de Infraestructura</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex gap-2">
                        {SOURCES.map(s => (
                            <div key={s.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-800/50 border border-white/5">
                                <div className={cn("w-2 h-2 rounded-full", 
                                    s.color === 'blue' ? 'bg-blue-500' : 
                                    s.color === 'orange' ? 'bg-orange-500' : 
                                    s.color === 'purple' ? 'bg-purple-500' : 'bg-emerald-500')} 
                                />
                                <span className="text-[10px] font-bold text-zinc-300">{s.label}</span>
                            </div>
                        ))}
                    </div>
                    <button onClick={fetchData} className={cn("p-2 hover:bg-white/5 rounded-md transition-colors", loading && "animate-spin")}>
                        <i className="fa fa-sync text-zinc-400"></i>
                    </button>
                </div>
            </header>

            <main className="flex-1 relative bg-[radial-gradient(circle_at_center,_var(--tw-gradient-from)_0%,_transparent_100%)] from-indigo-500/5 to-transparent overflow-auto">
                <TransformWrapper key={isMagnified ? 'mag' : 'norm'} initialScale={isMagnified ? 1.5 : 1.1} minScale={0.05} maxScale={4} limitToBounds={false}>
                    <ServiceMapContent 
                        nodes={nodes} 
                        edges={edges}
                        setNodes={setNodes}
                        setDraggingNode={setDraggingNode}
                        setSelectedNode={setSelectedNode}
                        saveNodePosition={saveNodePosition}
                        isOnline={isOnline}
                    />
                </TransformWrapper>
            </main>

            {/* Modal de Detalles */}
            {selectedNode && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 backdrop-blur-md bg-black/60" onClick={() => setSelectedNode(null)}>
                    <div className="bg-zinc-900 border border-white/10 w-full max-w-2xl rounded-[3rem] p-10 shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-start mb-8">
                            <div className="flex items-center gap-6">
                                <div className="w-20 h-20 rounded-[2rem] bg-indigo-500/20 flex items-center justify-center text-5xl text-indigo-400">
                                    <i className={`fa fa-${selectedNode.icon || 'server'}`}></i>
                                </div>
                                <div>
                                    <h2 className="text-3xl font-black text-white tracking-tighter uppercase">{selectedNode.label}</h2>
                                    <p className="text-indigo-400 font-black tracking-widest text-xs uppercase">{selectedNode.type} • {selectedNode.status}</p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedNode(null)} className="p-3 hover:bg-white/5 rounded-2xl transition-colors text-zinc-500 hover:text-white">
                                <i className="fa fa-times text-2xl"></i>
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-8">
                            <div className="p-6 rounded-3xl bg-white/5 border border-white/5">
                                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Technical ID</p>
                                <code className="text-indigo-300 font-mono text-sm">{selectedNode.id}</code>
                            </div>
                            <div className="p-6 rounded-3xl bg-white/5 border border-white/5">
                                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Location/Source</p>
                                <p className="text-zinc-300 font-bold uppercase">{selectedNode.parent_id?.replace('source-', '') || 'Local'}</p>
                            </div>
                        </div>

                        <div className="p-8 rounded-[2.5rem] bg-indigo-500/5 border border-indigo-500/10 mb-8">
                            <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4">Detailed Description</p>
                            <p className="text-zinc-300 leading-relaxed font-medium">
                                {selectedNode.description || "No hay información adicional disponible para este nodo. Gulin puede agregar detalles automáticamente al escanear la infraestructura."}
                            </p>
                        </div>

                        <div className="flex justify-between items-center">
                            <button 
                                onClick={() => {
                                    const model = GulinAIModel.getInstance();
                                    const logCategory = selectedNode.type === "api" ? "API" 
                                        : selectedNode.type === "db" ? "DB" 
                                        : selectedNode.type === "terminal" ? "TERM" 
                                        : undefined;
                                    setSelectedNode(null);
                                    model.openDebugLogsWithFilter(logCategory);
                                }} 
                                className="px-8 py-4 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-400 font-black rounded-2xl transition-colors uppercase text-xs tracking-widest flex items-center gap-2"
                            >
                                <i className="fa fa-bug" />
                                Ver Logs
                            </button>
                            <button onClick={() => setSelectedNode(null)} className="px-10 py-4 bg-white text-black font-black rounded-2xl hover:bg-zinc-200 transition-colors uppercase text-xs tracking-widest">
                                Cerrar Detalles
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <footer className="p-4 border-t border-white/10 bg-zinc-900/80 flex items-center justify-between text-[10px]">
                <div className="flex gap-4">
                    <span className="text-zinc-500 font-bold uppercase tracking-widest">Nodos Totales: <span className="text-white">{nodes.length}</span></span>
                    <span className="text-zinc-500 font-bold uppercase tracking-widest text-zinc-600">ID DEBUG: {nodes[0]?.id}</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                    <span className="text-zinc-400 font-black uppercase tracking-tighter">Sincronizado en tiempo real</span>
                </div>
            </footer>
        </div>
    );
}

function ServiceMapContent({ nodes, edges, setNodes, setDraggingNode, setSelectedNode, saveNodePosition, isOnline }: any) {
    const { transformState } = useTransformContext();
    const scale = transformState.scale;

    const onMouseDown = (e: React.MouseEvent, nodeId: string) => {
        e.stopPropagation();
        const nodeIdx = nodes.findIndex((n: any) => n.id === nodeId);
        if (nodeIdx === -1) return;
        
        const node = nodes[nodeIdx];
        setDraggingNode(nodeId);

        const startX = e.clientX;
        const startY = e.clientY;
        const initialX = node.x;
        const initialY = node.y;
        
        let lastX = initialX;
        let lastY = initialY;
        let moved = false;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const dx = (moveEvent.clientX - startX) / scale; // CORRECCIÓN POR ZOOM
            const dy = (moveEvent.clientY - startY) / scale; // CORRECCIÓN POR ZOOM
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
            
            lastX = initialX + dx;
            lastY = initialY + dy;
            
            setNodes((nds: any[]) => nds.map(n => 
                n.id === nodeId ? { ...n, x: lastX, y: lastY } : n
            ));
        };

        const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            setDraggingNode(null);
            if (moved) {
                saveNodePosition(nodeId, lastX, lastY);
            } else {
                setSelectedNode(node);
            }
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };

    return (
        <TransformComponent wrapperClass="!w-full !h-full">
            <div className="w-[3200px] h-[2200px] relative">
                {/* Source Sections */}
                {SOURCES.map((s, idx) => (
                    <div key={s.id} 
                        style={{ 
                            position: 'absolute', 
                            left: `${idx * 650 + 50}px`, 
                            top: '100px',
                            width: '580px',
                            height: '1500px',
                            border: '2px dashed rgba(255,255,255,0.03)',
                            borderRadius: '40px',
                            pointerEvents: 'none'
                        }}
                    >
                        <div className="absolute top-6 left-8 text-[18px] font-black text-zinc-800 tracking-[0.4em] uppercase opacity-40">
                            {s.label}
                        </div>
                    </div>
                ))}

                {/* SVG connections */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
                    {edges.map((edge: any, i: number) => {
                        const fromNode = nodes.find((n: any) => n.id === edge.source);
                        const toNode = nodes.find((n: any) => n.id === edge.target);
                        if (!fromNode || !toNode) return null;
                        return (
                            <line 
                                key={`edge-${i}`} 
                                x1={fromNode.x} y1={fromNode.y} 
                                x2={toNode.x} y2={toNode.y} 
                                stroke="#818cf8" strokeWidth="2" 
                                strokeDasharray="10,5" 
                            />
                        );
                    })}
                </svg>

                {/* Nodes */}
                {nodes.map((node: any, idx: number) => {
                    const online = isOnline(node.status);
                    const pid = node.parent_id || 'source-host';
                    const sIdx = SOURCES.findIndex(s => s.id === pid);
                    const groupOffset = sIdx * 650 + 200;
                    
                    const posX = node.x === 0 ? groupOffset + (idx % 2) * 260 : node.x;
                    const posY = node.y === 0 ? 250 + Math.floor(idx / 2) * 240 : node.y;

                    return (
                        <div
                            key={node.id}
                            onMouseDown={(e) => onMouseDown(e, node.id)}
                            style={{ left: `${posX}px`, top: `${posY}px`, transform: 'translate(-50%, -50%)' }}
                            className={cn(
                                "absolute p-6 rounded-[2rem] border backdrop-blur-3xl transition-all cursor-grab active:cursor-grabbing group w-80 select-none",
                                online 
                                    ? "bg-zinc-900/95 border-indigo-500/50 shadow-[0_20px_50px_rgba(0,0,0,0.5),0_0_30px_rgba(99,101,241,0.2)]" 
                                    : "bg-zinc-900/95 border-zinc-700/50 opacity-90"
                            )}
                        >
                            <div className="flex items-start justify-between mb-6 pointer-events-none">
                                <div className={cn(
                                    "w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shadow-inner",
                                    online ? "bg-indigo-500/20 text-indigo-400" : "bg-zinc-800 text-zinc-500"
                                )}>
                                    {node.icon && node.icon.length > 2 && !node.icon.includes(' ') ? (
                                        <i className={`fa fa-${node.icon}`}></i>
                                    ) : (
                                        <span className="text-4xl">{node.icon || '📦'}</span>
                                    )}
                                </div>
                                <div className={cn(
                                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                                    online ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                                )}>
                                    <i className={cn("fa fa-circle mr-1.5 text-[8px]", online ? "animate-pulse" : "")}></i>
                                    {node.status || "Offline"}
                                </div>
                            </div>
                            <h3 className="text-lg font-black text-white mb-1 truncate uppercase tracking-tight pointer-events-none">{node.label}</h3>
                            <div className="flex items-center gap-2 pointer-events-none">
                                <span className="text-[10px] text-zinc-500 font-black uppercase bg-white/5 px-2 py-0.5 rounded">{node.type}</span>
                                <span className="text-[10px] text-zinc-600 font-bold">{node.id}</span>
                            </div>
                            
                            <div className="mt-6 h-1.5 bg-white/5 rounded-full overflow-hidden pointer-events-none">
                                <div className={cn("h-full transition-all duration-1000 shadow-[0_0_10px_rgba(99,101,241,0.5)]", online ? "bg-indigo-500 w-[100%]" : "w-0")} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </TransformComponent>
    );
}

export { ServiceMapViewModel };
