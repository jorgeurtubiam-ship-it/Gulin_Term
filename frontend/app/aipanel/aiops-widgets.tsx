// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { memo } from "react";
import { cn } from "@/util/util";

// ==========================================
// 1. AUTO-BADGE & STATUS PILLS
// ==========================================
export interface StatusBadgeProps {
    status: string;
    variant?: "auto" | "danger" | "warning" | "success" | "neutral";
    size?: "xs" | "sm";
    icon?: string;
}

export const StatusBadge = memo(({ status, variant = "auto", size = "xs", icon }: StatusBadgeProps) => {
    if (!status) return null;
    const s = status.trim().toLowerCase();

    let computedVariant = variant;
    if (variant === "auto") {
        if (s.includes("saturado") || s.includes("full") || s.includes("error") || s.includes("falla") || s.includes("critico") || s.includes("danger") || s.includes("bloqueado")) {
            computedVariant = "danger";
        } else if (s.includes("revisar") || s.includes("warning") || s.includes("alto") || s.includes("alerta") || s.includes("intermitente") || s.includes("inactivo")) {
            computedVariant = "warning";
        } else if (s.includes("running") || s.includes("ok") || s.includes("activo") || s.includes("exito") || s.includes("0") || s.includes("saludable")) {
            computedVariant = "success";
        } else {
            computedVariant = "neutral";
        }
    }

    const colorClasses = {
        danger: "bg-red-500/15 text-red-400 border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.15)]",
        warning: "bg-amber-500/15 text-amber-300 border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.15)]",
        success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.15)]",
        neutral: "bg-zinc-800/80 text-zinc-300 border-zinc-700/50",
    }[computedVariant];

    const dotColors = {
        danger: "bg-red-400 animate-pulse",
        warning: "bg-amber-400",
        success: "bg-emerald-400",
        neutral: "bg-zinc-400",
    }[computedVariant];

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 font-mono font-medium rounded-full border px-2 py-0.5 whitespace-nowrap transition-all",
                size === "xs" ? "text-[10px] leading-tight" : "text-xs px-2.5 py-0.5",
                colorClasses
            )}
        >
            <span className={cn("w-1.5 h-1.5 rounded-full inline-block shrink-0", dotColors)} />
            {icon && <i className={cn(icon, "text-[9px]")} />}
            <span>{status}</span>
        </span>
    );
});

StatusBadge.displayName = "StatusBadge";

// ==========================================
// 2. INFRASTRUCTURE 2X2 CARDS GRID
// ==========================================
export interface InfraCardItem {
    title: string;
    metrics: Array<{
        label: string;
        value: string;
        badge?: string;
        progress?: {
            current: number;
            total: number;
            percent?: number;
            color?: "red" | "yellow" | "green" | "teal";
        };
    }>;
}

export interface InfraGridWidgetProps {
    title?: string;
    metadata?: {
        db?: string;
        os?: string;
        release?: string;
    };
    cards: InfraCardItem[];
}

export const InfraGridWidget = memo(({ metadata, cards }: InfraGridWidgetProps) => {
    if (!cards || cards.length === 0) return null;

    return (
        <div className="w-full my-3 rounded-2xl bg-zinc-950/90 border border-zinc-800/80 overflow-hidden shadow-2xl backdrop-blur-xl">
            {/* Header Metadata Bar */}
            {metadata && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-4 py-2.5 bg-zinc-900/60 border-b border-zinc-800/60 text-[11px] font-mono">
                    {metadata.db && (
                        <div className="flex items-center gap-2 text-zinc-400 truncate">
                            <span className="text-zinc-500">Base de datos:</span>
                            <span className="text-zinc-200 font-semibold">{metadata.db}</span>
                        </div>
                    )}
                    {metadata.os && (
                        <div className="flex items-center gap-2 text-zinc-400 truncate">
                            <span className="text-zinc-500">Sistema operativo:</span>
                            <span className="text-zinc-200 font-semibold">{metadata.os}</span>
                        </div>
                    )}
                    {metadata.release && (
                        <div className="flex items-center gap-2 text-zinc-400 truncate">
                            <span className="text-zinc-500">Última release:</span>
                            <span className="text-zinc-200 font-semibold">{metadata.release}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Grid 2x2 of Telemetry Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3.5 bg-gradient-to-b from-zinc-950/40 to-black/60">
                {cards.map((card, idx) => (
                    <div
                        key={idx}
                        className="rounded-xl bg-zinc-900/40 border border-zinc-800/70 p-3.5 hover:border-zinc-700/80 transition-all duration-300 flex flex-col justify-between space-y-2.5 shadow-lg group hover:shadow-teal-500/5"
                    >
                        <div className="flex items-center justify-between border-b border-zinc-800/50 pb-2">
                            <span className="text-xs font-mono font-bold tracking-wider text-zinc-300 uppercase flex items-center gap-2">
                                <i className="fa-solid fa-server text-[11px] text-teal-400/80 group-hover:text-teal-300 transition-colors" />
                                {card.title}
                            </span>
                        </div>

                        <div className="space-y-2 font-mono text-xs">
                            {card.metrics.map((m, mIdx) => {
                                const progressPct = m.progress
                                    ? m.progress.percent ?? Math.round((m.progress.current / m.progress.total) * 100)
                                    : null;

                                const barColorClass =
                                    progressPct && progressPct >= 85
                                        ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                                        : progressPct && progressPct >= 70
                                        ? "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                                        : "bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.4)]";

                                return (
                                    <div key={mIdx} className="space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-zinc-400 text-[11px]">{m.label}</span>
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-zinc-100 text-[11px]">{m.value}</span>
                                                {m.badge && <StatusBadge status={m.badge} />}
                                            </div>
                                        </div>

                                        {progressPct !== null && (
                                            <div className="w-full bg-zinc-800/80 h-1.5 rounded-full overflow-hidden">
                                                <div
                                                    className={cn("h-full rounded-full transition-all duration-500", barColorClass)}
                                                    style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});

InfraGridWidget.displayName = "InfraGridWidget";

// ==========================================
// 3. EXECUTION PLAN & SQL DIAGNOSTIC WIDGET
// ==========================================
export interface PlanStepItem {
    id: string | number;
    operation: string;
    object?: string;
    rows?: string | number;
    cost?: string | number;
    time?: string;
    isBottleneck?: boolean;
}

export interface ExecutionPlanWidgetProps {
    sqlQuery?: string;
    steps: PlanStepItem[];
    metrics?: {
        p95Time?: string;
        bufferGets?: string | number;
        executionsPerHour?: string | number;
    };
}

export const ExecutionPlanWidget = memo(({ sqlQuery, steps, metrics }: ExecutionPlanWidgetProps) => {
    return (
        <div className="w-full my-3 space-y-2.5">
            {/* SQL Block */}
            {sqlQuery && (
                <div className="rounded-xl bg-zinc-950/90 border border-zinc-800/80 overflow-hidden shadow-xl">
                    <div className="px-3.5 py-1.5 bg-zinc-900/60 border-b border-zinc-800/60 flex items-center justify-between">
                        <span className="text-[10px] font-mono font-bold tracking-wider text-zinc-400 uppercase">
                            QUERY CAPTURADA
                        </span>
                        <i className="fa-solid fa-code text-[10px] text-zinc-500"></i>
                    </div>
                    <pre className="p-3 text-xs font-mono text-teal-200/90 overflow-x-auto bg-black/40 leading-relaxed">
                        {sqlQuery}
                    </pre>
                </div>
            )}

            {/* Plan Table */}
            <div className="rounded-xl bg-zinc-950/90 border border-zinc-800/80 overflow-hidden shadow-2xl">
                <div className="px-3.5 py-2 bg-zinc-900/60 border-b border-zinc-800/60 flex items-center justify-between">
                    <span className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase flex items-center gap-2">
                        <i className="fa-solid fa-sitemap text-teal-400 text-xs"></i>
                        PLAN DE EJECUCIÓN ACTUAL
                    </span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-xs border-collapse">
                        <thead>
                            <tr className="border-b border-zinc-800/80 bg-zinc-900/40 text-[10px] uppercase text-zinc-400 tracking-wider">
                                <th className="py-2 px-3 w-8">#</th>
                                <th className="py-2 px-3">OPERACIÓN</th>
                                <th className="py-2 px-3">OBJETO</th>
                                <th className="py-2 px-3 text-right">ROWS</th>
                                <th className="py-2 px-3 text-right">COST</th>
                                <th className="py-2 px-3 text-right">TIME</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/40">
                            {steps.map((s, idx) => {
                                const isFullScan =
                                    s.isBottleneck ||
                                    s.operation.toUpperCase().includes("TABLE ACCESS FULL") ||
                                    s.operation.toUpperCase().includes("FULL SCAN");

                                return (
                                    <tr
                                        key={idx}
                                        className={cn(
                                            "transition-colors hover:bg-zinc-800/30",
                                            isFullScan ? "bg-red-950/15" : ""
                                        )}
                                    >
                                        <td className="py-2 px-3 text-zinc-500 font-bold">{s.id}</td>
                                        <td className="py-2 px-3">
                                            {isFullScan ? (
                                                <StatusBadge status={s.operation} variant="danger" size="xs" />
                                            ) : (
                                                <span className="text-zinc-200 font-medium">{s.operation}</span>
                                            )}
                                        </td>
                                        <td className="py-2 px-3 font-semibold text-zinc-300">
                                            {s.object || "—"}
                                        </td>
                                        <td className="py-2 px-3 text-right text-zinc-400">{s.rows ?? "—"}</td>
                                        <td className="py-2 px-3 text-right text-zinc-400">{s.cost ?? "—"}</td>
                                        <td className="py-2 px-3 text-right text-zinc-400">{s.time ?? "—"}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Footer Metrics */}
                {metrics && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-4 py-2.5 bg-zinc-900/60 border-t border-zinc-800/80 text-[11px] font-mono">
                        {metrics.p95Time && (
                            <div className="flex items-center justify-between sm:justify-start gap-2">
                                <span className="text-zinc-500">Tiempo total observado (p95):</span>
                                <span className="text-amber-400 font-bold">{metrics.p95Time}</span>
                            </div>
                        )}
                        {metrics.bufferGets && (
                            <div className="flex items-center justify-between sm:justify-start gap-2">
                                <span className="text-zinc-500">Buffer gets por ejecución:</span>
                                <span className="text-zinc-200 font-bold">{metrics.bufferGets}</span>
                            </div>
                        )}
                        {metrics.executionsPerHour && (
                            <div className="flex items-center justify-between sm:justify-start gap-2">
                                <span className="text-zinc-500">Ejecuciones/hora:</span>
                                <span className="text-zinc-200 font-bold">{metrics.executionsPerHour}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

ExecutionPlanWidget.displayName = "ExecutionPlanWidget";

// ==========================================
// 4. SLA & SERVICES TABLE WIDGET
// ==========================================
export interface SlaServiceItem {
    name: string;
    availability?: string;
    requests?: string;
    errors?: string;
    latencyP95?: string;
    incidentsCount?: number;
}

export interface TimelineEventItem {
    time: string;
    service?: string;
    description: string;
}

export interface SlaReportWidgetProps {
    title?: string;
    window?: string;
    services: SlaServiceItem[];
    events?: TimelineEventItem[];
}

export const SlaReportWidget = memo(({ title = "Reporte de Comportamiento", window, services, events }: SlaReportWidgetProps) => {
    return (
        <div className="w-full my-3 space-y-3">
            {/* Table of Services */}
            <div className="rounded-xl bg-zinc-950/90 border border-zinc-800/80 overflow-hidden shadow-2xl">
                <div className="px-4 py-2.5 bg-zinc-900/70 border-b border-zinc-800/80 flex items-center justify-between">
                    <div>
                        <span className="text-xs font-mono font-bold text-zinc-100 flex items-center gap-2">
                            <i className="fa-solid fa-chart-line text-teal-400"></i>
                            {title}
                        </span>
                        {window && <span className="text-[10px] font-mono text-zinc-400 block mt-0.5">{window}</span>}
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-xs border-collapse">
                        <thead>
                            <tr className="border-b border-zinc-800/80 bg-zinc-900/40 text-[10px] uppercase text-zinc-400 tracking-wider">
                                <th className="py-2 px-3">APLICATIVO</th>
                                <th className="py-2 px-3 text-right">DISPONIBILIDAD</th>
                                <th className="py-2 px-3 text-right">REQ TOTALES</th>
                                <th className="py-2 px-3 text-right">ERRORES</th>
                                <th className="py-2 px-3 text-right">LATENCIA P95</th>
                                <th className="py-2 px-3 text-center">INCIDENTES</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/40">
                            {services.map((svc, idx) => {
                                const incidents = svc.incidentsCount ?? 0;
                                const incidentBadgeVariant = incidents === 0 ? "success" : incidents < 3 ? "warning" : "danger";

                                return (
                                    <tr key={idx} className="hover:bg-zinc-800/30 transition-colors">
                                        <td className="py-2.5 px-3 font-semibold text-zinc-200">{svc.name}</td>
                                        <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">{svc.availability ?? "—"}</td>
                                        <td className="py-2.5 px-3 text-right text-zinc-300">{svc.requests ?? "—"}</td>
                                        <td className="py-2.5 px-3 text-right text-zinc-300">{svc.errors ?? "—"}</td>
                                        <td className="py-2.5 px-3 text-right text-amber-300">{svc.latencyP95 ?? "—"}</td>
                                        <td className="py-2.5 px-3 text-center">
                                            <StatusBadge
                                                status={`${incidents}`}
                                                variant={incidentBadgeVariant}
                                                size="xs"
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Events Timeline */}
            {events && events.length > 0 && (
                <div className="rounded-xl bg-zinc-950/80 border border-zinc-800/80 p-3 shadow-lg">
                    <span className="text-[10px] font-mono font-bold tracking-wider text-zinc-400 uppercase block mb-2">
                        EVENTOS DESTACADOS
                    </span>
                    <div className="space-y-1.5 font-mono text-xs">
                        {events.map((ev, idx) => (
                            <div key={idx} className="flex items-start gap-2.5 p-1.5 rounded-lg bg-zinc-900/40 border border-white/5">
                                <span className="text-teal-400/90 text-[11px] font-semibold shrink-0">{ev.time}</span>
                                {ev.service && (
                                    <span className="text-zinc-500 shrink-0">[{ev.service}]</span>
                                )}
                                <span className="text-zinc-300 text-[11px]">{ev.description}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});

SlaReportWidget.displayName = "SlaReportWidget";

// ==========================================
// 5. UNIVERSAL KPI SUMMARY CARDS (O365, FINOPS, AWS)
// ==========================================
export interface KpiMetric {
    label: string;
    value: string;
    sublabel?: string;
    variant?: "danger" | "warning" | "success" | "teal" | "neutral";
    icon?: string;
}

export interface KpiSummaryWidgetProps {
    title?: string;
    kpis: KpiMetric[];
}

export const KpiSummaryWidget = memo(({ title, kpis }: KpiSummaryWidgetProps) => {
    if (!kpis || kpis.length === 0) return null;

    return (
        <div className="w-full my-3 space-y-2">
            {title && (
                <span className="text-[11px] font-mono font-bold tracking-wider text-zinc-300 uppercase block px-1">
                    {title}
                </span>
            )}
            <div className={cn(
                "grid gap-2.5",
                kpis.length === 2 ? "grid-cols-2" : kpis.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4"
            )}>
                {kpis.map((kpi, idx) => {
                    const colorClasses = {
                        danger: "border-red-500/30 bg-red-950/20 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.1)]",
                        warning: "border-amber-500/30 bg-amber-950/20 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.1)]",
                        success: "border-emerald-500/30 bg-emerald-950/20 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.1)]",
                        teal: "border-teal-500/30 bg-teal-950/20 text-teal-300 shadow-[0_0_12px_rgba(45,212,191,0.1)]",
                        neutral: "border-zinc-800 bg-zinc-900/50 text-zinc-200",
                    }[kpi.variant || "neutral"];

                    return (
                        <div
                            key={idx}
                            className={cn(
                                "p-3 rounded-xl border flex flex-col justify-between transition-all duration-300 hover:scale-[1.02]",
                                colorClasses
                            )}
                        >
                            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 mb-1">
                                <span className="truncate">{kpi.label}</span>
                                {kpi.icon && <i className={cn(kpi.icon, "text-xs opacity-75")} />}
                            </div>
                            <div className="text-xl font-bold font-mono tracking-tight">{kpi.value}</div>
                            {kpi.sublabel && (
                                <div className="text-[9px] font-mono text-zinc-500 mt-1 truncate">{kpi.sublabel}</div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

KpiSummaryWidget.displayName = "KpiSummaryWidget";
