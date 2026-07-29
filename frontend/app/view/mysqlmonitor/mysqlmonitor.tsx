// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { getApi, globalStore, WOS } from "@/store/global";
import { atom, useAtom } from "jotai";
import { useEffect, useState } from "react";
import React from "react";

export class MysqlMonitorViewModel {
    viewType = "mysql-monitor";
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
            
            if (!resp.ok) throw new Error("Error fetching MySQL metrics");

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
        return MysqlMonitorView;
    }
}

function MysqlMonitorView({ model }: { model: MysqlMonitorViewModel }) {
    const [metrics] = useAtom(model.metricsAtom);
    const [loading] = useAtom(model.loadingAtom);
    const [error] = useAtom(model.errorAtom);

    useEffect(() => {
        const interval = setInterval(() => {
            model.refreshMetrics();
        }, 15000);
        return () => clearInterval(interval);
    }, [model]);

    if (loading && !metrics) return <div className="p-4 text-white text-xs opacity-50"><i className="fa fa-spinner fa-spin mr-2"></i> Cargando MySQL Gulin-Insights...</div>;
    if (error) return <div className="p-4 text-red-500 font-bold bg-red-500/10 rounded-md border border-red-500/20"><i className="fa fa-exclamation-triangle mr-2"></i> Error: {error}</div>;
    if (!metrics) return <div className="p-4 text-white opacity-50"><i className="fa fa-inbox mr-2"></i> Sin datos</div>;

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] text-white p-6 overflow-auto">
            <h2 className="text-2xl font-black mb-6 flex items-center gap-3 tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-300">
                <i className="fa fa-database text-orange-500"></i>
                MySQL / MariaDB Gulin-Insights - {model.connectionName}
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <MetricCard title="Estado" value={metrics.service?.status || "N/A"} icon="fa-server" color="text-green-500" />
                <MetricCard title="Uptime" value={metrics.service?.uptime || "N/A"} icon="fa-clock" color="text-orange-400" />
                <MetricCard title="Threads Conectados" value={metrics.sessions?.total || 0} icon="fa-link" color="text-amber-400" />
                <MetricCard title="Threads Activos" value={metrics.sessions?.active || 0} icon="fa-bolt" color="text-yellow-400" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#252526] border border-orange-900/30 rounded-xl p-5 shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500/20 to-amber-500/20"></div>
                    <h3 className="text-sm font-black text-orange-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <i className="fa fa-cogs"></i> Global Status (Threads)
                    </h3>
                    <p className="text-xs text-zinc-400 mb-2">Total de threads en caché: <span className="text-white font-bold">{metrics.sessions?.total || 0}</span></p>
                    <div className="w-full bg-zinc-800 rounded-full h-2 mb-4">
                        <div className="bg-orange-500 h-2 rounded-full" style={{ width: `${Math.min(((metrics.sessions?.active || 0) / (metrics.sessions?.total || 1)) * 100, 100)}%` }}></div>
                    </div>
                </div>

                <div className="bg-[#252526] border border-orange-900/30 rounded-xl p-5 shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500/20 to-cyan-500/20"></div>
                    <h3 className="text-sm font-black text-blue-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <i className="fa fa-hdd"></i> Almacenamiento
                    </h3>
                    <p className="text-xs text-zinc-400">Archivos totales: <span className="text-white font-bold">{metrics.storage?.total_files || 1}</span></p>
                    <p className="text-xs text-zinc-400 mt-2">Tamaño Data+Índices: <span className="text-white font-bold">{metrics.storage?.used_gb}</span></p>
                </div>
            </div>
        </div>
    );
}

function MetricCard({ title, value, icon, color }: { title: string, value: any, icon: string, color: string }) {
    return (
        <div className="bg-[#252526] border border-zinc-700/50 p-5 rounded-xl flex items-center gap-5 hover:border-zinc-600 hover:bg-[#2d2d30] transition-all cursor-default shadow-md hover:shadow-xl">
            <div className={`size-12 rounded-xl bg-zinc-800 flex items-center justify-center border border-zinc-700 ${color} shadow-inner`}>
                <i className={`fa ${icon} text-xl`}></i>
            </div>
            <div>
                <p className="text-[10px] text-zinc-400 uppercase font-black tracking-widest mb-1">{title}</p>
                <p className="text-xl font-black tracking-tight">{value}</p>
            </div>
        </div>
    );
}
