// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { atoms, getApi, globalStore, WOS } from "@/store/global";
import { atom, useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import clsx from "clsx";

class OracleMonitorViewModel implements ViewModel {
    viewType: string = "oracle-monitor";
    blockId: string;
    blockAtom: any;
    viewIcon = atom<string>("chart-area");
    viewName = atom<string>("Oracle Monitor");
    viewText = atom<string>("Oracle Monitor");
    metricsAtom = atom<any>(null);
    loadingAtom = atom<boolean>(true);
    errorAtom = atom<string | null>(null);
    connectionName: string = "";

    constructor(blockId: string) {
        this.blockId = blockId;
        this.blockAtom = WOS.getGulinObjectAtom<Block>(`block:${blockId}`);
        this.refreshMetrics();
    }

    async refreshMetrics(overrideConn?: string) {
        globalStore.set(this.loadingAtom as any, true);
        try {
            const block = globalStore.get(this.blockAtom as any);
            const conn = overrideConn || block?.meta?.connection || this.connectionName || "";
            this.connectionName = conn;

            if (!this.connectionName) {
                globalStore.set(this.loadingAtom as any, false);
                return;
            }

            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-metrics?connection=${encodeURIComponent(this.connectionName)}`, { headers });
            
            if (!resp.ok) {
                const errText = await resp.text().catch(() => "Error al obtener metricas");
                throw new Error(errText || "Error al obtener metricas");
            }

            const data = await resp.json();
            globalStore.set(this.metricsAtom as any, data);
            globalStore.set(this.errorAtom as any, null);
        } catch (e: any) {
            globalStore.set(this.errorAtom as any, e.message);
        } finally {
            globalStore.set(this.loadingAtom as any, false);
        }
    }

    get viewComponent() {
        return OracleMonitorView;
    }
}

function OracleMonitorView({ model }: { model: OracleMonitorViewModel }) {
    const blockData = useAtomValue(model.blockAtom) as Block;
    const metrics = useAtomValue(model.metricsAtom);
    const loading = useAtomValue(model.loadingAtom);
    const error = useAtomValue(model.errorAtom);
    const [activeTab, setActiveTab] = useState("Overview");

    const connName = (blockData?.meta?.connection as string) || model.connectionName;

    useEffect(() => {
        if (connName && connName !== model.connectionName) {
            model.refreshMetrics(connName);
        }
    }, [connName, model]);

    useEffect(() => {
        const interval = setInterval(() => {
            if (model.connectionName || connName) {
                model.refreshMetrics(connName);
            }
        }, 15000); // 15 seconds for heavy queries
        return () => clearInterval(interval);
    }, [model, connName]);

    if (!metrics && loading) {
        return <LoadingOverlay />;
    }

    if (!metrics && error) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center gap-4 bg-[#020617] text-slate-400 p-6 text-center">
                <i className="fa fa-exclamation-triangle text-amber-500 text-3xl"></i>
                <div className="space-y-1 max-w-md">
                    <p className="text-sm font-bold text-white uppercase tracking-wider">No se pudieron cargar las métricas</p>
                    <p className="text-xs text-slate-400 font-mono">{error}</p>
                    {connName && <p className="text-[10px] text-emerald-400 font-mono mt-2">Conexión: {connName}</p>}
                </div>
                <button
                    onClick={() => model.refreshMetrics(connName)}
                    className="mt-2 px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded text-xs font-bold uppercase tracking-widest border border-slate-700 hover:border-emerald-500/40 transition-all flex items-center gap-2"
                >
                    <i className="fa fa-refresh"></i> Reintentar
                </button>
            </div>
        );
    }

    const tabs = [];
    const isRac = metrics?.is_rac === true;
    const isMultitenant = metrics?.pdbs && metrics?.pdbs.length > 0;

    if (isRac) {
        tabs.push("Cluster Details", "Instances", "Nodes", "Shared Disk Groups");
    }
    if (isMultitenant) {
        tabs.push("Pluggable Databases");
    }
    tabs.push("Overview", "Tablespace", "Session", "SGA", "PGA", "Jobs", "Slow Queries");

    const currentTab = tabs.includes(activeTab) ? activeTab : (tabs[0] || "Overview");

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
                .led-red { box-shadow: 0 0 10px rgba(239, 68, 68, 0.4); }
            `}</style>

            {/* HEADER SUPERIOR */}
            <div className="flex flex-col bg-slate-900/50">
                <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800">
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Oracle Gulin-Insights</span>
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
                {/* TABS NAVIGATION */}
                <div className="flex px-6 pt-2 gap-1 border-b border-slate-800 overflow-x-auto no-scrollbar">
                    {tabs.map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)}
                            className={clsx(
                                "px-4 py-2 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-colors whitespace-nowrap",
                                currentTab === tab ? "border-emerald-500 text-emerald-400 bg-slate-800/30" : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/20"
                            )}>
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {/* CONTENIDO PRINCIPAL */}
            <div className="flex-grow p-4 overflow-hidden relative">
                {currentTab === "Cluster Details" && <TabClusterDetails metrics={metrics} model={model} />}
                {currentTab === "Instances" && <TabInstances metrics={metrics} />}
                {currentTab === "Nodes" && <TabNodes metrics={metrics} />}
                {currentTab === "Shared Disk Groups" && <TabASM metrics={metrics} />}
                {currentTab === "Pluggable Databases" && <TabPDBs metrics={metrics} />}
                {currentTab === "Overview" && <TabOverview metrics={metrics} model={model} />}
                {currentTab === "Tablespace" && <TabTablespace metrics={metrics} />}
                {currentTab === "Session" && <TabSession metrics={metrics} />}
                {currentTab === "SGA" && <TabSGA metrics={metrics} />}
                {currentTab === "PGA" && <TabPGA metrics={metrics} />}
                {currentTab === "Jobs" && <TabJobs metrics={metrics} />}
                {currentTab === "Slow Queries" && <TabSlowQueries metrics={metrics} />}
            </div>
        </div>
    );
}

// ==========================================
// TABS COMPONENTS (RAC & MULTITENANT)
// ==========================================

function TabClusterDetails({ metrics, model }: any) {
    const data = [
        ["Cluster Name", metrics?.cluster_name || "---"],
        ["Connection Name", model.connectionName],
        ["Number of Instances", metrics?.num_instances || "---"],
        ["Shared Disks Count", metrics?.asm_diskgroups?.length || 0],
        ["Oracle Version", metrics?.service?.instance_name || "---"],
        ["Global DB Name", metrics?.service?.instance_name || "---"],
        ["Pluggable Database Count", metrics?.pdbs?.length || 0]
    ];
    return (
        <div className="p-4 h-full flex flex-col">
            <MonitorBlock title="Cluster Overview" icon="fa-sitemap" expanded>
                <div className="w-1/2">
                    <table className="w-full text-left">
                        <tbody>
                            {data.map((row: any, i: number) => (
                                <tr key={i} className="border-b border-slate-800/30">
                                    <td className="py-3 text-[11px] font-bold text-slate-400">{row[0]}</td>
                                    <td className="py-3 text-[11px] font-black text-slate-200">{row[1]}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </MonitorBlock>
        </div>
    );
}

function TabInstances({ metrics }: any) {
    const data = metrics?.rac_nodes || [];
    return (
        <DataGrid 
            headers={["Instance ID", "Instance Name", "Node", "Uptime (min)", "User Sessions", "Status", "Availability"]}
            data={data.map((row: any) => [
                row.inst_id,
                row.instance_name,
                row.host_name,
                row.uptime_min?.toFixed(2),
                row.sessions,
                <span className={clsx("font-bold text-[9px]", row.status === 'OPEN' ? "text-emerald-400" : "text-amber-400")}>{row.status}</span>,
                <StatusLed active={row.status === 'OPEN'} />
            ])}
        />
    );
}

function TabNodes({ metrics }: any) {
    const data = metrics?.rac_nodes || [];
    return (
        <DataGrid 
            headers={["Host Name / Node", "Instance", "CPU Utilization (%)", "Sessions", "Health", "Availability"]}
            data={data.map((row: any) => [
                row.host_name,
                row.instance_name,
                row.cpu_load?.toFixed(2),
                row.sessions,
                <StatusLed active={row.cpu_load < 90} />,
                <StatusLed active={true} />
            ])}
        />
    );
}

function TabASM({ metrics }: any) {
    const data = metrics?.asm_diskgroups || [];
    return (
        <DataGrid 
            headers={["Disk Group Name", "Type", "State", "Total Memory (GB)", "Free Memory (GB)", "Used Memory (%)", "Health"]}
            data={data.map((row: any) => [
                row.name,
                row.type,
                <span className={clsx("font-bold text-[9px]", row.state === 'CONNECTED' || row.state === 'MOUNTED' ? "text-emerald-400" : "text-amber-400")}>{row.state}</span>,
                row.total_gb?.toFixed(2),
                row.free_gb?.toFixed(2),
                row.used_pct?.toFixed(2) + "%",
                <StatusLed active={row.used_pct < 90 && (row.state === 'CONNECTED' || row.state === 'MOUNTED')} />
            ])}
        />
    );
}

function TabPDBs({ metrics }: any) {
    const data = metrics?.pdbs || [];
    return (
        <DataGrid 
            headers={["PDB Name", "Open Mode", "Size (MB)", "Health", "Availability"]}
            data={data.map((row: any) => [
                row.name,
                <span className={clsx("font-bold text-[9px]", row.open_mode === 'READ WRITE' ? "text-emerald-400" : "text-amber-400")}>{row.open_mode}</span>,
                row.size_mb?.toFixed(2),
                <StatusLed active={row.open_mode === 'READ WRITE' || row.open_mode === 'MOUNTED'} />,
                <StatusLed active={row.open_mode === 'READ WRITE' || row.open_mode === 'MOUNTED'} />
            ])}
        />
    );
}

// ==========================================
// TABS COMPONENTS (STANDALONE)
// ==========================================

function TabOverview({ metrics, model }: any) {
    return (
        <div className="grid grid-cols-12 gap-4 h-full">
            <div className="col-span-3 flex flex-col gap-4">
                <MonitorBlock title="SERVICE" icon="fa-server">
                    <div className="space-y-4">
                        <MetricRow label="Uptime" value={metrics?.service?.uptime || "---"} highlight />
                        <div className="grid grid-cols-2 gap-2">
                            <SmallStat label="Total Users" value={metrics?.sessions?.total} />
                            <SmallStat label="Active Users" value={metrics?.sessions?.active} color="emerald" />
                        </div>
                    </div>
                </MonitorBlock>
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
                    </div>
                </MonitorBlock>
            </div>
            
            <div className="col-span-3 flex flex-col gap-4">
                <MonitorBlock title="SERVER PROCESSES" icon="fa-tasks">
                    <div className="space-y-4">
                        <div className="text-center pb-2 border-b border-slate-800/50">
                            <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">SERVER MEMORY</span>
                            <span className="text-sm font-black text-emerald-400">{metrics?.server_processes?.pga_used || "---"}</span>
                            <span className="text-[9px] text-slate-500 block">de {metrics?.server_processes?.pga_target || "---"}</span>
                        </div>
                    </div>
                </MonitorBlock>
                <MonitorBlock title="MEMORY ARCHITECTURE" icon="fa-microchip" expanded>
                    <div className="space-y-3">
                        <SgaBar label="Cache Principal" value={metrics?.sga?.buffer_cache} pct={85} color="blue" />
                        <SgaBar label="Cache Secundario" value={metrics?.sga?.shared_pool} pct={metrics?.sga?.shared_pool_pct || 0} color="emerald" />
                        <div className="pt-2 border-t border-slate-800/50 flex justify-between items-center">
                            <span className="text-[10px] font-black text-white">TOTAL MEMORY</span>
                            <span className="text-xs font-mono font-bold text-emerald-400">{metrics?.sga?.total || "---"}</span>
                        </div>
                    </div>
                </MonitorBlock>
            </div>

            <div className="col-span-6 flex flex-col gap-4">
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
                    </div>
                </MonitorBlock>
                <MonitorBlock title="SYSTEM CONTEXT" icon="fa-info-circle" expanded>
                    <div className="text-[10px] font-mono text-slate-400 space-y-2 p-2 bg-black/40 rounded border border-slate-800/50 h-full">
                        <p className="text-emerald-500/70">{">"} Gulin-Insights Module Active</p>
                        <p className="text-emerald-500/70">{">"} Target: {model.connectionName}</p>
                        <p className="text-emerald-500/70">{">"} Gathering AWR / v$ views periodically...</p>
                        <div className="animate-pulse h-3 w-1 bg-emerald-500 inline-block align-middle ml-1"></div>
                    </div>
                </MonitorBlock>
            </div>
        </div>
    );
}

function TabTablespace({ metrics }: any) {
    const data = metrics?.tablespaces_detailed || [];
    return (
        <DataGrid 
            headers={["Tablespace Name", "Allocated (MB)", "Used (MB)", "Free (MB)", "Used %", "Data Files", "Health"]}
            data={data.map((row: any) => [
                row.name, 
                row.allocated_mb?.toFixed(2), 
                row.used_mb?.toFixed(2), 
                row.free_mb?.toFixed(2), 
                <ProgressBar pct={row.used_pct} color={row.used_pct > 90 ? "red" : "emerald"} />,
                row.data_files,
                <StatusLed active={row.used_pct < 90} />
            ])}
        />
    );
}

function TabSession({ metrics }: any) {
    const data = metrics?.sessions_detailed || [];
    return (
        <DataGrid 
            headers={["SID", "Status", "Machine", "User Name", "Elapsed Time", "CPU Used", "Physical Reads"]}
            data={data.map((row: any) => [
                row.sid,
                <span className={clsx("font-bold text-[9px]", row.status === 'ACTIVE' ? "text-emerald-400" : "text-slate-500")}>{row.status}</span>,
                row.machine,
                row.username,
                row.elapsed_time + "s",
                row.cpu_used,
                row.physical_reads
            ])}
        />
    );
}

function TabSGA({ metrics }: any) {
    return (
        <div className="h-full flex items-center justify-center p-10">
            <div className="w-1/2">
                <MonitorBlock title="SGA DETAILED" icon="fa-microchip" expanded>
                    <div className="space-y-4">
                        <SgaBar label="Buffer Cache" value={metrics?.sga?.buffer_cache} pct={60} color="blue" />
                        <SgaBar label="Shared Pool" value={metrics?.sga?.shared_pool} pct={30} color="emerald" />
                        <SgaBar label="Java Pool" value={metrics?.sga?.java_pool} pct={5} color="purple" />
                        <SgaBar label="Large Pool" value={metrics?.sga?.large_pool} pct={3} color="indigo" />
                        <SgaBar label="Redo Buffer" value={metrics?.sga?.redo_buffer} pct={2} color="red" />
                    </div>
                </MonitorBlock>
            </div>
        </div>
    );
}

function TabPGA({ metrics }: any) {
    const data = metrics?.pga_detailed || [];
    return (
        <DataGrid 
            headers={["PGA Statistic Name", "Value"]}
            data={data.map((row: any) => [row.name, row.value])}
        />
    );
}

function TabJobs({ metrics }: any) {
    const data = metrics?.jobs_detailed || [];
    return (
        <DataGrid 
            headers={["Job Name", "State", "Last Start", "Duration", "Next Run", "Health"]}
            data={data.map((row: any) => [
                row.name,
                row.state,
                row.last_start || "---",
                row.duration || "---",
                row.next_run || "---",
                <StatusLed active={row.state !== 'FAILED' && row.state !== 'BROKEN'} />
            ])}
        />
    );
}

function TabSlowQueries({ metrics }: any) {
    const data = metrics?.slow_queries || [];
    return (
        <DataGrid 
            headers={["SQL Text", "Executions", "Avg CPU (ms)", "Avg Time (ms)", "Severity"]}
            data={data.map((row: any) => [
                <span className="font-mono text-emerald-400 text-[10px] break-all">{row.query}</span>,
                row.executions,
                row.avg_cpu_ms,
                row.avg_time_ms,
                <StatusLed active={row.avg_time_ms < 5000} />
            ])}
        />
    );
}

// ==========================================
// COMPONENTES AUXILIARES
// ==========================================

function DataGrid({ headers, data }: any) {
    return (
        <div className="h-full glass-card rounded-xl overflow-hidden flex flex-col border border-slate-700/50">
            <div className="overflow-x-auto h-full">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-900/80 sticky top-0 z-10 backdrop-blur-md">
                        <tr>
                            {headers.map((h: string, i: number) => (
                                <th key={i} className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-700/50">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="overflow-y-auto">
                        {data.map((row: any[], i: number) => (
                            <tr key={i} className="border-b border-slate-800/30 hover:bg-slate-800/30 transition-colors">
                                {row.map((cell: any, j: number) => (
                                    <td key={j} className="px-4 py-2 text-[11px] text-slate-300">
                                        {cell}
                                    </td>
                                ))}
                            </tr>
                        ))}
                        {data.length === 0 && (
                            <tr>
                                <td colSpan={headers.length} className="px-4 py-8 text-center text-[10px] text-slate-500 font-bold uppercase">
                                    No data available / Insufficient Privileges (Requires SYSDBA or SELECT ANY DICTIONARY)
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function StatusLed({ active }: { active: boolean }) {
    return (
        <div className={clsx("size-2 rounded-full", active ? "bg-emerald-500 led-green" : "bg-red-500 led-red")}></div>
    );
}

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
    const colors: any = { emerald: "bg-emerald-500 led-green", blue: "bg-blue-500 led-blue", red: "bg-red-500 led-red" };
    return (
        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden mt-1">
            <div className={clsx("h-full transition-all duration-1000", colors[color])} style={{ width: `${pct}%` }}></div>
        </div>
    );
}

function SgaBar({ label, value, pct, color }: any) {
    const colors: any = { 
        emerald: "bg-emerald-500 led-green", 
        blue: "bg-blue-500 led-blue",
        purple: "bg-purple-500",
        indigo: "bg-indigo-500",
        red: "bg-red-500 led-red"
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
