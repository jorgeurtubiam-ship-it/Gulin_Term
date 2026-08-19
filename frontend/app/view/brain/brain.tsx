// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { memo, useRef, useState, useEffect, useCallback, useMemo } from "react";
import { useAtomValue } from "jotai";
import { ErrorBoundary } from "@/element/errorboundary";
import { getGulinObjectAtom, makeORef } from "@/store/wos";
import { cn } from "@/util/util";
import { BrainViewModel, BRAIN_BASE_URL, BrainDataResponse, XPStatsResponse, NodeData, EdgeData } from "./brain-model";
import "./brain.scss";

interface Position { x: number; y: number; }

const INFRA_TYPES: Record<string, { icon: string; color: string }> = {
    "docker-app": { icon: "🐳", color: "#0ea5e9" },
    "docker-db": { icon: "🐘", color: "#22c55e" },
    "aws-ec2": { icon: "☁️", color: "#f59e0b" },
    "generic": { icon: "⚙️", color: "#6366f1" },
};

function fetchJson<T>(url: string): Promise<T> {
    return fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
}

const BrainNode: React.FC<{ node: NodeData; selected: string | null; onSelect: (id: string) => void }> = ({ node, selected, onSelect }) => {
    const typeDef = INFRA_TYPES[node.type] || INFRA_TYPES["generic"];
    const isSelected = selected === node.id;

    return (
        <div
            className={cn("brain-node", { "brain-node-selected": isSelected })}
            style={{
                left: node.x || 0,
                top: node.y || 0,
                borderColor: isSelected ? "#a855f7" : node.status_color || typeDef.color,
            }}
            onClick={() => onSelect(node.id)}
            title={`${node.label} (${node.type}) - ${node.status}`}
        >
            <span className="brain-node-icon">{node.icon || typeDef.icon}</span>
            <span className="brain-node-label">{node.label}</span>
            <span className={cn("brain-node-status", `status-${node.status}`)} />
        </div>
    );
};

const BrainEdge: React.FC<{ edge: EdgeData; nodes: Map<string, NodeData> }> = ({ edge, nodes }) => {
    const src = nodes.get(edge.source);
    const tgt = nodes.get(edge.target);
    if (!src || !tgt) return null;

    const x1 = (src.x || 0) + 60;
    const y1 = (src.y || 0) + 24;
    const x2 = (tgt.x || 0) + 60;
    const y2 = (tgt.y || 0) + 24;

    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2 - 20;

    return (
        <svg className="brain-edge-svg" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }}>
            <path
                d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`}
                fill="none"
                stroke={edge.traffic ? "#a855f7" : "#334155"}
                strokeWidth={edge.traffic ? 2 : 1}
                strokeDasharray={edge.traffic ? "none" : "5,5"}
                opacity={0.6}
            />
            {edge.traffic ? <text x={(x1 + x2) / 2 - 10} y={(y1 + y2) / 2 - 30} fill="#a855f7" fontSize={10}>{edge.traffic}</text> : null}
        </svg>
    );
};

const BrainChat: React.FC<{ onClose: () => void; xp: number; level: number }> = ({ onClose, xp, level }) => {
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<{ role: string; text: string }[]>([
        { role: "brain", text: `🧠 Hola. Mi nivel es ${level} (${xp} XP). ¿Qué quieres saber de tu infraestructura?` }
    ]);

    const handleSend = async () => {
        if (!input.trim()) return;
        const userMsg = input;
        setMessages(prev => [...prev, { role: "user", text: userMsg }]);
        setInput("");
        
        // Indicador de carga
        setMessages(prev => [...prev, { role: "brain", text: "..." }]);

        try {
            // Llamada al backend real (endpoint sugerido)
            const res = await fetch(`${BRAIN_BASE_URL}/gulin/brain/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: userMsg })
            });
            
            if (res.ok) {
                const data = await res.json();
                setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = { role: "brain", text: data.reply || "Conectado al agente, pero sin respuesta textual." };
                    return newMessages;
                });
            } else {
                throw new Error(`HTTP ${res.status}`);
            }
        } catch (err) {
            setMessages(prev => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = { role: "brain", text: `[Aviso] El backend de IA (/gulin/brain/chat) no está implementado o accesible aún. (Simulando respuesta para: "${userMsg}")` };
                return newMessages;
            });
        }
    };

    return (
        <div className="brain-chat">
            <div className="brain-chat-header">
                <span>🧠 Brain Chat</span>
                <button onClick={onClose} className="brain-chat-close">✕</button>
            </div>
            <div className="brain-chat-messages">
                {messages.map((m, i) => (
                    <div key={i} className={cn("brain-chat-msg", `msg-${m.role}`)}>{m.text}</div>
                ))}
            </div>
            <div className="brain-chat-input">
                <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSend()} placeholder="Pregunta sobre tu infra..." />
                <button onClick={handleSend}>→</button>
            </div>
        </div>
    );
};

const BrainViewComponent: React.FC<{ model: BrainViewModel; blockId: string }> = ({ model, blockId }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [brainData, setBrainData] = useState<BrainDataResponse | null>(null);
    const [xpStats, setXpStats] = useState<XPStatsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [showChat, setShowChat] = useState(false);
    const [view, setView] = useState<"map" | "table">("map");
    const [typeFilter, setTypeFilter] = useState<string>("all");

    // 3D Engine State
    const rotation = useRef({ x: 0.5, y: 0.5 });
    const isDragging = useRef(false);
    const lastMouse = useRef({ x: 0, y: 0 });
    const userZoom = useRef(1.0);
    const nodes3d = useRef<(NodeData & { x3: number; y3: number; z3: number; px?: number; py?: number; pz?: number; opacity?: number })[]>([]);
    const signals = useRef<{ from: string; to: string; progress: number; speed: number }[]>([]);

    const refreshData = useCallback(async () => {
        try {
            const data = await fetchJson<BrainDataResponse>(`${BRAIN_BASE_URL}/gulin/brain/data`);
            setBrainData(data);
            
            // Update 3D positions
            const processedNodes = (data?.nodes || []).map((n, i) => {
                let radius = 600;
                if (n.type === 'core') radius = 0;
                else if (n.type === 'skill' || n.type === 'plugin') radius = 300;
                else if (n.type.includes('memory') || n.type === 'episodic' || n.type === 'semantic') radius = 500;
                else radius = 800;

                const nodeCount = (data?.nodes || []).length;
                const phi = Math.acos(-1 + (2 * i) / nodeCount);
                const theta = Math.sqrt(nodeCount * Math.PI) * phi;
                
                return {
                    ...n,
                    x3: radius * Math.cos(theta) * Math.sin(phi),
                    y3: radius * Math.sin(theta) * Math.sin(phi),
                    z3: radius * Math.cos(phi)
                };
            });
            nodes3d.current = processedNodes;
            setLoading(false);
            
            fetchJson<XPStatsResponse>(`${BRAIN_BASE_URL}/gulin/brain/stats`).then(stats => setXpStats(stats)).catch(() => {});
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshData();
        
        const es = new EventSource(`${BRAIN_BASE_URL}/gulin/brain/events`);
        es.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'infra_update' || msg.type === 'xp_update') {
                    refreshData();
                }
            } catch (e) {}
        };
        
        return () => {
            es.close();
        };
    }, [refreshData]);

    // Animation Loop
    useEffect(() => {
        if (view !== "map" || !canvasRef.current || loading) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
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
            ctx.fillStyle = '#020617';
            ctx.fillRect(0, 0, w, h);

            // Draw simple stars
            ctx.fillStyle = '#ffffff';
            for (let i = 0; i < 100; i++) {
                const sx = (Math.sin(i * 1234.5) * 0.5 + 0.5) * w;
                const sy = (Math.cos(i * 5678.9) * 0.5 + 0.5) * h;
                const size = (Math.sin(Date.now() / 1000 + i) * 0.5 + 0.5) * 1.5;
                ctx.beginPath();
                ctx.arc(sx, sy, size, 0, Math.PI * 2);
                ctx.fill();
            }
            
            const centerX = w / 2;
            const centerY = h / 2;
            const zoom = (Math.min(w, h) / 1000) * userZoom.current;

            // Update rotation
            if (!isDragging.current) {
                // rotation.current.y += 0.002; // Desactivado para que no se mueva solo
            }

            const cosX = Math.cos(rotation.current.x);
            const sinX = Math.sin(rotation.current.x);
            const cosY = Math.cos(rotation.current.y);
            const sinY = Math.sin(rotation.current.y);

            // Project nodes
            nodes3d.current.forEach(n => {
                // Rotation Y
                let x = n.x3 * cosY - n.z3 * sinY;
                let z = n.x3 * sinY + n.z3 * cosY;
                // Rotation X
                let y = n.y3 * cosX - z * sinX;
                z = n.y3 * sinX + z * cosX;

                n.px = centerX + x * zoom;
                n.py = centerY + y * zoom;
                n.pz = z;
                n.opacity = Math.max(0.1, (z + 500) / 1000);
                if (typeFilter !== 'all' && !n.type.includes(typeFilter)) {
                    n.opacity = 0.02; // Filtro: Atenuar nodos que no coinciden
                }
            });

            // Sort by depth for correct drawing
            const sortedNodes = [...nodes3d.current].sort((a, b) => (a.pz || 0) - (b.pz || 0));
            const nodeMap = new Map(nodes3d.current.map(n => [n.id, n]));

            // Draw Edges
            brainData?.edges.forEach(edge => {
                const src = nodeMap.get(edge.source);
                const tgt = nodeMap.get(edge.target);
                if (!src || !tgt) return;

                const opacity = Math.min(src.opacity || 0, tgt.opacity || 0) * 0.4;
                ctx.beginPath();
                ctx.moveTo(src.px!, src.py!);
                
                // Bezier curve for organic look
                const cp1x = src.px! + (tgt.px! - src.px!) * 0.2;
                const cp1y = src.py! + (tgt.py! - src.py!) * 0.8;
                ctx.quadraticCurveTo(cp1x, cp1y, tgt.px!, tgt.py!);
                
                ctx.strokeStyle = edge.traffic ? `rgba(168, 85, 247, ${opacity * 1.5})` : `rgba(51, 65, 85, ${opacity})`;
                ctx.lineWidth = edge.traffic ? 2 : 1;
                if (!edge.traffic) ctx.setLineDash([5, 5]);
                ctx.stroke();
                ctx.setLineDash([]);
            });

            // Draw Nodes
            sortedNodes.forEach(n => {
                const size = (n.type === 'core' ? 12 : 8) * (1 + (n.pz || 0) / 1000) * zoom * 2;
                const isSelected = selectedNode === n.id;
                const pulse = (n as any).pulse || 0;
                
                // Outer glow / Pulse
                if (isSelected || pulse > 0) {
                    ctx.beginPath();
                    const glowSize = size * (isSelected ? 2.5 : (1 + pulse * 2));
                    ctx.arc(n.px!, n.py!, glowSize, 0, Math.PI * 2);
                    const gradient = ctx.createRadialGradient(n.px!, n.py!, 0, n.px!, n.py!, glowSize);
                    const alpha = isSelected ? 0.4 : pulse * 0.5;
                    gradient.addColorStop(0, `rgba(168, 85, 247, ${alpha})`);
                    gradient.addColorStop(1, 'rgba(168, 85, 247, 0)');
                    ctx.fillStyle = gradient;
                    ctx.fill();
                    if (pulse > 0) (n as any).pulse -= 0.02; // Decay pulse
                }

                // Node Body
                ctx.beginPath();
                ctx.arc(n.px!, n.py!, size, 0, Math.PI * 2);
                ctx.fillStyle = isSelected ? '#a855f7' : (n.status_color || '#334155');
                ctx.globalAlpha = n.opacity || 1;
                ctx.fill();
                
                // Label for near nodes
                if ((n.pz || 0) > -100) {
                    ctx.fillStyle = '#e2e8f0';
                    ctx.font = `${Math.round(10 * zoom * 1.5)}px Inter`;
                    ctx.textAlign = 'center';
                    ctx.fillText(n.label, n.px!, n.py! + size + 15);
                    ctx.font = `${Math.round(16 * zoom * 1.5)}px Arial`;
                    ctx.fillText(n.icon || '⚙️', n.px!, n.py! + 5);
                }
                ctx.globalAlpha = 1;
            });

            // Draw Signals
            if (Math.random() < 0.05 && brainData?.edges.length) {
                const edge = brainData.edges[Math.floor(Math.random() * brainData.edges.length)];
                signals.current.push({ from: edge.source, to: edge.target, progress: 0, speed: 0.01 + Math.random() * 0.02 });
            }

            signals.current.forEach((s, idx) => {
                const src = nodeMap.get(s.from);
                const tgt = nodeMap.get(s.to);
                if (src && tgt) {
                    const x = src.px! + (tgt.px! - src.px!) * s.progress;
                    const y = src.py! + (tgt.py! - src.py!) * s.progress;
                    ctx.beginPath();
                    ctx.arc(x, y, 2 * zoom, 0, Math.PI * 2);
                    ctx.fillStyle = '#fff';
                    ctx.fill();
                    s.progress += s.speed;
                }
                if (s.progress >= 1) signals.current.splice(idx, 1);
            });

            frameId = requestAnimationFrame(render);
        };

        render();
        return () => {
            cancelAnimationFrame(frameId);
            resizeObserver.disconnect();
        };
    }, [view, brainData, selectedNode, loading]);

    const handleMouseDown = (e: React.MouseEvent) => {
        isDragging.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging.current) return;
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        rotation.current.y += dx * 0.01;
        rotation.current.x += dy * 0.01;
        lastMouse.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
        isDragging.current = false;
    };

    const handleWheel = (e: React.WheelEvent) => {
        // deltaY > 0 means scroll down (zoom out), deltaY < 0 means scroll up (zoom in)
        const zoomSpeed = 0.002;
        userZoom.current -= e.deltaY * zoomSpeed;
        // Limit the zoom range to avoid extreme values
        userZoom.current = Math.max(0.1, Math.min(userZoom.current, 10.0));
    };

    const handleClick = (e: React.MouseEvent) => {
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Find closest node
        let closest: string | null = null;
        let minDist = 30;
        nodes3d.current.forEach(n => {
            if (n.px === undefined || n.py === undefined) return;
            const d = Math.sqrt((n.px - mouseX)**2 + (n.py - mouseY)**2);
            if (d < minDist) {
                minDist = d;
                closest = n.id;
            }
        });
        setSelectedNode(closest);
    };

    const addXP = useCallback(async (action: string, xp_gained?: number) => {
        try {
            const res = await fetch(`${BRAIN_BASE_URL}/gulin/brain/xp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, xp_gained: xp_gained || 0, source: 'brain-ui' }),
            });
            if (!res.ok) return;
            const data = await res.json();
            fetchJson<XPStatsResponse>(`${BRAIN_BASE_URL}/gulin/brain/stats`).then(stats => setXpStats(stats)).catch(() => {});
            setBrainData(prev => prev ? { ...prev, total_xp: data.total_xp, level: data.level } : prev);
        } catch {}
    }, []);

    const selectedNodeData = selectedNode ? nodes3d.current.find(n => n.id === selectedNode) : null;

    return (
        <div className="brain-container">
            {loading && <div className="brain-loading"><div className="brain-spinner" /><span>Cargando interfaz neuronal...</span></div>}
            {error && <div className="brain-error">❌ Error: {error}</div>}
            {!loading && !error && !brainData && <div className="brain-error">Sin conexión neuronal</div>}
            
            {brainData && (
                <>
            {/* Floating Header */}
            <div className="brain-floating-header">
                <div className="header-glass">
                    <div className="brain-header-left">
                        <span className="brain-logo">🧠</span>
                        <h2>Neural Brain</h2>
                        <span className="brain-level-badge">Nv.{brainData.level}</span>
                        <div className="xp-bar-container">
                            <div className="xp-bar-fill" style={{ width: `${(brainData.total_xp % 1000) / 10}%` }} />
                            <span className="xp-text">{brainData.total_xp.toLocaleString()} XP</span>
                        </div>
                    </div>
                    <div className="brain-header-right">
                        <button className="refresh-btn" onClick={refreshData} title="Sincronizar con DB">
                            <i className={cn("fa fa-refresh", { "fa-spin": loading })}></i>
                        </button>
                        <select className="brain-filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{background: 'rgba(30, 41, 59, 0.8)', color: '#cbd5e1', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '20px', padding: '6px 12px', fontSize: '12px', marginRight: '8px', backdropFilter: 'blur(8px)', outline: 'none'}}>
                            <option value="all">Filtro: Todos</option>
                            <option value="core">Filtro: Core</option>
                            <option value="aws">Filtro: AWS</option>
                            <option value="docker">Filtro: Docker</option>
                            <option value="memory">Filtro: Memoria</option>
                            <option value="skill">Filtro: Skills</option>
                        </select>
                        <button className={cn("tab-btn", { active: view === "map" })} onClick={() => setView("map")}>Neural</button>
                        <button className={cn("tab-btn", { active: view === "table" })} onClick={() => setView("table")}>Datos</button>
                        <button className="chat-toggle" onClick={() => setShowChat(!showChat)}>Chat</button>
                    </div>
                </div>
            </div>

            {/* Floating Stats */}
            {view === "map" && (
                <div className="brain-floating-stats">
                    <div className="stat-pill">🏗️ {brainData.nodes.length} Nodos</div>
                    <div className="stat-pill">🔗 {brainData.edges.length} Links</div>
                    <div className="stat-pill">💾 {brainData.epistemic.total_memory_nodes} Memorias</div>
                    <div className="stat-pill">📊 {brainData.epistemic.avg_confidence.toFixed(0)}% Confianza</div>
                </div>
            )}

            {/* Main content */}
            <div className="brain-content-area">
                {view === "map" ? (
                    <div className="brain-map">
                        <canvas 
                            ref={canvasRef}
                            className="brain-canvas"
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            onWheel={handleWheel}
                            onClick={handleClick}
                        />
                        {selectedNodeData && (
                            <div className="brain-node-detail animate-in fade-in slide-in-from-right duration-300">
                                <div className="detail-header">
                                    <span className="detail-icon">{selectedNodeData.icon || '⚙️'}</span>
                                    <h3>{selectedNodeData.label}</h3>
                                    <button className="close-btn" onClick={() => setSelectedNode(null)}>✕</button>
                                </div>
                                <div className="brain-node-detail-grid">
                                    <div><strong>Tipo:</strong> <span className="type-tag">{selectedNodeData.type}</span></div>
                                    <div><strong>Estado:</strong> <span className={cn("status-tag", selectedNodeData.status)}>{selectedNodeData.status}</span></div>
                                    <div><strong>Grupo:</strong> {selectedNodeData.node_group || "-"}</div>
                                    <div><strong>XP:</strong> {selectedNodeData.xp_value}</div>
                                    {(selectedNodeData.metadata || selectedNodeData.description) && (
                                        <div className="brain-node-desc">
                                            <strong>Detalles Técnicos:</strong>
                                            {selectedNodeData.metadata && Object.keys(selectedNodeData.metadata).length > 0 ? (
                                                <div className="meta-grid">
                                                    {Object.entries(selectedNodeData.metadata).map(([k, v]) => (
                                                        <div key={k} className="meta-item">
                                                            <span className="meta-key">{k}:</span>
                                                            <span className="meta-val">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : selectedNodeData.description?.trim().startsWith('{') ? (
                                                <div className="meta-grid">
                                                    {Object.entries(JSON.parse(selectedNodeData.description)).map(([k, v]) => (
                                                        <div key={k} className="meta-item">
                                                            <span className="meta-key">{k}:</span>
                                                            <span className="meta-val">{String(v)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p>{selectedNodeData.description}</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        <div className="brain-controls-hint">Arrastra para rotar • Clic para detalles</div>
                    </div>
                ) : (
                    <div className="brain-table-view">

                        <h3 style={{ marginBottom: '16px', fontSize: '18px', color: '#f8fafc' }}>🏗️ Nodos de Infraestructura</h3>
                        <table className="brain-table">
                            <thead>
                                <tr><th>Icono</th><th>Nombre</th><th>Tipo</th><th>Estado</th><th>Grupo</th><th>XP</th></tr>
                            </thead>
                            <tbody>
                                {brainData?.nodes?.filter(n => typeFilter === 'all' || n.type.includes(typeFilter)).map(n => (
                                    <tr key={n.id} className={cn({ "brain-row-selected": selectedNode === n.id })} onClick={() => setSelectedNode(n.id)}>
                                        <td>{n.icon || "⚙️"}</td>
                                        <td>{n.label}</td>
                                        <td>{n.type}</td>
                                        <td><span className={cn("status-tag", n.status)}>{n.status}</span></td>
                                        <td>{n.node_group || "-"}</td>
                                        <td>{n.xp_value}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* XP Stats */}
                        {xpStats && (
                            <div className="brain-xp-section">
                                <h3>📊 Desglose de Experiencia</h3>
                                <div className="xp-stats-grid">
                                    {xpStats?.xp_breakdown?.map(b => (
                                        <div key={b.action} className="xp-stat-card">
                                            <div className="xp-stat-header">{b.action}</div>
                                            <div className="xp-stat-body">{b.total} XP</div>
                                            <div className="xp-stat-footer">{b.count} ejecuciones</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Memory Section at bottom */}
            {(brainData?.epistemic?.total_memory_nodes || 0) > 0 && (
                <div className="brain-memory-overlay">
                    <div className="brain-memory-bars">
                        {Object.entries(brainData?.epistemic?.memory_breakdown || {}).map(([type, count]) => {
                            const total = brainData?.epistemic?.total_memory_nodes || 0;
                            const pct = total > 0 ? (count / total) * 100 : 0;
                            const colors: Record<string, string> = { episodic: '#0ea5e9', semantic: '#a855f7', procedural: '#22c55e' };
                            return (
                                <div key={type} className="memory-pill">
                                    <span className="pill-dot" style={{ backgroundColor: colors[type] || '#6366f1' }} />
                                    <span className="pill-label">{type}: {count}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Chat overlay */}
            {showChat && <BrainChat onClose={() => setShowChat(false)} xp={brainData.total_xp} level={brainData.level} />}
                </>
            )}
        </div>
    );
};

export const BrainView = memo(BrainViewComponent);
