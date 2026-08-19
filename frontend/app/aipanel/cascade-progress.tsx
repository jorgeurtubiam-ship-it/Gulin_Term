// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { memo, useEffect, useState } from "react";
import { cn } from "@/util/util";

export interface CascadeStep {
    id: string;
    label: string;
    target?: string;
    status: "pending" | "running" | "completed" | "error";
    detail?: string;
}

export interface CascadeProgressProps {
    title?: string;
    steps?: CascadeStep[];
    isStreaming?: boolean;
}

export const CascadeProgress = memo(({
    title = "SISTEMA DE DIAGNÓSTICO & TELEMETRÍA",
    steps = [],
    isStreaming = true,
}: CascadeProgressProps) => {
    const [visibleCount, setVisibleCount] = useState(1);

    // Efecto de escala progresiva escalonada
    useEffect(() => {
        if (!steps || steps.length === 0) return;
        const interval = setInterval(() => {
            setVisibleCount((prev) => (prev < steps.length ? prev + 1 : prev));
        }, 220);
        return () => clearInterval(interval);
    }, [steps]);

    if (!steps || steps.length === 0) {
        return (
            <div className="my-2 p-3 rounded-xl bg-zinc-950/70 border border-teal-500/20 shadow-lg flex items-center gap-3 backdrop-blur-md">
                <div className="relative flex items-center justify-center w-5 h-5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-40"></span>
                    <i className="fa-solid fa-circle-notch animate-spin text-teal-400 text-xs"></i>
                </div>
                <span className="text-xs font-mono text-teal-300/90 tracking-wide animate-pulse">
                    Recolectando telemetría y correlacionando fuentes...
                </span>
            </div>
        );
    }

    return (
        <div className="my-2 rounded-xl bg-zinc-950/90 border border-teal-500/25 overflow-hidden shadow-xl backdrop-blur-md transition-all duration-300">
            {/* Header con brillo futurista sutil */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-gradient-to-r from-teal-950/50 via-zinc-900/50 to-zinc-950/80 border-b border-teal-500/15">
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_6px_#2dd4bf] animate-pulse" />
                    <span className="text-[9px] font-mono font-bold tracking-widest text-teal-300 uppercase">
                        {title}
                    </span>
                </div>
                {isStreaming && (
                    <div className="flex items-center gap-1 text-[8px] font-mono text-teal-400/80 bg-teal-500/10 px-1.5 py-0.5 rounded-full border border-teal-500/20">
                        <i className="fa-solid fa-bolt text-[7px] animate-bounce"></i>
                        <span>EN VIVO</span>
                    </div>
                )}
            </div>

            {/* Lista compacta de pasos recientes (máximo 3) */}
            <div className="p-2 space-y-1 font-mono text-xs">
                {steps.slice(0, visibleCount).map((step, idx) => {
                    const isLast = idx === visibleCount - 1 && isStreaming;
                    const isDone = step.status === "completed" || (!isLast && isStreaming);

                    return (
                        <div
                            key={step.id || idx}
                            className={cn(
                                "flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all duration-200",
                                isLast
                                    ? "bg-teal-950/30 border border-teal-500/30 translate-x-0.5 shadow-[0_0_8px_rgba(45,212,191,0.08)]"
                                    : "bg-zinc-900/40 border border-white/5 opacity-80"
                            )}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                {isDone ? (
                                    <div className="flex-shrink-0 w-3.5 h-3.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 text-[8px]">
                                        <i className="fa-solid fa-check"></i>
                                    </div>
                                ) : (
                                    <div className="flex-shrink-0 w-3.5 h-3.5 rounded-full bg-teal-500/20 border border-teal-400/50 flex items-center justify-center text-teal-300 text-[8px]">
                                        <i className="fa-solid fa-circle-notch animate-spin text-[8px]"></i>
                                    </div>
                                )}
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span className={cn(
                                        "font-medium text-[10px] truncate",
                                        isDone ? "text-zinc-300" : "text-teal-200"
                                    )}>
                                        {step.label}
                                    </span>
                                    {step.target && (
                                        <span className="text-[9px] text-zinc-500 truncate max-w-[200px]">
                                            · <span className="text-zinc-400 font-mono">{step.target}</span>
                                        </span>
                                    )}
                                </div>
                            </div>

                            {step.detail && (
                                <div className="text-[9px] text-right text-zinc-400 bg-zinc-900/80 px-1.5 py-0.5 rounded border border-white/5 font-mono ml-2 shrink-0">
                                    {step.detail}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

CascadeProgress.displayName = "CascadeProgress";
