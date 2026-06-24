// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { GulinAIModel } from "@/app/aipanel/gulinai-model";
import { cn } from "@/util/util";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { DebugLogsViewModel } from "./debuglogs-model";

import { LOG_COLORS, DEFAULT_COLOR, truncateMessage } from "@/app/types/debuglog";
import { LogDetailModal } from "@/app/element/logdetailmodal";

export function UniversalLogsView({ model }: { model: DebugLogsViewModel }) {
    const aiModel = GulinAIModel.getInstance();
    const logs = jotai.useAtomValue(aiModel.debugLogs);
    const [filters, setFilters] = jotai.useAtom(aiModel.debugFilters);
    const scrollRef = React.useRef<any>(null);
    const [selectedLog, setSelectedLog] = React.useState<any>(null);

    const filteredLogs = logs.filter(log => filters.includes(log.category));

    const toggleFilter = (cat: string) => {
        if (filters.includes(cat)) {
            setFilters(filters.filter(f => f !== cat));
        } else {
            setFilters([...filters, cat]);
        }
    };

    const categories = ["API", "TERM", "FILE", "DB", "AI", "PLAI"];

    return (
        <div className="flex flex-col h-full w-full bg-zinc-950 text-white font-sans overflow-hidden">
            <header className="p-4 border-b border-white/10 flex items-center justify-between bg-zinc-900/50">
                <div className="flex items-center gap-3">
                    <i className="fa fa-bug text-rose-500 text-xl"></i>
                    <div>
                        <h1 className="text-lg font-bold">Consola de Servicios Gulin</h1>
                        <p className="text-[10px] text-muted uppercase tracking-widest opacity-50">Diagnostic Console v1.5 (FIXED)</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => aiModel.openServiceMap()}
                        className="px-3 py-1.5 bg-indigo-500/20 hover:bg-indigo-500/30 rounded-md border border-indigo-500/30 text-xs transition-all flex items-center gap-2 text-indigo-400 group"
                        title="Abrir Mapa de Servicios"
                    >
                        <i className="fa fa-network-wired group-hover:animate-pulse"></i>
                        <span>Mapa de Servicios</span>
                    </button>
                    <button 
                        onClick={() => aiModel.clearDebugLogs()}
                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-md border border-white/10 text-xs transition-all flex items-center gap-2 text-zinc-400"
                    >
                        <i className="fa fa-trash-can"></i> Limpiar
                    </button>
                </div>
            </header>

            <div className="p-3 flex flex-wrap gap-2 bg-zinc-900/30 border-b border-white/5">
                <button
                    onClick={() => setFilters(categories)}
                    className="px-3 py-1 rounded-md text-[10px] font-bold border border-zinc-700 text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-all"
                >
                    TODOS
                </button>
                {categories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => toggleFilter(cat)}
                        className={cn(
                            "px-3 py-1 rounded-md text-[10px] font-bold border transition-all",
                            filters.includes(cat) 
                                ? (LOG_COLORS[cat] || DEFAULT_COLOR) + " opacity-100 border-white/20 shadow-[0_0_10px_rgba(255,255,255,0.1)]"
                                : "text-zinc-500 border-zinc-800 bg-transparent opacity-60 hover:opacity-100"
                        )}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            <OverlayScrollbarsComponent
                className="flex-1 overflow-y-auto"
                options={{ scrollbars: { autoHide: "leave" } }}
                ref={scrollRef}
            >
                <div className="p-4 space-y-3">
                    {filteredLogs.length === 0 ? (
                        <div className="h-64 flex flex-col items-center justify-center opacity-20">
                            <i className="fa fa-terminal text-6xl mb-4"></i>
                            <p className="italic">No hay eventos registrados bajo los filtros actuales.</p>
                        </div>
                    ) : (
                        filteredLogs.map((log) => (
                            <div 
                                key={log.id} 
                                onClick={() => setSelectedLog(log)}
                                className={cn(
                                    "p-3 rounded-lg border font-mono text-xs transition-all hover:bg-white/[0.04] cursor-pointer",
                                    LOG_COLORS[log.category] || DEFAULT_COLOR
                                )}
                            >
                                <div className="flex items-center justify-between mb-2 opacity-60">
                                    <span className="font-bold uppercase tracking-tighter bg-white/10 px-1.5 py-0.5 rounded">{log.category}</span>
                                    <span>{new Date(log.ts).toLocaleString()}</span>
                                </div>
                                <div className="whitespace-pre-wrap break-all leading-relaxed">
                                    {truncateMessage(log.message)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </OverlayScrollbarsComponent>

            <footer className="p-2 border-t border-white/10 bg-zinc-950 flex justify-between items-center text-[10px] text-zinc-500">
                <span>{filteredLogs.length} eventos en total</span>
                <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                        Sistema Activo
                    </span>
                </div>
            </footer>
            <LogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />
        </div>
    );
}
