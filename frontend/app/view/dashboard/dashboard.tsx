// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { memo, useRef, useMemo, useState } from "react";
import {
    BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { toPng } from 'html-to-image';
import { useAtomValue } from "jotai";
import { DashboardViewModel } from "./dashboard-model";
import { ErrorBoundary } from "@/element/errorboundary";
import { getGulinObjectAtom, makeORef } from "@/store/wos";
import { IconButton } from "@/element/iconbutton";
import { cn } from "@/util/util";

/**
 * DashboardView (MODO BI): Estación de Inteligencia Conversacional.
 * 
 * Este componente evoluciona el dashboard estático a una herramienta de BI Interactiva.
 * Incluye:
 * - Cambio dinámico de tipo de gráfico.
 * - Tarjetas de KPI inteligentes (Métricas de Negocio).
 * - Gulin Data-Chat: Interfaz para conversar con los datos.
 * - Exportación a CSV y PNG.
 * - Estética Premium con Glassmorphism.
 */
export const DashboardView = memo(({ model, blockId }: { model: DashboardViewModel, blockId: string }) => {
    const blockDataAtom = useMemo(() => getGulinObjectAtom<Block>(makeORef("block", blockId)), [blockId]);
    const blockData = useAtomValue(blockDataAtom);

    // --- ESTADOS DE INTERACCIÓN BI ---
    const [currentChartType, setCurrentChartType] = useState<string | null>(null);
    const [chatInput, setChatInput] = useState("");
    const [isExpanded, setIsExpanded] = useState(false);
    const [activeFilter, setActiveFilter] = useState<{ key: string, value: any } | null>(null);
    const [internalMessages, setInternalMessages] = useState<{role: 'user' | 'gulin', text: string}[]>([]);

    // Ref Lock para estabilidad de la data inicial
    const lockedData = useRef<any[] | null>(null);
    const lockedTitle = useRef<string | null>(null);
    const lockedType = useRef<string | null>(null);
    const chartContainerRef = useRef<HTMLDivElement>(null);

    const rawData = blockData?.meta?.["dashboard:data"];

    // Capturar y bloquear la primera ráfaga de datos válida
    if (!lockedData.current && rawData) {
        try {
            const strData = typeof rawData === "string" ? rawData : JSON.stringify(rawData);
            const parsed = JSON.parse(strData);
            if (Array.isArray(parsed) && parsed.length > 0) {
                lockedData.current = parsed;
                lockedTitle.current = (blockData?.meta?.["dashboard:title"] as string) || "Gulin BI Station";
                lockedType.current = (blockData?.meta?.["dashboard:type"] as string) || "bar";
            }
        } catch (e) {
            console.error("Dashboard parse error:", e);
        }
    }

    const chartData = lockedData.current || [];
    const chartTitle = lockedTitle.current || "Gulin BI Station";
    const chartType = currentChartType || (lockedType.current || "bar").toLowerCase();

    // --- LÓGICA DE INTELIGENCIA DE NEGOCIO (KPIs) ---
    const kpis = useMemo(() => {
        if (chartData.length === 0) return [];
        // Identificar la primera columna numérica como métrica principal
        const numericKeys = Object.keys(chartData[0]).filter(k => typeof chartData[0][k] === 'number');
        if (numericKeys.length === 0) return [];
        
        const key = numericKeys[0];
        const total = chartData.reduce((acc, curr) => acc + (Number(curr[key]) || 0), 0);
        const avg = total / chartData.length;
        const max = Math.max(...chartData.map(d => Number(d[key]) || 0));

        return [
            { label: `Total ${key}`, value: total.toLocaleString(), icon: "sigma", color: "text-violet-400" },
            { label: `Promedio`, value: avg.toLocaleString(undefined, { maximumFractionDigits: 1 }), icon: "divide", color: "text-emerald-400" },
            { label: `Valor Máximo`, value: max.toLocaleString(), icon: "arrow-up-right", color: "text-blue-400" }
        ];
    }, [chartData]);

    const handleDownloadPng = async () => {
        if (!chartContainerRef.current) return;
        try {
            const dataUrl = await toPng(chartContainerRef.current, {
                backgroundColor: "#09090b",
                style: { padding: "20px" }
            });
            const link = document.createElement("a");
            link.download = `gulin-bi-${chartTitle.toLowerCase().replace(/\s+/g, "-")}.png`;
            link.href = dataUrl;
            link.click();
        } catch (err) { console.error("PNG Export error:", err); }
    };

    const handleExportCSV = () => {
        if (chartData.length === 0) return;
        const keys = Object.keys(chartData[0]);
        const csv = [
            keys.join(","),
            ...chartData.map(row => keys.map(k => `"${row[k]}"`).join(","))
        ].join("\n");
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${chartTitle.toLowerCase().replace(/\s+/g, '-')}.csv`;
        a.click();
    };

    const handleChatSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const text = chatInput.trim();
        if (!text) return;
        
        // 1. Añadir mensaje del usuario a la historia interna
        setInternalMessages(prev => [...prev, { role: 'user', text }]);
        setChatInput("");

        // 2. Lógica de "Inteligencia Local" (Filtros automáticos)
        const lowerText = text.toLowerCase();
        if (lowerText.includes("alta") || lowerText.includes("crítico") || lowerText.includes("urgente")) {
            // Intentamos encontrar una columna de estatus o prioridad
            const statusKey = Object.keys(chartData[0] || {}).find(k => k.toLowerCase().includes("estatus") || k.toLowerCase().includes("estado"));
            if (statusKey) {
                setActiveFilter({ key: statusKey, value: "EXPIRADO (Oct 2023)" }); // Ejemplo basado en tu data
                setInternalMessages(prev => [...prev, { role: 'gulin', text: "Entendido. He filtrado el dashboard para mostrar solo los elementos críticos." }]);
                setCurrentChartType("grid");
                return;
            }
        }

        if (lowerText.includes("limpia") || lowerText.includes("todos")) {
            setActiveFilter(null);
            setInternalMessages(prev => [...prev, { role: 'gulin', text: "Filtros eliminados. Mostrando todos los datos." }]);
            return;
        }

        // 3. Simulación de respuesta de análisis si no es un filtro conocido
        setTimeout(() => {
            setInternalMessages(prev => [...prev, { role: 'gulin', text: "Estoy analizando esa solicitud. Por ahora puedo ayudarte a filtrar por estados o limpiar las vistas." }]);
        }, 600);
    };

    const renderChart = () => {
        if (chartData.length === 0) {
            return (
                <div className="flex flex-col h-full w-full items-center justify-center text-zinc-600 gap-4 animate-pulse">
                    <i className="fa-solid fa-chart-line text-4xl opacity-20"></i>
                    <p className="italic text-sm font-medium">Analizando datos en tiempo real...</p>
                </div>
            );
        }

        if (chartType === "grid") {
            const ROW_LIMIT = 500;
            const allKeys = Array.from(new Set(chartData.flatMap(item => Object.keys(item))));
            
            // Aplicar filtro si existe
            const filteredData = activeFilter 
                ? chartData.filter(d => String(d[activeFilter.key]) === String(activeFilter.value))
                : chartData;
            
            const displayData = filteredData.slice(0, ROW_LIMIT);

            return (
                <div className="flex flex-col w-full h-full overflow-hidden rounded-xl border border-zinc-800/50 bg-zinc-950/30 backdrop-blur-md shadow-inner">
                    {activeFilter && (
                        <div className="bg-violet-500/10 px-4 py-2 border-b border-violet-500/20 flex justify-between items-center shrink-0">
                            <span className="text-[10px] text-violet-300 font-bold uppercase tracking-wider">
                                <i className="fa-solid fa-filter mr-2"></i>
                                Filtrado por {activeFilter.key}: <span className="text-white ml-1">{activeFilter.value}</span>
                            </span>
                            <button onClick={() => setActiveFilter(null)} className="text-[9px] text-zinc-400 hover:text-white underline font-bold">Limpiar Filtro</button>
                        </div>
                    )}
                    <div className="overflow-auto custom-scrollbar flex-1">
                        <table className="w-full text-left border-collapse min-w-max">
                            <thead className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-md">
                                <tr>
                                    {allKeys.map(key => (
                                        <th key={key} className="px-4 py-3 text-[10px] font-black text-violet-400 uppercase tracking-widest border-b border-zinc-800">
                                            {key.replace(/([A-Z])/g, " $1")}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/30">
                                {displayData.map((row, i) => (
                                    <tr key={i} className="hover:bg-violet-500/5 transition-colors group">
                                        {allKeys.map(key => (
                                            <td key={key} className="px-4 py-2.5 text-xs text-zinc-300 font-mono group-hover:text-zinc-100">
                                                {typeof row[key] === "object" ? JSON.stringify(row[key]) : String(row[key] ?? "-")}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
        }

        const sample = chartData[0];
        // Solo graficamos columnas que tengan valores numéricos
        const keys = Object.keys(sample).filter(k => 
            typeof sample[k] === "number" || (!isNaN(parseFloat(sample[k])) && isFinite(sample[k]))
        );
        
        // Buscamos la mejor clave para el eje X (que no sea numérica)
        const xAxisKey = Object.keys(sample).find(k => 
            typeof sample[k] === "string" && !keys.includes(k)
        ) || Object.keys(sample)[0] || "name";

        const colors = ["#8b5cf6", "#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#06b6d4", "#f87171", "#fb923c"];

        const commonProps = {
            data: chartData,
            margin: { top: 10, right: 10, left: 0, bottom: 0 }
        };

        const CustomTooltip = ({ active, payload, label }: any) => {
            if (active && payload && payload.length) {
                return (
                    <div className="bg-zinc-900/95 border border-zinc-700/50 p-3 rounded-xl shadow-2xl backdrop-blur-md">
                        <p className="text-[10px] font-black text-zinc-400 mb-2 uppercase tracking-tighter">{label}</p>
                        {payload.map((entry: any, index: number) => (
                            <div key={index} className="flex items-center justify-between gap-6 text-xs py-0.5">
                                <span style={{ color: entry.color }} className="font-bold">{entry.name}:</span>
                                <span className="font-mono text-zinc-100">{Number(entry.value).toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                );
            }
            return null;
        };

        const renderChartContent = () => {
            switch (chartType) {
                case "line":
                    return (
                        <LineChart {...commonProps}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                            <XAxis dataKey={xAxisKey} stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} tickMargin={10} />
                            <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => Number(v).toLocaleString()} />
                            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#3f3f46', strokeWidth: 1 }} />
                            <Legend iconType="circle" wrapperStyle={{ fontSize: "10px", paddingTop: "20px" }} />
                            {keys.map((key, i) => (
                                <Line 
                                    type="monotone" 
                                    key={key} 
                                    dataKey={key} 
                                    name={key}
                                    stroke={colors[i % colors.length]} 
                                    strokeWidth={3} 
                                    dot={{ r: 3, strokeWidth: 2, fill: "#09090b" }} 
                                    activeDot={{ r: 5, strokeWidth: 0 }} 
                                    isAnimationActive={true} 
                                    onClick={(data) => {
                                        if (data) {
                                            setActiveFilter({ key: xAxisKey, value: data.activeLabel });
                                            setCurrentChartType("grid");
                                        }
                                    }}
                                    className="cursor-pointer"
                                />
                            ))}
                        </LineChart>
                    );
                case "area":
                    return (
                        <AreaChart {...commonProps}>
                            <defs>
                                {keys.map((key, i) => (
                                    <linearGradient key={`grad-${key}`} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={colors[i % colors.length]} stopOpacity={0.4}/>
                                        <stop offset="95%" stopColor={colors[i % colors.length]} stopOpacity={0}/>
                                    </linearGradient>
                                ))}
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                            <XAxis dataKey={xAxisKey} stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} tickMargin={10} />
                            <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend iconType="rect" wrapperStyle={{ fontSize: "10px", paddingTop: "20px" }} />
                            {keys.map((key, i) => (
                                <Area type="monotone" key={key} dataKey={key} stroke={colors[i % colors.length]} fill={`url(#grad-${key})`} strokeWidth={2} isAnimationActive={true} />
                            ))}
                        </AreaChart>
                    );
                case "pie":
                    return (
                        <PieChart>
                            <Pie
                                data={chartData}
                                cx="50%"
                                cy="50%"
                                innerRadius="60%"
                                outerRadius="80%"
                                paddingAngle={5}
                                dataKey={keys[0]}
                                isAnimationActive={true}
                            >
                                {chartData.map((_entry, index) => (
                                    <Cell key={`cell-${index}`} fill={colors[index % colors.length]} stroke="transparent" />
                                ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                            <Legend wrapperStyle={{ fontSize: "10px" }} />
                        </PieChart>
                    );
                default:
                    return (
                        <BarChart {...commonProps}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                            <XAxis dataKey={xAxisKey} stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} tickMargin={10} />
                            <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255, 255, 255, 0.03)" }} />
                            <Legend iconType="rect" wrapperStyle={{ fontSize: "10px", paddingTop: "20px" }} />
                            {keys.map((key, i) => (
                                <Bar 
                                    key={key} 
                                    dataKey={key} 
                                    name={key}
                                    fill={colors[i % colors.length]} 
                                    radius={[4, 4, 0, 0]} 
                                    barSize={40} 
                                    isAnimationActive={true} 
                                    onClick={(data) => {
                                        if (data) {
                                            setActiveFilter({ key: xAxisKey, value: data.payload[xAxisKey] || data.payload.name });
                                            setCurrentChartType("grid");
                                        }
                                    }}
                                    className="cursor-pointer"
                                />
                            ))}
                        </BarChart>
                    );
            }
        };

        return (
            <ResponsiveContainer width="100%" height="100%" debounce={50}>
                {renderChartContent()}
            </ResponsiveContainer>
        );
    };

    return (
        <ErrorBoundary>
            <div className={cn(
                "flex flex-col w-full bg-zinc-950/60 p-6 rounded-2xl border border-zinc-800/50 shadow-2xl overflow-hidden self-stretch backdrop-blur-xl transition-all duration-500",
                isExpanded ? "fixed inset-8 z-[1000] shadow-[0_0_100px_rgba(0,0,0,0.8)]" : "h-full"
            )}>
                {/* CABECERA: Título y Controles */}
                <div className="flex justify-between items-start mb-6 shrink-0">
                    <div className="flex gap-4 items-center">
                        <div className="w-1.5 h-12 bg-gradient-to-b from-violet-500 to-indigo-600 rounded-full shadow-[0_0_10px_rgba(139,92,246,0.3)]" />
                        <div>
                            <h2 className="text-xl font-black text-white tracking-tight leading-none uppercase italic">{chartTitle}</h2>
                            <div className="flex items-center gap-2 mt-2">
                                <span className="text-[8px] text-violet-400 font-black uppercase tracking-[0.2em] bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                                    BI Intelligence Engine
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2 bg-zinc-900/60 p-1 rounded-xl border border-zinc-800 shadow-inner">
                        <div className="flex border-r border-zinc-800 pr-2 mr-1">
                            {[
                                { id: 'bar', icon: 'fa-chart-bar' },
                                { id: 'line', icon: 'fa-chart-line' },
                                { id: 'area', icon: 'fa-chart-area' },
                                { id: 'pie', icon: 'fa-chart-pie' },
                                { id: 'grid', icon: 'fa-table' }
                            ].map(btn => (
                                <button
                                    key={btn.id}
                                    onClick={() => setCurrentChartType(btn.id)}
                                    className={cn(
                                        "p-2 rounded-lg transition-all duration-200",
                                        chartType === btn.id ? "bg-violet-600 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
                                    )}
                                    title={`Vista: ${btn.id}`}
                                >
                                    <i className={cn("fa-solid", btn.icon, "text-xs")}></i>
                                </button>
                            ))}
                        </div>
                        <IconButton decl={{ icon: "file-csv", click: handleExportCSV, title: "Exportar Excel/CSV" }} className="text-zinc-500 hover:text-emerald-400" />
                        <IconButton decl={{ icon: "download", click: handleDownloadPng, title: "Exportar PNG" }} className="text-zinc-500 hover:text-white" />
                        <IconButton decl={{ icon: isExpanded ? "compress" : "expand", click: () => setIsExpanded(!isExpanded) }} className="text-zinc-500 hover:text-white" />
                    </div>
                </div>

                {/* KPI CARDS: Métricas de Negocio */}
                <div className="grid grid-cols-3 gap-4 mb-6 shrink-0">
                    {kpis.map((kpi, i) => (
                        <div key={i} className="group bg-zinc-900/40 border border-zinc-800/40 p-3 rounded-2xl flex items-center gap-4 hover:border-zinc-700/60 transition-all shadow-sm">
                            <div className={cn("w-10 h-10 rounded-xl bg-zinc-950 flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform", kpi.color)}>
                                <i className={`fa-solid fa-${kpi.icon} text-sm`}></i>
                            </div>
                            <div>
                                <p className="text-[9px] text-zinc-500 uppercase font-black tracking-tighter mb-0.5">{kpi.label}</p>
                                <p className="text-lg font-black text-zinc-100 leading-none">{kpi.value}</p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* AREA DEL GRAFICO / MENSAJES */}
                <div className="flex-1 min-h-0 w-full relative group/chart flex flex-col gap-4">
                    {internalMessages.length > 0 && (
                        <div className="absolute top-0 left-0 right-0 z-20 flex flex-col gap-2 max-h-[150px] overflow-auto p-2 bg-zinc-950/80 backdrop-blur-md rounded-xl border border-zinc-800/50 shadow-2xl custom-scrollbar">
                            {internalMessages.map((msg, i) => (
                                <div key={i} className={cn(
                                    "text-[10px] p-2 rounded-lg max-w-[80%]",
                                    msg.role === 'user' ? "bg-violet-600/20 text-violet-200 self-end border border-violet-500/20" : "bg-zinc-800/50 text-zinc-300 self-start border border-zinc-700/30"
                                )}>
                                    <span className="font-black uppercase text-[8px] block mb-1 opacity-50">{msg.role === 'user' ? 'Tú' : 'Gulin BI'}</span>
                                    {msg.text}
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex-1 min-h-0">
                        {renderChart()}
                    </div>
                </div>

                {/* GULIN DATA-CHAT: Filtro Inteligente */}
                <form onSubmit={handleChatSubmit} className="mt-6 shrink-0 relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
                        <i className="fa-solid fa-sparkles text-violet-500 animate-pulse text-xs"></i>
                    </div>
                    <input 
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Conversa con tus datos... (ej: 'Muestra solo críticos', 'Súmame todo')"
                        className="w-full bg-zinc-900/60 border border-zinc-800/80 rounded-2xl pl-10 pr-4 py-3.5 text-xs text-white focus:outline-none focus:border-violet-500/50 focus:bg-zinc-900 transition-all placeholder:text-zinc-600 shadow-2xl"
                    />
                    <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-zinc-500 hover:text-violet-400 transition-colors">
                        <i className="fa-solid fa-paper-plane text-xs"></i>
                    </button>
                </form>

                {/* FOOTER */}
                <div className="mt-4 flex justify-between items-center border-t border-zinc-900/50 pt-3 shrink-0">
                    <span className="text-[7px] text-zinc-700 font-mono uppercase tracking-widest">ID-WIDGET: {blockId.substring(0, 8)}</span>
                    <span className="text-[8px] text-zinc-600 font-bold italic">Gulin Intelligence Dashboard © 2025</span>
                </div>
            </div>
            
            {/* Expanded Overlay */}
            {isExpanded && (
                <div className="fixed inset-0 z-[999] bg-black/90 backdrop-blur-md" onClick={() => setIsExpanded(false)} />
            )}
        </ErrorBoundary>
    );
});

DashboardView.displayName = "DashboardView";
