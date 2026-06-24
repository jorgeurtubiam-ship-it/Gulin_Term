// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, useCallback } from "react";
import { AgentData, AgentGroup } from "./auto-agents-types";

interface AutoAgentsMap3DProps {
    agents: AgentData[];
    groups: AgentGroup[];
    selectedAgentId: string | null;
    onSelectAgent: (id: string | null) => void;
}

export function AutoAgentsMap3D({ agents, groups, selectedAgentId, onSelectAgent }: AutoAgentsMap3DProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef<number>(0);
    const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
    const agentPositions = useRef<Map<string, { x: number; y: number; z: number }>>(new Map());
    const connectedPairs = useRef<Array<[string, string]>>([]);
    const projectedPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

    // Calculate positions on a 3D sphere layout
    const layoutAgents = useCallback(() => {
        const positions = new Map<string, { x: number; y: number; z: number }>();
        const enabledAgents = agents.filter(a => a.enabled);
        const count = enabledAgents.length;
        
        if (count === 0) return positions;
        
        const radius = 120;
        const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
        
        enabledAgents.forEach((agent, i) => {
            const y = 1 - (i / (count - 1 || 1)) * 2;
            const radiusAtY = Math.sqrt(1 - y * y) * radius;
            const theta = phi * i;
            
            positions.set(agent.id, {
                x: Math.cos(theta) * radiusAtY,
                y: y * radius,
                z: Math.sin(theta) * radiusAtY
            });
        });
        
        return positions;
    }, [agents]);

    // Precompute connections (agents in same group are connected)
    const computeConnections = useCallback(() => {
        const pairs: Array<[string, string]> = [];
        const seen = new Set<string>();
        
        groups.forEach(group => {
            for (let i = 0; i < group.agent_ids.length; i++) {
                for (let j = i + 1; j < group.agent_ids.length; j++) {
                    const key = [group.agent_ids[i], group.agent_ids[j]].sort().join("-");
                    if (!seen.has(key)) {
                        seen.add(key);
                        pairs.push([group.agent_ids[i], group.agent_ids[j]]);
                    }
                }
            }
        });
        
        return pairs;
    }, [groups]);

    // Draw frame
    const draw = useCallback((ctx: CanvasRenderingContext2D, time: number) => {
        const w = ctx.canvas.clientWidth;
        const h = ctx.canvas.clientHeight;
        
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        
        const positions = agentPositions.current;
        if (positions.size === 0) return;
        
        // Project 3D to 2D with rotation
        const rotY = time * 0.0003;
        const rotX = Math.sin(time * 0.0001) * 0.3;
        
        const projected = new Map<string, { x: number; y: number; z: number; sx: number; sy: number }>();
        const proj2D = new Map<string, { x: number; y: number }>();
        
        positions.forEach((pos, id) => {
            // Rotate Y
            const cosY = Math.cos(rotY);
            const sinY = Math.sin(rotY);
            const x1 = pos.x * cosY - pos.z * sinY;
            const z1 = pos.x * sinY + pos.z * cosY;
            
            // Rotate X
            const cosX = Math.cos(rotX);
            const sinX = Math.sin(rotX);
            const y1 = pos.y * cosX - z1 * sinX;
            const z2 = pos.y * sinX + z1 * cosX;
            
            // Perspective projection
            const fov = 500;
            const scale = fov / (fov + z2);
            const cx = w / 2;
            const cy = h / 2;
            
            const sx = cx + x1 * scale;
            const sy = cy + y1 * scale;
            
            projected.set(id, {
                x: pos.x, y: pos.y, z: pos.z,
                sx, sy
            });
            proj2D.set(id, { x: sx, y: sy });
        });
        
        projectedPositions.current = proj2D;
        
        // Draw connections (edges)
        const pairs = connectedPairs.current;
        pairs.forEach(([idA, idB]) => {
            const a = projected.get(idA);
            const b = projected.get(idB);
            if (!a || !b) return;
            
            ctx.beginPath();
            ctx.moveTo(a.sx, a.sy);
            ctx.lineTo(b.sx, b.sy);
            ctx.strokeStyle = "rgba(100, 100, 150, 0.3)";
            ctx.lineWidth = 1;
            ctx.stroke();
        });
        
        // Draw agents (nodes)
        agents.forEach(agent => {
            const proj = projected.get(agent.id);
            if (!proj) return;
            
            const isSelected = selectedAgentId === agent.id;
            const isHovered = hoveredAgent === agent.id;
            const radius = isSelected ? 14 : (isHovered ? 12 : 8);
            
            // Glow for selected
            if (isSelected) {
                ctx.beginPath();
                ctx.arc(proj.sx, proj.sy, radius + 8, 0, Math.PI * 2);
                ctx.fillStyle = agent.color + "40";
                ctx.fill();
            }
            
            // Node circle
            ctx.beginPath();
            ctx.arc(proj.sx, proj.sy, radius, 0, Math.PI * 2);
            ctx.fillStyle = agent.color;
            ctx.fill();
            
            // Border
            ctx.strokeStyle = isSelected ? "#fff" : "rgba(255,255,255,0.3)";
            ctx.lineWidth = isSelected ? 2 : 1;
            ctx.stroke();
            
            // Label
            ctx.fillStyle = "#e0e0e0";
            ctx.font = "11px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(agent.name, proj.sx, proj.sy + radius + 16);
            
            // Icon
            ctx.font = "16px sans-serif";
            ctx.fillText(agent.icon, proj.sx - 8, proj.sy + 6);
        });
    }, [agents, selectedAgentId, hoveredAgent]);

    // Animation loop
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        
        const resize = () => {
            canvas.width = canvas.clientWidth * window.devicePixelRatio;
            canvas.height = canvas.clientHeight * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        };
        
        resize();
        window.addEventListener("resize", resize);
        
        agentPositions.current = layoutAgents();
        connectedPairs.current = computeConnections();
        
        let running = true;
        const loop = (time: number) => {
            if (!running) return;
            draw(ctx, time);
            animRef.current = requestAnimationFrame(loop);
        };
        animRef.current = requestAnimationFrame(loop);
        
        return () => {
            running = false;
            cancelAnimationFrame(animRef.current);
            window.removeEventListener("resize", resize);
        };
    }, [layoutAgents, computeConnections, draw]);

    // Recalculate on agents/groups change
    useEffect(() => {
        agentPositions.current = layoutAgents();
        connectedPairs.current = computeConnections();
    }, [agents, groups, layoutAgents, computeConnections]);

    const handleMouseMove = (e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        
        let hoveredId: string | null = null;
        projectedPositions.current.forEach((pos, id) => {
            const dist = Math.hypot(pos.x - mx, pos.y - my);
            if (dist < 20) {
                hoveredId = id;
            }
        });
        setHoveredAgent(hoveredId);
    };

    const handleClick = (e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        
        let clickedId: string | null = null;
        projectedPositions.current.forEach((pos, id) => {
            const dist = Math.hypot(pos.x - mx, pos.y - my);
            if (dist < 20) {
                clickedId = id;
            }
        });
        
        onSelectAgent(clickedId === selectedAgentId ? null : clickedId);
    };

    return (
        <canvas
            ref={canvasRef}
            className="w-full h-full rounded-lg cursor-pointer"
            style={{ background: "#1a1a2e", minHeight: "300px" }}
            onMouseMove={handleMouseMove}
            onClick={handleClick}
        />
    );
}

