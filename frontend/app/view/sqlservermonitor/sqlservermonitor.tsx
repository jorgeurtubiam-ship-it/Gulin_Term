// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { atoms, getApi, globalStore, WOS } from "@/store/global";
import { atom, useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

class SqlServerMonitorViewModel {
    viewType = "sqlserver-monitor";
    blockId: string;
    blockAtom: any;
    metricsAtom = atom<any>(null);
    loadingAtom = atom<boolean>(true);
    errorAtom = atom<string | null>(null);
    connectionName: string = "";

    constructor(blockId: string) {
        this.blockId = blockId;
        this.blockAtom = WOS.getGulinObjectAtom(`block:${blockId}`);
        this.refreshMetrics();
    }

    async refreshMetrics() {
        globalStore.set(this.loadingAtom, true);
        try {
            const block: any = globalStore.get(this.blockAtom);
            this.connectionName = block?.meta?.connection || "";

            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-metrics?connection=${encodeURIComponent(this.connectionName)}`, { headers });
            
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
        return SqlServerMonitorView;
    }
}

function SqlServerMonitorView({ model }: { model: SqlServerMonitorViewModel }) {
    const [metrics] = useAtom(model.metricsAtom);
    const [activeTab, setActiveTab] = useState("Overview");

    useEffect(() => {
        const interval = setInterval(() => {
            model.refreshMetrics();
        }, 15000);
        return () => clearInterval(interval);
    }, [model]);

    if (!metrics) {
        return <LoadingOverlay />;
    }

    const tabs = ["Overview", "Slow Queries", "Deadlocks & Blocks", "Availability Groups", "Sessions & Users"];
    const currentTab = tabs.includes(activeTab) ? activeTab : tabs[0];

    return (
        <div className="h-full w-full flex flex-col bg-[#09090b] text-slate-300 font-sans overflow-hidden select-none">
            <div className="flex flex-col bg-slate-900 shadow-md z-10">
                <div className="px-6 py-4 flex items-center justify-between border-b border-slate-800/50">
                    <div>
                        <h1 className="text-xl font-black text-slate-100 flex items-center gap-3 tracking-tight">
                            <i className="fa-brands fa-microsoft text-blue-500"></i>
                            SQL Server Monitor <span className="text-slate-600 font-medium">| {model.connectionName}</span>
                        </h1>
                        <div className="text-xs text-slate-400 mt-1 font-medium flex items-center gap-2">
                            <i className="fa-solid fa-clock text-slate-500"></i> Last Updated: {metrics?.last_update}
                        </div>
                    </div>
                    <div className="flex gap-4">
                        <HealthBadge label="Health" status="UP" />
                        <HealthBadge label="Availability" status="UP" />
                    </div>
                </div>
                <div className="flex px-6 pt-2 gap-1 border-b border-slate-800 overflow-x-auto no-scrollbar">
                    {tabs.map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)}
                            className={clsx(
                                "px-4 py-2 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-colors whitespace-nowrap",
                                currentTab === tab ? "border-blue-500 text-blue-400 bg-slate-800/30" : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/20"
                            )}>
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-grow p-4 overflow-hidden relative">
                {currentTab === "Overview" && <TabOverview metrics={metrics} model={model} />}
                {currentTab === "Slow Queries" && <TabSlowQueries metrics={metrics} />}
                {currentTab === "Deadlocks & Blocks" && <TabBlocks metrics={metrics} />}
                {currentTab === "Availability Groups" && <TabAG metrics={metrics} />}
                {currentTab === "Sessions & Users" && <TabSessions metrics={metrics} />}
            </div>
        </div>
    );
}

// ==============================
// TABS
// ==============================

function TabOverview({ metrics, model }: any) {
    const sga = metrics?.sga || {};
    const storage = metrics?.storage || {};
    const pf = metrics?.performance_counters || {};

    return (
        <div className="h-full flex flex-col gap-4 overflow-y-auto no-scrollbar pb-10">
            <div className="flex gap-4">
                <MonitorBlock title="Instance Details" icon="fa-database" expanded>
                    <table className="w-full text-left">
                        <tbody>
                            <tr><td className="py-2 text-[11px] font-bold text-slate-400">Database Name</td><td className="py-2 text-[11px] font-black text-slate-200">{metrics?.service?.instance_name}</td></tr>
                            <tr><td className="py-2 text-[11px] font-bold text-slate-400">Uptime</td><td className="py-2 text-[11px] font-black text-slate-200">{metrics?.service?.uptime}</td></tr>
                            <tr><td className="py-2 text-[11px] font-bold text-slate-400">DB Size</td><td className="py-2 text-[11px] font-black text-slate-200">{storage?.total_gb}</td></tr>
                            <tr><td className="py-2 text-[11px] font-bold text-slate-400">Free Space</td><td className="py-2 text-[11px] font-black text-slate-200">{storage?.used_gb} (used)</td></tr>
                        </tbody>
                    </table>
                </MonitorBlock>

                <MonitorBlock title="Memory Architecture" icon="fa-microchip" expanded>
                    <div className="flex flex-col gap-4">
                        <div className="flex items-end justify-between">
                            <span className="text-[11px] font-bold text-slate-400">Buffer Cache Hit Ratio</span>
                            <span className={clsx("text-xl font-black", (pf.buffer_cache_hit_ratio || 0) > 90 ? "text-emerald-400" : "text-amber-400")}>{pf.buffer_cache_hit_ratio?.toFixed(2) || "---"}%</span>
                        </div>
                        <div className="flex items-end justify-between">
                            <span className="text-[11px] font-bold text-slate-400">Page Life Expectancy</span>
                            <span className="text-xl font-black text-slate-200">{pf.page_life_expectancy || "---"} s</span>
                        </div>
                        <div className="flex items-end justify-between">
                            <span className="text-[11px] font-bold text-slate-400">Total Memory Usage</span>
                            <span className="text-xl font-black text-slate-200">{sga.total}</span>
                        </div>
                    </div>
                </MonitorBlock>
            </div>
        </div>
    );
}

function TabSlowQueries({ metrics }: any) {
    const data = metrics?.slow_queries || [];
    return (
        <DataGrid 
            headers={["Query", "Executions", "Avg CPU (ms)", "Avg Elapsed Time (ms)", "Status"]}
            data={data.map((row: any) => [
                <div className="max-w-[400px] truncate text-[10px] text-blue-300 font-mono" title={row.query}>{row.query}</div>,
                row.executions,
                row.avg_cpu_ms,
                row.avg_time_ms,
                <StatusLed active={row.avg_time_ms < 5000} />
            ])}
        />
    );
}

function TabBlocks({ metrics }: any) {
    const data = metrics?.blocks || [];
    if (data.length === 0) {
        return <div className="h-full flex items-center justify-center text-slate-500 font-bold"><i className="fa-solid fa-check-circle mr-2 text-emerald-500"></i> No deadlocks or blocking sessions detected</div>;
    }
    return (
        <DataGrid 
            headers={["Blocked SPID", "Blocking SPID", "Wait Type", "Wait Time (ms)", "Resource", "Query"]}
            data={data.map((row: any) => [
                <span className="text-red-400 font-bold">{row.blocked_spid}</span>,
                <span className="text-orange-400 font-bold">{row.blocking_spid}</span>,
                row.wait_type,
                row.wait_time_ms,
                row.wait_resource,
                <div className="max-w-[200px] truncate text-[10px] text-slate-400" title={row.query}>{row.query}</div>
            ])}
        />
    );
}

function TabAG({ metrics }: any) {
    const data = metrics?.availability_groups || [];
    if (data.length === 0) {
        return <div className="h-full flex items-center justify-center text-slate-500 font-bold"><i className="fa-solid fa-server mr-2 text-blue-500"></i> No Availability Groups configured on this standalone instance.</div>;
    }
    return (
        <DataGrid 
            headers={["Group Name", "Replica Server", "Role", "Operational State", "Connected State", "Sync Health"]}
            data={data.map((row: any) => [
                row.group_name,
                row.replica_server,
                <span className={clsx("font-bold text-[9px]", row.role === 'PRIMARY' ? "text-emerald-400" : "text-slate-400")}>{row.role}</span>,
                row.operational_state,
                <span className={clsx("font-bold text-[9px]", row.connected_state === 'CONNECTED' ? "text-emerald-400" : "text-amber-400")}>{row.connected_state}</span>,
                <StatusLed active={row.sync_health === 'HEALTHY'} />
            ])}
        />
    );
}

function TabSessions({ metrics }: any) {
    const data = metrics?.sessions_detailed || [];
    return (
        <DataGrid 
            headers={["SPID", "Status", "Login Name", "Host Name", "Program", "CPU (ms)", "Memory (Pages)", "Health"]}
            data={data.map((row: any) => [
                row.spid,
                row.status,
                row.login,
                row.host,
                row.program,
                row.cpu_ms,
                row.memory_pages,
                <StatusLed active={row.status !== 'suspended' && row.status !== 'sleeping'} />
            ])}
        />
    );
}

// ==============================
// SHARED UI
// ==============================

function StatusLed({ active }: { active: boolean }) {
    return (
        <div className="flex justify-center w-full">
            <div className={clsx("w-3 h-3 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)]", active ? "bg-emerald-500 shadow-emerald-500/50" : "bg-red-500 shadow-red-500/50")}></div>
        </div>
    );
}

function HealthBadge({ label, status }: { label: string, status: string }) {
    return (
        <div className="flex border border-slate-700 rounded overflow-hidden shadow-sm">
            <div className="bg-slate-800 px-3 py-1 text-[10px] font-bold text-slate-400 flex items-center uppercase">{label}</div>
            <div className="bg-emerald-950 px-3 py-1 text-[10px] font-black text-emerald-400 flex items-center gap-1.5 shadow-[inset_0_0_10px_rgba(16,185,129,0.2)]">
                <i className="fa-solid fa-circle text-[8px]"></i> {status}
            </div>
        </div>
    );
}

function MonitorBlock({ title, icon, children, expanded = false }: any) {
    return (
        <div className="bg-slate-900 border border-slate-800 rounded-lg shadow-lg overflow-hidden flex-1 flex flex-col">
            <div className="bg-slate-800/50 border-b border-slate-700/50 px-4 py-3 flex items-center gap-3">
                <div className="bg-blue-500/10 w-8 h-8 rounded flex items-center justify-center border border-blue-500/20">
                    <i className={clsx("fa-solid text-blue-400", icon)}></i>
                </div>
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">{title}</h3>
            </div>
            <div className="p-4 flex-1">
                {children}
            </div>
        </div>
    );
}

function DataGrid({ headers, data }: { headers: string[], data: any[][] }) {
    return (
        <div className="w-full h-full bg-slate-900 border border-slate-800 rounded-lg shadow-lg overflow-hidden flex flex-col">
            <div className="overflow-auto no-scrollbar flex-1">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-950 z-10">
                        <tr>
                            {headers.map((h, i) => (
                                <th key={i} className="py-3 px-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 whitespace-nowrap">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((row, rIdx) => (
                            <tr key={rIdx} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                                {row.map((cell, cIdx) => (
                                    <td key={cIdx} className="py-2 px-4 text-[11px] font-medium text-slate-300">
                                        {cell}
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

function LoadingOverlay() {
    return (
        <div className="h-full w-full flex items-center justify-center bg-[#09090b]">
            <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <div className="text-blue-500 font-bold text-sm tracking-widest animate-pulse">CONNECTING TO SQL SERVER...</div>
            </div>
        </div>
    );
}

export { SqlServerMonitorViewModel };
