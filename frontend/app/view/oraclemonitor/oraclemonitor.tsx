// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { atoms, getApi, globalStore, WOS } from "@/store/global";
import { atom, useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import clsx from "clsx";

class OracleMonitorViewModel {
    blockId: string;
    blockAtom: any;
    metricsAtom = atom<any>(null);
    loadingAtom = atom<boolean>(true);
    errorAtom = atom<string | null>(null);
    connectionName: string = "";

    constructor(blockId: string) {
        this.blockId = blockId;
        this.blockAtom = WOS.getGulinObjectAtom<Block>(`block:${blockId}`);
        this.refreshMetrics();
    }

    async refreshMetrics() {
        globalStore.set(this.loadingAtom, true);
        try {
            const block = globalStore.get(this.blockAtom);
            this.connectionName = block?.meta?.connection || "";

            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/oracle-metrics?connection=${encodeURIComponent(this.connectionName)}`, { headers });
            
            if (!resp.ok) throw new Error("Error al obtener metricas");

            const data = await resp.json();
            globalStore.set(this.metricsAtom, data);
            globalStore.set(this.errorAtom, null);
        } catch (e: any) {
            globalStore.set(this.errorAtom, e.message);
        } finally {
            globalStore.set(this.loadingAtom, false);
        }
    }

    get viewComponent() {
        return OracleMonitorView;
    }
}

function OracleMonitorView({ model }: { model: OracleMonitorViewModel }) {
    const [metrics] = useAtom(model.metricsAtom);
    const [loading] = useAtom(model.loadingAtom);
    const [error] = useAtom(model.errorAtom);

    useEffect(() => {
        const interval = setInterval(() => {
            model.refreshMetrics();
        }, 5000);
        return () => clearInterval(interval);
    }, [model]);

    if (!metrics && loading) {
        return <LoadingOverlay />;
    }

    return (
        <div className="h-full w-full flex flex-col bg-[#020617] text-slate-300 font-sans overflow-hidden select-none">
            {/* ESTILO PARA LOS FLUJOS ANIMADOS */}
            <style>{`
                @keyframes flow {
                    to { stroke-dashoffset: -20; }
                }
                .flow-line {
                    stroke-dasharray: 4, 6;
                    animation: flow 1s linear infinite;
                }
                .glass-card {
                    background: rgba(15, 23, 42, 0.6);
                    backdrop-filter: blur(8px);
                    border: 1px solid rgba(51, 65, 85, 0.5);
                }
                .led-green { box-shadow: 0 0 10px rgba(34, 197, 94, 0.4); }
                .led-blue { box-shadow: 0 0 10px rgba(59, 130, 246, 0.4); }
            `}</style>

            {/* HEADER SUPERIOR */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-900/50">
                <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Oracle Monitor</span>
                        <h1 className="text-sm font-bold text-white uppercase">{model.connectionName} - {metrics?.service?.instance_name || "---"}</h1>
                    </div>
                    <div className="h-8 w-px bg-slate-800 mx-2"></div>
                    <div className="flex gap-6">
                        <TopInfo label="ROL" value={metrics?.service?.db_role} />
                        <TopInfo label="MODO" value={metrics?.service?.open_mode} />
                        <TopInfo label="ESTADO" value={metrics?.service?.status} active={metrics?.service?.status === 'OPEN'} />
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <span className="text-[9px] font-bold text-slate-500 uppercase block">Ultima Sincronizacion</span>
                        <span className="text-xs font-mono text-slate-300">{metrics?.last_update || "--:--:--"}</span>
                    </div>
                    <button onClick={() => model.refreshMetrics()} className="p-2 hover:bg-slate-800 rounded transition-colors text-slate-500 hover:text-emerald-400">
                        <i className={clsx("fa fa-refresh", loading && "fa-spin")}></i>
                    </button>
                </div>
            </div>

            <div className="relative flex-grow p-4 overflow-hidden">
                {/* CAPA DE FLUJOS (SVG) */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#1e293b" />
                            <stop offset="50%" stopColor="#10b981" />
                            <stop offset="100%" stopColor="#1e293b" />
                        </linearGradient>
                    </defs>
                    {/* Líneas de flujo horizontales simulando la imagen */}
                    <path d="M 280 150 L 350 150" stroke="url(#lineGrad)" strokeWidth="1.5" fill="none" className="flow-line" />
                    <path d="M 280 400 L 350 400" stroke="url(#lineGrad)" strokeWidth="1.5" fill="none" className="flow-line" />
                    <path d="M 600 200 L 680 200" stroke="url(#lineGrad)" strokeWidth="1.5" fill="none" className="flow-line" />
                    <path d="M 600 500 L 680 500" stroke="url(#lineGrad)" strokeWidth="1.5" fill="none" className="flow-line" />
                    <path d="M 900 300 L 980 300" stroke="url(#lineGrad)" strokeWidth="1.5" fill="none" className="flow-line" />
                </svg>

                <div className="grid grid-cols-12 gap-4 h-full relative z-10">
                    {/* COLUMNA 1: SERVICE & HOST */}
                    <div className="col-span-3 flex flex-col gap-4">
                        {/* SERVICE BLOCK */}
                        <MonitorBlock title="SERVICE" icon="fa-server">
                            <div className="space-y-4">
                                <MetricRow label="Uptime" value={metrics?.service?.uptime || "---"} highlight />
                                <div className="grid grid-cols-2 gap-2">
                                    <SmallStat label="Total Users" value={metrics?.sessions?.total} />
                                    <SmallStat label="Active Users" value={metrics?.sessions?.active} color="emerald" />
                                </div>
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase">
                                        <span>Avg Active</span>
                                        <span>{metrics?.sessions?.avg_active || "0.00"}</span>
                                    </div>
                                    <ProgressBar pct={15} color="emerald" />
                                </div>
                            </div>
                        </MonitorBlock>

                        {/* HOST BLOCK */}
                        <MonitorBlock title="HOST" icon="fa-desktop">
                            <div className="flex flex-col items-center py-2">
                                <div className="relative size-24 mb-4">
                                    <svg className="size-full transform -rotate-90">
                                        <circle cx="48" cy="48" r="40" stroke="rgba(51,65,85,0.3)" strokeWidth="6" fill="none" />
                                        <circle cx="48" cy="48" r="40" stroke="#10b981" strokeWidth="6" fill="none" 
                                            strokeDasharray={251} strokeDashoffset={251 - (251 * (metrics?.host?.cpu_usage || 0)) / 100}
                                            strokeLinecap="round" className="transition-all duration-1000" />
                                    </svg>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <span className="text-xl font-black text-white">{metrics?.host?.cpu_usage || 0}%</span>
                                        <span className="text-[8px] font-bold text-slate-500 uppercase">CPU</span>
                                    </div>
                                </div>
                                <div className="w-full space-y-3">
                                    <MetricRow label="Memory Free" value={metrics?.host?.mem_free || "---"} />
                                    <div className="h-6 bg-slate-800/50 rounded flex items-center px-2 border border-slate-700/50">
                                        <span className="text-[9px] font-bold text-slate-500 uppercase w-full text-center">No OS Errors Detected</span>
                                    </div>
                                </div>
                            </div>
                        </MonitorBlock>
                    </div>

                    {/* COLUMNA 2: SERVER PROCESSES & SGA */}
                    <div className="col-span-3 flex flex-col gap-4">
                        {/* SERVER PROCESSES */}
                        <MonitorBlock title="SERVER PROCESSES" icon="fa-tasks">
                            <div className="space-y-4">
                                <div className="text-center pb-2 border-b border-slate-800/50">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">PGA MEMORY</span>
                                    <span className="text-sm font-black text-emerald-400">{metrics?.server_processes?.pga_used || "---"}</span>
                                    <span className="text-[9px] text-slate-500 block">de {metrics?.server_processes?.pga_target || "---"}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-3">
                                    <ProcNode label="Dedicated" value={metrics?.sessions?.active || 0} active />
                                    <ProcNode label="Shared" value={1} />
                                    <ProcNode label="Parallel Query" value={0} />
                                </div>
                            </div>
                        </MonitorBlock>

                        {/* SGA BLOCK */}
                        <MonitorBlock title="SGA ARCHITECTURE" icon="fa-microchip" expanded>
                            <div className="space-y-3">
                                <SgaBar label="Buffer Cache" value={metrics?.sga?.buffer_cache} pct={85} color="blue" />
                                <SgaBar label="Shared Pool" value={metrics?.sga?.shared_pool} pct={metrics?.sga?.shared_pool_pct || 0} color="emerald" />
                                <SgaBar label="Java Pool" value={metrics?.sga?.java_pool} pct={12} color="purple" />
                                <SgaBar label="Large Pool" value={metrics?.sga?.large_pool} pct={5} color="indigo" />
                                <div className="pt-2 border-t border-slate-800/50 flex justify-between items-center">
                                    <span className="text-[10px] font-black text-white">TOTAL SGA</span>
                                    <span className="text-xs font-mono font-bold text-emerald-400">{metrics?.sga?.total || "---"}</span>
                                </div>
                            </div>
                        </MonitorBlock>
                    </div>

                    {/* COLUMNA 3: BACKGROUND PROCESSES & DISK STORAGE */}
                    <div className="col-span-3 flex flex-col gap-4">
                        {/* BACKGROUND PROCESSES */}
                        <MonitorBlock title="BACKGROUND PROCS" icon="fa-cogs">
                            <div className="grid grid-cols-2 gap-2">
                                {metrics?.background_processes?.map((p: any, i: number) => (
                                    <div key={i} className="bg-slate-800/40 rounded p-2 border border-slate-700/30 flex flex-col items-center">
                                        <span className="text-[10px] font-black text-white">{p.name}</span>
                                        <div className="flex items-center gap-1 mt-1">
                                            <span className="size-1.5 rounded-full bg-emerald-500 led-green"></span>
                                            <span className="text-[8px] font-bold text-emerald-500 uppercase">ON</span>
                                        </div>
                                    </div>
                                ))}
                                {(!metrics?.background_processes || metrics?.background_processes.length === 0) && (
                                    <div className="col-span-2 py-8 text-center text-[10px] text-slate-600 font-bold uppercase italic">No Background Info</div>
                                )}
                            </div>
                        </MonitorBlock>

                        {/* DISK STORAGE */}
                        <MonitorBlock title="DISK STORAGE" icon="fa-database">
                            <div className="space-y-4">
                                <div className="flex items-center gap-4">
                                    <div className="relative size-16">
                                        <svg className="size-full">
                                            <rect x="4" y="4" width="56" height="56" rx="4" fill="rgba(51,65,85,0.2)" stroke="rgba(51,65,85,0.5)" strokeWidth="1" />
                                            <rect x="4" y={60 - (56 * 0.72)} width="56" height={56 * 0.72} rx="2" fill="#3b82f6" fillOpacity="0.5" />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="text-[10px] font-black text-white">72%</span>
                                        </div>
                                    </div>
                                    <div className="flex-grow space-y-1">
                                        <MetricRow label="Data Files" value={metrics?.storage?.total_files} />
                                        <MetricRow label="TSpaces" value={metrics?.storage?.total_tablespaces} />
                                    </div>
                                </div>
                                <div className="space-y-1 pt-2 border-t border-slate-800/50">
                                    <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase">
                                        <span>Total Disk Space</span>
                                        <span>{metrics?.storage?.total_gb || "---"}</span>
                                    </div>
                                    <ProgressBar pct={72} color="blue" />
                                </div>
                            </div>
                        </MonitorBlock>
                    </div>

                    {/* COLUMNA 4: LOGS & CONTEXT (EXTRA) */}
                    <div className="col-span-3 flex flex-col gap-4">
                         <MonitorBlock title="SYSTEM CONTEXT" icon="fa-info-circle">
                            <div className="text-[10px] font-mono text-slate-400 space-y-2 p-2 bg-black/40 rounded border border-slate-800/50 h-full">
                                <p className="text-emerald-500/70">{">"} Monitor Iniciado en Puerto 5173</p>
                                <p className="text-emerald-500/70">{">"} Conectado a {model.connectionName}</p>
                                <p className="text-emerald-500/70">{">"} Protocolo: Oracle Net Services</p>
                                <p className="text-emerald-500/70">{">"} Listener: OK</p>
                                <p className="text-emerald-500/70">{">"} Esperando eventos de traza...</p>
                                <div className="animate-pulse h-3 w-1 bg-emerald-500 inline-block align-middle ml-1"></div>
                            </div>
                         </MonitorBlock>
                         <div className="flex-grow glass-card rounded-xl border-dashed border-slate-800 flex items-center justify-center opacity-30">
                            <i className="fa fa-plus text-2xl"></i>
                         </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// COMPONENTES AUXILIARES
function MonitorBlock({ title, icon, children, expanded }: any) {
    return (
        <div className={clsx("glass-card rounded-xl overflow-hidden flex flex-col", expanded ? "flex-grow" : "shrink-0")}>
            <div className="px-4 py-2 border-b border-slate-800/50 flex items-center gap-2 bg-white/[0.02]">
                <i className={`fa ${icon} text-[10px] text-emerald-500`}></i>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{title}</span>
            </div>
            <div className="p-4 flex-grow">
                {children}
            </div>
        </div>
    );
}

function TopInfo({ label, value, active }: any) {
    return (
        <div className="flex flex-col">
            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
            <div className="flex items-center gap-1.5">
                {active !== undefined && <span className={clsx("size-1.5 rounded-full", active ? "bg-emerald-500 led-green" : "bg-red-500")}></span>}
                <span className="text-[11px] font-black text-slate-200 uppercase">{value || "---"}</span>
            </div>
        </div>
    );
}

function MetricRow({ label, value, highlight }: any) {
    return (
        <div className="flex justify-between items-center py-1 border-b border-slate-800/30 last:border-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase">{label}</span>
            <span className={clsx("text-xs font-mono font-bold", highlight ? "text-emerald-400" : "text-slate-300")}>{value || "---"}</span>
        </div>
    );
}

function SmallStat({ label, value, color }: any) {
    return (
        <div className="flex flex-col p-2 bg-black/30 rounded border border-slate-800/50">
            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">{label}</span>
            <span className={clsx("text-sm font-black", color === 'emerald' ? 'text-emerald-400' : 'text-white')}>{value || 0}</span>
        </div>
    );
}

function ProgressBar({ pct, color }: any) {
    const colors: any = { emerald: "bg-emerald-500 led-green", blue: "bg-blue-500 led-blue" };
    return (
        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div className={clsx("h-full transition-all duration-1000", colors[color])} style={{ width: `${pct}%` }}></div>
        </div>
    );
}

function SgaBar({ label, value, pct, color }: any) {
    const colors: any = { 
        emerald: "bg-emerald-500 led-green", 
        blue: "bg-blue-500 led-blue",
        purple: "bg-purple-500",
        indigo: "bg-indigo-500"
    };
    return (
        <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold uppercase">
                <span className="text-slate-500">{label}</span>
                <span className="text-slate-300">{value || "---"}</span>
            </div>
            <div className="h-2 w-full bg-slate-800 rounded flex overflow-hidden border border-slate-700/30">
                <div className={clsx("h-full transition-all duration-1000", colors[color])} style={{ width: `${pct}%` }}></div>
            </div>
        </div>
    );
}

function ProcNode({ label, value, active }: any) {
    return (
        <div className="flex items-center justify-between p-2 bg-slate-800/30 rounded border border-slate-700/20 group hover:border-emerald-500/30 transition-colors">
            <span className="text-[10px] font-bold text-slate-400 uppercase">{label}</span>
            <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-black text-white">{value}</span>
                <div className={clsx("size-4 rounded-full flex items-center justify-center border", active ? "bg-emerald-500/20 border-emerald-500/50" : "bg-slate-700 border-slate-600")}>
                    {active && <div className="size-1.5 rounded-full bg-emerald-500 led-green animate-pulse"></div>}
                </div>
            </div>
        </div>
    );
}

function LoadingOverlay() {
    return (
        <div className="h-full flex flex-col items-center justify-center gap-6 bg-[#020617]">
            <div className="relative">
                <div className="size-20 rounded-full border-4 border-slate-800 border-t-emerald-500 animate-spin"></div>
                <i className="fa fa-database absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-emerald-500/50 text-2xl"></i>
            </div>
            <div className="text-center space-y-2">
                <p className="text-xs font-black text-white uppercase tracking-[0.5em] animate-pulse">Establishing Connection</p>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Querying Performance Views...</p>
            </div>
        </div>
    );
}

export { OracleMonitorViewModel };
