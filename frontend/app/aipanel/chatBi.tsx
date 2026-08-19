// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { memo, useState, useRef } from "react";
import {
    BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { cn } from "@/util/util";
import { toPng } from "html-to-image";
// @ts-ignore
import * as XLSX from "xlsx";

export interface ChatBiWidgetProps {
    data: any[];
    columns: string[];
    title?: string;
    chartType?: string;
    sql?: string;
    narrative?: string;
}

export const ChatBiWidget = memo(({ data, columns, title, chartType = "bar", sql, narrative }: ChatBiWidgetProps) => {
    const [currentChartType, setCurrentChartType] = useState<string>(chartType.toLowerCase());
    const [showSql, setShowSql] = useState(false);
    const chartRef = useRef<HTMLDivElement>(null);

    const handleExportPNG = async () => {
        if (!chartRef.current) return;
        try {
            const dataUrl = await toPng(chartRef.current, { backgroundColor: "#09090b", style: { padding: "10px" } });
            const link = document.createElement("a");
            link.download = `chart-${Date.now()}.png`;
            link.href = dataUrl;
            link.click();
        } catch (err) { console.error("Export PNG error", err); }
    };

    const handleExportCSV = () => {
        if (data.length === 0) return;
        const csv = [
            columns.join(","),
            ...data.map(row => columns.map(k => `"${row[k]}"`).join(","))
        ].join("\n");
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `data-${Date.now()}.csv`;
        a.click();
    };

    const handleExportXLSX = () => {
        if (data.length === 0) return;
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Data");
        XLSX.writeFile(wb, `data-${Date.now()}.xlsx`);
    };

    if (!data || data.length === 0) {
        return (
            <div className="p-4 bg-zinc-900/50 rounded-lg text-sm text-zinc-400 italic border border-zinc-800">
                No hay datos disponibles para visualizar.
            </div>
        );
    }

    // Identificar columnas numéricas vs texto
    const sample = data[0];
    const numericKeys = columns.filter(k => 
        typeof sample[k] === "number" || (!isNaN(parseFloat(sample[k])) && isFinite(sample[k]))
    );
    const xAxisKey = columns.find(k => !numericKeys.includes(k)) || columns[0] || "name";

    const colors = ["#8b5cf6", "#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#06b6d4"];

    const renderChart = () => {
        if (currentChartType === "grid" || currentChartType === "table") {
            return (
                <div className="overflow-auto custom-scrollbar max-h-64 rounded-md border border-zinc-800 bg-zinc-950/50">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead className="sticky top-0 bg-zinc-900 z-10 shadow-sm">
                            <tr>
                                {columns.map(key => (
                                    <th key={key} className="px-3 py-2 font-bold text-violet-400 uppercase tracking-widest border-b border-zinc-800">
                                        {key}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/30">
                            {data.slice(0, 100).map((row, i) => (
                                <tr key={i} className="hover:bg-violet-500/10 transition-colors">
                                    {columns.map(key => (
                                        <td key={key} className="px-3 py-1.5 text-zinc-300 font-mono">
                                            {typeof row[key] === "object" ? JSON.stringify(row[key]) : String(row[key] ?? "-")}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {data.length > 100 && (
                        <div className="text-center py-2 text-[10px] text-zinc-500 italic bg-zinc-900/50 border-t border-zinc-800">
                            Mostrando primeros 100 resultados de {data.length}
                        </div>
                    )}
                </div>
            );
        }

        const commonProps = { data, margin: { top: 10, right: 10, left: -20, bottom: 0 } };

        const CustomTooltip = ({ active, payload, label }: any) => {
            if (active && payload && payload.length) {
                return (
                    <div className="bg-zinc-900 border border-zinc-700/50 p-2 rounded-lg shadow-xl">
                        <p className="text-[10px] font-bold text-zinc-400 mb-1">{label}</p>
                        {payload.map((entry: any, index: number) => (
                            <div key={index} className="flex items-center gap-4 text-xs py-0.5">
                                <span style={{ color: entry.color }}>{entry.name}:</span>
                                <span className="font-mono text-zinc-100">{Number(entry.value).toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                );
            }
            return null;
        };

        if (currentChartType === "line") {
            return (
                <LineChart {...commonProps}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey={xAxisKey} stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                    {numericKeys.map((key, i) => (
                        <Line type="monotone" key={key} dataKey={key} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 2 }} />
                    ))}
                </LineChart>
            );
        }

        if (currentChartType === "area") {
            return (
                <AreaChart {...commonProps}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey={xAxisKey} stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                    {numericKeys.map((key, i) => (
                        <Area type="monotone" key={key} dataKey={key} fill={colors[i % colors.length]} stroke={colors[i % colors.length]} fillOpacity={0.3} />
                    ))}
                </AreaChart>
            );
        }

        if (currentChartType === "pie") {
            return (
                <PieChart>
                    <Pie data={data} cx="50%" cy="50%" innerRadius="40%" outerRadius="70%" paddingAngle={2} dataKey={numericKeys[0] || columns[0]}>
                        {data.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} stroke="transparent" />
                        ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                </PieChart>
            );
        }

        return (
            <BarChart {...commonProps}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey={xAxisKey} stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255, 255, 255, 0.05)" }} />
                <Legend wrapperStyle={{ fontSize: "10px" }} />
                {numericKeys.map((key, i) => (
                    <Bar key={key} dataKey={key} fill={colors[i % colors.length]} radius={[2, 2, 0, 0]} />
                ))}
            </BarChart>
        );
    };

    return (
        <div ref={chartRef} className="flex flex-col w-full bg-zinc-950/40 p-3 rounded-xl border border-violet-500/20 shadow-md my-2">
            {/* Cabecera */}
            <div className="flex justify-between items-start mb-3">
                <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                        <i className="fa-solid fa-chart-line text-violet-400 text-xs"></i>
                        <h4 className="text-xs font-bold text-white uppercase tracking-wide">{title || "Resultados BI"}</h4>
                    </div>
                    {narrative && <p className="text-[10px] text-zinc-400 mt-1">{narrative}</p>}
                </div>
                <div className="flex gap-1 bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-800">
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
                                "p-1.5 rounded-md transition-colors",
                                currentChartType === btn.id ? "bg-violet-600/30 text-violet-300" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                            )}
                            title={btn.id}
                        >
                            <i className={cn("fa-solid", btn.icon, "text-[10px]")}></i>
                        </button>
                    ))}
                    
                    <div className="w-[1px] bg-zinc-800 mx-1"></div>
                    
                    <button onClick={handleExportCSV} className="p-1.5 rounded-md text-zinc-500 hover:text-green-400 hover:bg-zinc-800 transition-colors" title="Export CSV">
                        <i className="fa-solid fa-file-csv text-[10px]"></i>
                    </button>
                    <button onClick={handleExportXLSX} className="p-1.5 rounded-md text-zinc-500 hover:text-green-400 hover:bg-zinc-800 transition-colors" title="Export XLSX">
                        <i className="fa-solid fa-file-excel text-[10px]"></i>
                    </button>
                    <button onClick={handleExportPNG} className="p-1.5 rounded-md text-zinc-500 hover:text-blue-400 hover:bg-zinc-800 transition-colors" title="Export PNG">
                        <i className="fa-solid fa-image text-[10px]"></i>
                    </button>
                </div>
            </div>

            {/* Gráfico / Tabla */}
            <div className="w-full h-52">
                <ResponsiveContainer width="100%" height="100%">
                    {renderChart()}
                </ResponsiveContainer>
            </div>

            {/* SQL Toggle */}
            {sql && (
                <div className="mt-3 pt-2 border-t border-zinc-800/50">
                    <button 
                        onClick={() => setShowSql(!showSql)}
                        className="text-[10px] flex items-center gap-1.5 text-zinc-500 hover:text-violet-400 transition-colors font-mono"
                    >
                        <i className={cn("fa-solid", showSql ? "fa-chevron-down" : "fa-chevron-right")}></i>
                        Ver consulta SQL
                    </button>
                    {showSql && (
                        <div className="mt-2 p-2 bg-zinc-950 rounded border border-zinc-800 text-[10px] text-zinc-300 font-mono overflow-auto max-h-32">
                            <pre>{sql}</pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

ChatBiWidget.displayName = "ChatBiWidget";
