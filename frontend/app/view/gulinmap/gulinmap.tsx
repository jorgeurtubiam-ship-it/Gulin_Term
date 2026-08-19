// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

import React, { memo, useRef, useState, useEffect, useCallback, useMemo } from "react";
import { atom, Atom } from "jotai";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import { Markdown } from "@/app/element/markdown";
import { getWebServerEndpoint } from "@/util/endpoints";
import { cn } from "@/util/util";
import "./gulinmap.scss";

export const BASE_URL = getWebServerEndpoint();

export interface DataCatalogChatMessage {
    id: string;
    role: "user" | "map";
    text: string;
    nodes?: string[];
    suggestedFilter?: string;
    timestamp: number;
}

export interface ColumnInfo {
    name: string;
    type: string;
    pii_level?: "none" | "yellow" | "red";
    pii_reason?: string;
}

export interface DataCatalogNode {
    id: string;
    label: string;
    type: string;
    category: "infra" | "data" | "neural" | "aws" | "unknown";
    status: string;
    icon: string;
    status_color?: string;
    description?: string;
    metadata?: any;
    xp_value?: number;
    node_group?: string;
    columns?: ColumnInfo[];
    quality_score?: number;
    row_count?: number;
    x3: number;
    y3: number;
    z3: number;
    px?: number;
    py?: number;
    pz?: number;
    opacity?: number;
}

export interface DataCatalogEdge {
    id: string;
    source: string;
    target: string;
    traffic?: string;
    label?: string;
}

function detectPII(colName: string): { level: "none" | "yellow" | "red"; reason?: string } {
    const lower = colName.toLowerCase();
    if (/rut|dni|ssn|cedula|identidad|pasaporte|credit_card|tarjeta|cvv|password|clave|token|secret/.test(lower)) {
        return { level: "red", reason: "Dato altamente sensible (PII Crítico)" };
    }
    if (/email|correo|phone|telefono|celular|direccion|address|nombre|name|apellido|birth|nacimiento/.test(lower)) {
        return { level: "yellow", reason: "Dato personal identificable (PII Moderado)" };
    }
    return { level: "none" };
}

const CATEGORY_COLORS: Record<string, string> = {
    data: "#22c55e",
    infra: "#0ea5e9",
    neural: "#a855f7",
    aws: "#f59e0b",
    unknown: "#64748b"
};

const GulinMapViewComponent: React.FC<{ model: GulinMapViewModel; blockId: string }> = ({ model, blockId }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [nodes, setNodes] = useState<DataCatalogNode[]>([]);
    const [edges, setEdges] = useState<DataCatalogEdge[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [showChat, setShowChat] = useState(false);
    const [filter, setFilter] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");

    // 3D Engine State (Matching Brain Architecture)
    const rotation = useRef({ x: 0.5, y: 0.5 });
    const isDragging = useRef(false);
    const lastMouse = useRef({ x: 0, y: 0 });
    const userZoom = useRef(1.0);
    const nodes3d = useRef<DataCatalogNode[]>([]);

    // Chat State
    const [chatInput, setChatInput] = useState("");
    const [chatMessages, setChatMessages] = useState<DataCatalogChatMessage[]>([
        {
            id: "init-1",
            role: "map",
            text: "🌐 **Data Catalog & Infra Assistant Activo**.\nPuedes preguntarme por recursos cloud (AWS), tablas con PII (Ley 21719), servidores o seleccionar cualquier nodo del mapa 3D para analizarlo.",
            timestamp: Date.now(),
        }
    ]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    const chatMessagesContainerRef = useRef<HTMLDivElement>(null);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`${BASE_URL}/gulin/brain/data`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            const rawNodes: any[] = data.nodes || [];
            const rawEdges: any[] = data.edges || [];

            const nodeCount = rawNodes.length;
            const mappedNodes: DataCatalogNode[] = rawNodes.map((n, i) => {
                let category: "infra" | "data" | "neural" | "aws" | "unknown" = "infra";
                const typeStr = (n.type || "").toLowerCase();
                if (typeStr.includes("db") || typeStr.includes("postgres") || typeStr.includes("mysql") || typeStr.includes("mongo") || typeStr.includes("redis") || typeStr.includes("sql") || typeStr.includes("data") || typeStr.includes("oracle") || typeStr.includes("sqlite")) {
                    category = "data";
                } else if (typeStr.includes("brain") || typeStr.includes("neural") || typeStr.includes("memory") || typeStr.includes("core") || typeStr.includes("skill") || typeStr.includes("agent")) {
                    category = "neural";
                } else if (typeStr.includes("aws") || typeStr.includes("s3") || typeStr.includes("ec2") || typeStr.includes("lambda") || typeStr.includes("cloud")) {
                    category = "aws";
                }

                // Radius mapping
                let radius = 600;
                if (category === "neural") radius = 350;
                else if (category === "data") radius = 550;
                else if (category === "aws") radius = 750;
                else radius = 650;

                const phi = Math.acos(-1 + (2 * i) / (nodeCount || 1));
                const theta = Math.sqrt(nodeCount * Math.PI) * phi;

                // Extract or generate columns for data nodes
                let cols: ColumnInfo[] = [];
                if (n.description && n.description.trim().startsWith("{")) {
                    try {
                        const parsed = JSON.parse(n.description);
                        if (parsed.columns && Array.isArray(parsed.columns)) {
                            cols = parsed.columns.map((c: any) => {
                                const pii = detectPII(c.name || c.column_name || "");
                                return {
                                    name: c.name || c.column_name || "col",
                                    type: c.type || c.data_type || "text",
                                    pii_level: pii.level,
                                    pii_reason: pii.reason,
                                };
                            });
                        }
                    } catch {}
                }

                const piiCount = cols.filter(c => c.pii_level === "red").length;
                const qualityScore = cols.length > 0 ? Math.max(20, 100 - piiCount * 25) : 95;

                return {
                    id: n.id,
                    label: n.label || n.id,
                    type: n.type || "generic",
                    category,
                    status: n.status || "online",
                    icon: n.icon || (category === "data" ? "🗄️" : category === "neural" ? "🧠" : category === "aws" ? "☁️" : "⚙️"),
                    status_color: n.status_color || CATEGORY_COLORS[category],
                    description: n.description,
                    metadata: n.metadata,
                    xp_value: n.xp_value,
                    node_group: n.node_group,
                    columns: cols,
                    quality_score: qualityScore,
                    row_count: n.metadata?.row_count,
                    x3: radius * Math.cos(theta) * Math.sin(phi),
                    y3: radius * Math.sin(theta) * Math.sin(phi),
                    z3: radius * Math.cos(phi),
                };
            });

            const mappedEdges: DataCatalogEdge[] = rawEdges.map((e: any, i: number) => ({
                id: `e-${i}`,
                source: e.source || e.from,
                target: e.target || e.to,
                traffic: e.traffic,
                label: e.label,
            }));

            nodes3d.current = mappedNodes;
            setNodes(mappedNodes);
            setEdges(mappedEdges);
            setLoading(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Canvas 3D Animation Loop
    useEffect(() => {
        if (!canvasRef.current || loading) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const resizeCanvas = () => {
            const container = canvas.parentElement;
            if (!container) return;
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
        };

        const resizeObserver = new ResizeObserver(() => {
            resizeCanvas();
        });
        if (canvas.parentElement) {
            resizeObserver.observe(canvas.parentElement);
        }
        resizeCanvas();

        let frameId: number;
        const render = () => {
            const w = canvas.width;
            const h = canvas.height;
            ctx.fillStyle = "#020617";
            ctx.fillRect(0, 0, w, h);

            // Stars Background
            ctx.fillStyle = "#ffffff";
            for (let i = 0; i < 80; i++) {
                const sx = (Math.sin(i * 1234.5) * 0.5 + 0.5) * w;
                const sy = (Math.cos(i * 5678.9) * 0.5 + 0.5) * h;
                const size = (Math.sin(Date.now() / 1200 + i) * 0.5 + 0.5) * 1.3;
                ctx.beginPath();
                ctx.arc(sx, sy, size, 0, Math.PI * 2);
                ctx.fill();
            }

            const centerX = w / 2;
            const centerY = h / 2;
            const zoom = (Math.min(w, h) / 1000) * userZoom.current;

            const cosX = Math.cos(rotation.current.x);
            const sinX = Math.sin(rotation.current.x);
            const cosY = Math.cos(rotation.current.y);
            const sinY = Math.sin(rotation.current.y);

            // Project 3D Nodes
            nodes3d.current.forEach(n => {
                let x = n.x3 * cosY - n.z3 * sinY;
                let z = n.x3 * sinY + n.z3 * cosY;
                let y = n.y3 * cosX - z * sinX;
                z = n.y3 * sinX + z * cosX;

                n.px = centerX + x * zoom;
                n.py = centerY + y * zoom;
                n.pz = z;

                const matchesFilter = filter === "all" || n.category === filter;
                const matchesSearch = !searchQuery || n.label.toLowerCase().includes(searchQuery.toLowerCase()) || n.type.toLowerCase().includes(searchQuery.toLowerCase());
                
                if (!matchesFilter || !matchesSearch) {
                    n.opacity = 0.04;
                } else {
                    n.opacity = Math.max(0.15, (z + 600) / 1200);
                }
            });

            // Depth sorting
            const sortedNodes = [...nodes3d.current].sort((a, b) => (a.pz || 0) - (b.pz || 0));
            const nodeMap = new Map(nodes3d.current.map(n => [n.id, n]));

            // Draw Edges
            edges.forEach(edge => {
                const src = nodeMap.get(edge.source);
                const tgt = nodeMap.get(edge.target);
                if (!src || !tgt) return;

                const opacity = Math.min(src.opacity || 0, tgt.opacity || 0) * 0.4;
                ctx.beginPath();
                ctx.moveTo(src.px!, src.py!);

                const cp1x = src.px! + (tgt.px! - src.px!) * 0.2;
                const cp1y = src.py! + (tgt.py! - src.py!) * 0.8;
                ctx.quadraticCurveTo(cp1x, cp1y, tgt.px!, tgt.py!);

                ctx.strokeStyle = edge.traffic ? `rgba(168, 85, 247, ${opacity * 1.6})` : `rgba(51, 65, 85, ${opacity})`;
                ctx.lineWidth = edge.traffic ? 2 : 1;
                ctx.stroke();
            });

            // Draw Nodes
            sortedNodes.forEach(n => {
                const isSelected = selectedNodeId === n.id;
                const baseSize = n.category === "data" ? 12 : 9;
                const size = baseSize * (1 + (n.pz || 0) / 1000) * zoom * 1.8;

                // Selection glow
                if (isSelected) {
                    ctx.beginPath();
                    const glowSize = size * 2.5;
                    ctx.arc(n.px!, n.py!, glowSize, 0, Math.PI * 2);
                    const gradient = ctx.createRadialGradient(n.px!, n.py!, 0, n.px!, n.py!, glowSize);
                    gradient.addColorStop(0, "rgba(168, 85, 247, 0.4)");
                    gradient.addColorStop(1, "rgba(168, 85, 247, 0)");
                    ctx.fillStyle = gradient;
                    ctx.fill();
                }

                // Node Circle
                ctx.beginPath();
                ctx.arc(n.px!, n.py!, size, 0, Math.PI * 2);
                ctx.fillStyle = isSelected ? "#a855f7" : CATEGORY_COLORS[n.category] || "#64748b";
                ctx.globalAlpha = n.opacity || 1;
                ctx.fill();
                ctx.strokeStyle = isSelected ? "#ffffff" : `rgba(255, 255, 255, ${(n.opacity || 0.5) * 0.3})`;
                ctx.lineWidth = isSelected ? 2 : 1;
                ctx.stroke();

                // Labels for nodes in front
                if ((n.pz || 0) > -200 && (n.opacity || 0) > 0.1) {
                    ctx.fillStyle = "#e2e8f0";
                    ctx.font = `${Math.round(11 * zoom * 1.4)}px Inter, sans-serif`;
                    ctx.textAlign = "center";
                    ctx.fillText(n.label.length > 20 ? n.label.slice(0, 18) + "…" : n.label, n.px!, n.py! + size + 14);

                    ctx.font = `${Math.round(14 * zoom * 1.4)}px Arial`;
                    ctx.fillText(n.icon || "⚙️", n.px!, n.py! + 5);
                }
                ctx.globalAlpha = 1;
            });

            frameId = requestAnimationFrame(render);
        };

        render();
        return () => {
            cancelAnimationFrame(frameId);
            resizeObserver.disconnect();
        };
    }, [loading, edges, filter, searchQuery, selectedNodeId]);

    // Mouse Interaction Handlers
    const handleMouseDown = (e: React.MouseEvent) => {
        isDragging.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging.current) return;
        rotation.current.y += (e.clientX - lastMouse.current.x) * 0.005;
        rotation.current.x += (e.clientY - lastMouse.current.y) * 0.005;
        lastMouse.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
        isDragging.current = false;
    };

    const handleWheel = (e: React.WheelEvent) => {
        userZoom.current = Math.max(0.3, Math.min(userZoom.current - e.deltaY * 0.001, 5));
    };

    const handleClick = (e: React.MouseEvent) => {
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        let closest: DataCatalogNode | null = null;
        let minDist = 30;

        nodes3d.current.forEach(n => {
            if (n.px === undefined || n.py === undefined) return;
            const d = Math.hypot(n.px - mx, n.py - my);
            if (d < minDist) {
                minDist = d;
                closest = n;
            }
        });

        setSelectedNodeId(closest ? closest.id : null);
    };

    const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;

    const handleChatSend = async (customQuery?: string) => {
        const queryText = (customQuery !== undefined ? customQuery : chatInput).trim();
        if (!queryText || isChatLoading) return;

        const userMsg: DataCatalogChatMessage = {
            id: `msg-${Date.now()}-user`,
            role: "user",
            text: queryText,
            timestamp: Date.now()
        };

        setChatMessages(prev => [...prev, userMsg]);
        if (customQuery === undefined) {
            setChatInput("");
        }
        setIsChatLoading(true);

        try {
            const res = await fetch(`${BASE_URL}/gulin/brain/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: queryText,
                    selected_node_id: selectedNode ? selectedNode.id : "",
                    filter: filter
                })
            });

            if (res.ok) {
                const data = await res.json();
                const mapMsg: DataCatalogChatMessage = {
                    id: `msg-${Date.now()}-map`,
                    role: "map",
                    text: data.reply || "Respuesta recibida del asistente.",
                    nodes: data.nodes || [],
                    suggestedFilter: data.suggested_filter,
                    timestamp: Date.now()
                };
                setChatMessages(prev => [...prev, mapMsg]);

                if (data.suggested_filter && ["all", "data", "infra", "neural", "aws"].includes(data.suggested_filter)) {
                    setFilter(data.suggested_filter);
                }
                if (data.focused_node && nodes.some(n => n.id === data.focused_node)) {
                    setSelectedNodeId(data.focused_node);
                }
            } else {
                throw new Error("HTTP " + res.status);
            }
        } catch {
            setChatMessages(prev => [
                ...prev,
                {
                    id: `msg-${Date.now()}-err`,
                    role: "map",
                    text: "⚠️ No se pudo obtener respuesta del backend. Verifica que el servidor de GuLiN esté activo.",
                    timestamp: Date.now()
                }
            ]);
        } finally {
            setIsChatLoading(false);
        }
    };

    const handleClearChat = () => {
        setChatMessages([
            {
                id: "init-reset",
                role: "map",
                text: "🌐 **Chat reiniciado**. Selecciona un nodo o escribe tu consulta sobre la topología y datos.",
                timestamp: Date.now()
            }
        ]);
    };

    useEffect(() => {
        if (showChat && chatMessagesContainerRef.current) {
            chatMessagesContainerRef.current.scrollTop = chatMessagesContainerRef.current.scrollHeight;
        }
    }, [chatMessages, isChatLoading, showChat]);

    const suggestions = useMemo(() => {
        if (selectedNode) {
            return [
                { label: `🔍 Diagnóstico de ${selectedNode.label}`, prompt: `Diagnóstico y estado técnico de ${selectedNode.label}` },
                { label: `🔗 Ver conexiones`, prompt: `¿Cuáles son las conexiones y dependencias de ${selectedNode.label}?` },
                ...(selectedNode.category === "data" ? [{ label: `🛡️ PII & Esquema`, prompt: `Analiza las columnas y nivel PII de ${selectedNode.label}` }] : []),
                ...(selectedNode.category === "aws" ? [{ label: `☁️ Configuración AWS`, prompt: `Muestra la configuración y comandos AWS para ${selectedNode.label}` }] : [])
            ];
        }
        return [
            { label: "☁️ Todo AWS", prompt: "Muéstrame todo lo AWS" },
            { label: "🗄️ Auditoría PII & DB", prompt: "¿Cuáles son las tablas con datos PII (Ley 21719)?" },
            { label: "⚠️ Nodos Caídos", prompt: "¿Qué servidores o instancias están caídas?" },
            { label: "📊 Resumen Catálogo", prompt: "Dame un resumen del catálogo de datos e infraestructura" },
            { label: "⚙️ Servidores", prompt: "Muéstrame los servidores e infraestructura de red" },
            { label: "🧠 Neural & Agentes", prompt: "Muéstrame los agentes y memoria neural" }
        ];
    }, [selectedNode]);

    return (
        <div className="gmap-container">
            {loading && (
                <div className="gmap-loading">
                    <div className="gmap-spinner" />
                    <span>Cargando catálogo de datos y mapa 3D...</span>
                </div>
            )}
            {error && <div className="gmap-error">❌ Error: {error}</div>}

            {!loading && !error && (
                <>
                    {/* Floating Header */}
                    <div className="gmap-floating-header">
                        <div className="header-glass">
                            <div className="gmap-header-left">
                                <span className="gmap-logo">🌐</span>
                                <div>
                                    <h2>Data Catalog</h2>
                                    <span className="gmap-subtitle">Infra · Datos · Neural</span>
                                </div>
                            </div>

                            <div className="gmap-header-center">
                                <div className="gmap-filters">
                                    {[
                                        { id: "all", label: "Todos", color: "#a855f7" },
                                        { id: "data", label: "Bases de Datos", color: "#22c55e" },
                                        { id: "infra", label: "Servidores", color: "#0ea5e9" },
                                        { id: "neural", label: "Neural AI", color: "#a855f7" },
                                        { id: "aws", label: "Cloud AWS", color: "#f59e0b" },
                                    ].map(f => (
                                        <button
                                            key={f.id}
                                            className={cn("gmap-filter-btn", { active: filter === f.id })}
                                            style={{ "--cat-color": f.color } as any}
                                            onClick={() => setFilter(f.id)}
                                        >
                                            {f.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="gmap-header-right">
                                <div className="gmap-search">
                                    <input
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        placeholder="Buscar tablas, schemas, nodos..."
                                    />
                                </div>
                                <button className="gmap-refresh-btn" onClick={loadData} title="Recargar catálogo">
                                    🔄
                                </button>
                                <button className="gmap-chat-toggle" onClick={() => setShowChat(!showChat)}>
                                    💬 Chat {showChat ? "▲" : "▼"}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Floating Stats */}
                    <div className="gmap-floating-stats">
                        <div className="gmap-stat">📦 {nodes.length} Nodos Totales</div>
                        <div className="gmap-stat" style={{ color: "#22c55e" }}>🗄️ {nodes.filter(n => n.category === "data").length} Datos / DB</div>
                        <div className="gmap-stat" style={{ color: "#0ea5e9" }}>⚙️ {nodes.filter(n => n.category === "infra").length} Infraestructura</div>
                        <div className="gmap-stat" style={{ color: "#a855f7" }}>🧠 {nodes.filter(n => n.category === "neural").length} Agentes / Memoria</div>
                    </div>

                    {/* 3D Canvas Map View */}
                    <div className="gmap-content-area">
                        <div className="gmap-map">
                            <canvas
                                ref={canvasRef}
                                className="gmap-canvas"
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseUp}
                                onWheel={handleWheel}
                                onClick={handleClick}
                            />

                            {/* Node Detail Drawer */}
                            {selectedNode && (
                                <div className="gmap-node-detail">
                                    <div className="detail-header">
                                        <span className="detail-icon">{selectedNode.icon}</span>
                                        <div>
                                            <h3>{selectedNode.label}</h3>
                                            <span className="detail-type">{selectedNode.type} · {selectedNode.category}</span>
                                        </div>
                                        <button className="close-btn" onClick={() => setSelectedNodeId(null)}>✕</button>
                                    </div>

                                    <div className="detail-body">
                                        <div className="meta-row">
                                            <span>Estado:</span>
                                            <span className="status-badge" style={{ color: CATEGORY_COLORS[selectedNode.category] }}>
                                                {selectedNode.status}
                                            </span>
                                        </div>

                                        {selectedNode.quality_score !== undefined && (
                                            <div className="meta-row">
                                                <span>Calidad de Datos:</span>
                                                <span style={{ fontWeight: 700, color: selectedNode.quality_score > 70 ? "#22c55e" : "#f59e0b" }}>
                                                    {selectedNode.quality_score}%
                                                </span>
                                            </div>
                                        )}

                                        {selectedNode.columns && selectedNode.columns.length > 0 && (
                                            <div className="columns-section">
                                                <h4>Columnas & Esquema PII ({selectedNode.columns.length})</h4>
                                                <div className="columns-list">
                                                    {selectedNode.columns.map((col, idx) => (
                                                        <div key={idx} className="column-item">
                                                            <span className="col-name">{col.name}</span>
                                                            <span className="col-type">{col.type}</span>
                                                            {col.pii_level === "red" && <span className="pii-badge red">🔴 PII</span>}
                                                            {col.pii_level === "yellow" && <span className="pii-badge yellow">🟡 PII</span>}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {selectedNode.description && (
                                            <div className="desc-section">
                                                <h4>Descripción / Configuración</h4>
                                                <pre>{selectedNode.description}</pre>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="gmap-hint">Arrastra para rotar la esfera 3D • Scroll para zoom • Clic en nodo para detalles</div>
                        </div>
                    </div>

                    {/* Chat Drawer Overlay */}
                    {showChat && (
                        <div className="gmap-chat">
                            <div className="gmap-chat-header">
                                <div className="header-title">
                                    <span>🌐 Catálogo AI Chat</span>
                                    <span className="chat-badge">{nodes.length} Nodos</span>
                                </div>
                                <div className="header-actions">
                                    <button onClick={handleClearChat} className="chat-action-btn" title="Limpiar historial">🗑️</button>
                                    <button onClick={() => setShowChat(false)} className="close-btn" title="Cerrar chat">✕</button>
                                </div>
                            </div>

                            {/* Active Node Context Chip */}
                            {selectedNode && (
                                <div className="gmap-chat-context-bar">
                                    <span className="context-label">📍 Contexto:</span>
                                    <span className="context-tag" onClick={() => setSelectedNodeId(selectedNode.id)}>
                                        {selectedNode.icon} <strong>{selectedNode.label}</strong> ({selectedNode.type})
                                    </span>
                                    <button className="context-clear" onClick={() => setSelectedNodeId(null)} title="Desvincular nodo">✕</button>
                                </div>
                            )}

                            {/* Quick Suggestion Pills */}
                            <div className="gmap-chat-suggestions">
                                {suggestions.map((s, idx) => (
                                    <button
                                        key={idx}
                                        className="suggestion-pill"
                                        onClick={() => handleChatSend(s.prompt)}
                                        disabled={isChatLoading}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>

                            <div className="gmap-chat-messages" ref={chatMessagesContainerRef}>
                                {chatMessages.map(m => (
                                    <div key={m.id} className={cn("gmap-chat-msg", `msg-${m.role}`)}>
                                        <div className="msg-sender">
                                            {m.role === "user" ? "👤 Tú" : "🌐 Catálogo AI"}
                                        </div>
                                        <div className="msg-content">
                                            <Markdown text={m.text} />
                                        </div>

                                        {/* Clickable Node Badges */}
                                        {m.nodes && m.nodes.length > 0 && (
                                            <div className="gmap-chat-node-chips">
                                                <span className="chips-title">Nodos relacionados:</span>
                                                {m.nodes.slice(0, 6).map(nId => {
                                                    const nodeObj = nodes.find(n => n.id === nId);
                                                    if (!nodeObj) return null;
                                                    return (
                                                        <button
                                                            key={nId}
                                                            className={cn("gmap-chat-chip", { active: selectedNodeId === nId })}
                                                            onClick={() => setSelectedNodeId(nId)}
                                                            title={`Enfocar ${nodeObj.label} en el mapa 3D`}
                                                        >
                                                            {nodeObj.icon} {nodeObj.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {/* Suggested Filter Action */}
                                        {m.suggestedFilter && m.suggestedFilter !== filter && (
                                            <div className="gmap-chat-filter-action">
                                                <button
                                                    onClick={() => setFilter(m.suggestedFilter!)}
                                                    className="filter-apply-btn"
                                                >
                                                    🎯 Filtrar vista por: <strong>{m.suggestedFilter.toUpperCase()}</strong>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {isChatLoading && (
                                    <div className="gmap-chat-msg msg-map gmap-chat-thinking">
                                        <div className="msg-sender">🌐 Catálogo AI</div>
                                        <div className="thinking-dots">
                                            <span className="dot" />
                                            <span className="dot" />
                                            <span className="dot" />
                                            <span className="thinking-text">Analizando topología y datos...</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="gmap-chat-input">
                                <input
                                    value={chatInput}
                                    onChange={e => setChatInput(e.target.value)}
                                    onKeyDown={e => e.key === "Enter" && handleChatSend()}
                                    placeholder={selectedNode ? `Pregunta sobre ${selectedNode.label}...` : "Pregunta sobre AWS, tablas, PII, servidores..."}
                                    disabled={isChatLoading}
                                />
                                <button onClick={() => handleChatSend()} disabled={isChatLoading || !chatInput.trim()}>
                                    {isChatLoading ? "..." : "→"}
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export const GulinMapView = memo(GulinMapViewComponent);

export class GulinMapViewModel implements ViewModel {
    viewType: string;
    viewComponent = GulinMapView;
    viewIcon: Atom<string>;
    viewName: Atom<string>;
    viewText: Atom<string>;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "gulin-map";

        this.viewIcon = atom(() => "diagram-project");
        this.viewName = atom(() => "Data Catalog");
        this.viewText = atom(() => "Catálogo de Datos & Mapa 3D Unificado");
    }

    dispose() {}
}
