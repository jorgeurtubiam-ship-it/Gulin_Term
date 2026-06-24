// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { cn } from "@/util/util";
import {
    type DebugLogEntry,
    LOG_COLORS,
    DEFAULT_COLOR,
    LOG_ICONS,
    maskSensitiveData,
} from "@/app/types/debuglog";

interface LogDetailModalProps {
    log: DebugLogEntry | null;
    onClose: () => void;
}

/**
 * Modal compartido para mostrar detalles completos de un log de depuración.
 * Usa backdrop-blur-md, bg-zinc-900 y rounded-[2rem] siguiendo la línea visual del Mapa de Servicios.
 */
export function LogDetailModal({ log, onClose }: LogDetailModalProps) {
    const [copied, setCopied] = React.useState(false);

    // Cerrar con Escape
    React.useEffect(() => {
        if (!log) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [log, onClose]);

    if (!log) return null;

    const colorClass = LOG_COLORS[log.category] || DEFAULT_COLOR;
    const icon = LOG_ICONS[log.category] || "fa-bug";
    const timestamp = new Date(log.ts);
    const formattedDate = timestamp.toLocaleDateString("es-ES", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
    const formattedTime = timestamp.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
    const relativeTime = getRelativeTime(log.ts);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(log.message);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // fallback
        }
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md bg-black/60"
            onClick={onClose}
        >
            <div
                className="bg-zinc-900 border border-white/10 w-full max-w-3xl rounded-[2rem] p-8 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <div
                            className={cn(
                                "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl",
                                colorClass
                            )}
                        >
                            <i className={`fa ${icon}`} />
                        </div>
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <span
                                    className={cn(
                                        "text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-md border",
                                        colorClass
                                    )}
                                >
                                    {log.category}
                                </span>
                                {log.status && (
                                    <span
                                        className={cn(
                                            "text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ml-2",
                                            log.status === 'success'
                                                ? "text-green-400 border-green-500/30 bg-green-500/10"
                                                : "text-red-400 border-red-500/30 bg-red-500/10"
                                        )}
                                    >
                                        <i className={`fa ${log.status === 'success' ? 'fa-check-circle' : 'fa-times-circle'} mr-1`} />
                                        {log.status}
                                    </span>
                                )}
                                {log.durationMs !== undefined && (
                                    <span className="text-[10px] font-mono text-zinc-500 ml-2">
                                        <i className="fa fa-clock mr-1" />
                                        {log.durationMs < 1000
                                            ? `${log.durationMs}ms`
                                            : `${(log.durationMs / 1000).toFixed(2)}s`}
                                    </span>
                                )}
                                {log.toolName && (
                                    <span className="text-[10px] font-mono text-zinc-600 ml-2">
                                        <i className="fa fa-wrench mr-1" />
                                        {log.toolName}
                                    </span>
                                )}
                                <span className="text-[10px] font-mono text-zinc-500">
                                    {log.id.substring(0, 8)}
                                </span>
                            </div>
                            <p className="text-zinc-400 text-xs font-mono">
                                {formattedDate} &middot; {formattedTime}
                                <span className="text-zinc-600 ml-2">
                                    ({relativeTime})
                                </span>
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCopy}
                            className={cn(
                                "p-2.5 rounded-xl transition-colors",
                                copied
                                    ? "bg-emerald-500/20 text-emerald-400"
                                    : "hover:bg-white/5 text-zinc-400 hover:text-white"
                            )}
                            title="Copiar mensaje"
                        >
                            <i
                                className={`fa ${
                                    copied ? "fa-check" : "fa-copy"
                                } text-sm`}
                            />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2.5 rounded-xl hover:bg-white/5 transition-colors text-zinc-400 hover:text-white"
                            title="Cerrar"
                        >
                            <i className="fa fa-times text-lg" />
                        </button>
                    </div>
                </div>

                {/* Message Body */}
                <div className="flex-1 overflow-y-auto min-h-0">
                    <div
                        className={cn(
                            "p-6 rounded-2xl border font-mono text-sm leading-relaxed whitespace-pre-wrap break-all select-text",
                            colorClass
                        )}
                    >
                        {maskSensitiveData(log.message)}
                    </div>
                    {log.errorContext && (
                        <div className="mt-3 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-red-400 mb-2">
                                <i className="fa fa-exclamation-triangle mr-1" />
                                Contexto del Error
                            </p>
                            <pre className="text-xs font-mono text-red-300/80 whitespace-pre-wrap break-all">
                                {maskSensitiveData(log.errorContext)}
                            </pre>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="mt-4 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-8 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 font-bold rounded-xl transition-colors uppercase text-xs tracking-widest"
                    >
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Calcula tiempo relativo humano (ej: "hace 2 min").
 */
function getRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 5) return "ahora";
    if (seconds < 60) return `hace ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `hace ${minutes}min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours}h`;
    const days = Math.floor(hours / 24);
    return `hace ${days}d`;
}
