// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtom, useAtomValue } from "jotai";
import { memo, useEffect, useRef, useState } from "react";
import { GulinAIModel } from "./gulinai-model";
import { cn } from "@/util/util";

import { LOG_COLORS, DEFAULT_COLOR, truncateMessage } from "@/app/types/debuglog";
import { LogDetailModal } from "@/app/element/logdetailmodal";

export const DebugLogWidget = memo(() => {
    const model = GulinAIModel.getInstance();
    const logs = useAtomValue(model.debugLogs);
    const [isVisible, setIsVisible] = useAtom(model.isDebugVisible);
    const [filters, setFilters] = useAtom(model.debugFilters);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [selectedLog, setSelectedLog] = useState<any>(null);

    useEffect(() => {
        if (autoScroll && scrollRef.current) {
            scrollRef.current.scrollTop = 0; // It's reversed order in state, or should I scroll to bottom?
            // Actually logs are [newLog, ...currentLogs]
        }
    }, [logs, autoScroll]);

    if (!isVisible) return null;

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
        <div className="absolute top-0 left-0 right-0 h-[70%] z-[100] bg-zinc-950/90 backdrop-blur-xl flex flex-col border-b border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] animate-in slide-in-from-top duration-300">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <h3 className="font-bold text-white tracking-wide uppercase text-xs">Logs de Depuración Universal</h3>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => model.openDebugLogsAsWidget()}
                        className="p-1.5 hover:bg-white/10 rounded transition-colors text-zinc-400 hover:text-white"
                        title="Abrir como Widget"
                    >
                        <i className="fa fa-expand text-sm" />
                    </button>
                    <button 
                        onClick={() => model.clearDebugLogs()}
                        className="p-1.5 hover:bg-white/10 rounded transition-colors text-zinc-400 hover:text-white"
                        title="Limpiar logs"
                    >
                        <i className="fa fa-trash-can text-sm" />
                    </button>
                    <button 
                        onClick={() => setIsVisible(false)}
                        className="p-1.5 hover:bg-white/10 rounded transition-colors text-zinc-400 hover:text-white"
                    >
                        <i className="fa fa-times text-lg" />
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="p-3 flex flex-wrap gap-2 border-b border-white/5 bg-zinc-900/50">
                {categories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => toggleFilter(cat)}
                        className={cn(
                            "px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all duration-200",
                            filters.includes(cat) 
                                ? (LOG_COLORS[cat] || DEFAULT_COLOR) + " opacity-100 scale-105 shadow-lg shadow-black/20"
                                : "text-zinc-500 border-zinc-800 bg-transparent opacity-60 hover:opacity-100"
                        )}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {/* Logs List */}
            <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar select-text"
                onScroll={(e) => {
                    const target = e.currentTarget;
                    const isAtTop = target.scrollTop === 0;
                    setAutoScroll(isAtTop);
                }}
            >
                {filteredLogs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-30 pointer-events-none">
                        <i className="fa fa-microchip text-4xl mb-3" />
                        <p className="text-sm italic">Esperando eventos de diagnóstico...</p>
                    </div>
                ) : (
                    filteredLogs.map((log) => (
                        <div 
                            key={log.id} 
                            onClick={() => setSelectedLog(log)}
                            className={cn(
                                "p-3 rounded-lg border flex flex-col gap-1.5 transition-all duration-200 hover:bg-white/5 group cursor-pointer",
                                LOG_COLORS[log.category] || DEFAULT_COLOR
                            )}
                        >
                            <div className="flex items-center justify-between text-[10px] font-mono opacity-60">
                                <span className="font-bold tracking-tighter uppercase">{log.category}</span>
                                <span>{new Date(log.ts).toLocaleTimeString()}</span>
                            </div>
                            <div className="text-xs font-mono break-all leading-relaxed whitespace-pre-wrap selection:bg-white/20">
                                {truncateMessage(log.message)}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-white/10 bg-zinc-950 flex justify-between items-center text-[10px] text-zinc-500">
                <span>{filteredLogs.length} eventos coinciden con los filtros</span>
                <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                        <div className={cn("w-1.5 h-1.5 rounded-full", autoScroll ? "bg-emerald-500" : "bg-zinc-600")} />
                        En vivo
                    </span>
                </div>
            </div>
            <LogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />
        </div>
    );
});

DebugLogWidget.displayName = "DebugLogWidget";
