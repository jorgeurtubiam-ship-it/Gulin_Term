// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { getWebServerEndpoint } from "@/util/endpoints";
import { getApi, globalStore, WOS } from "@/store/global";
import { atom, useAtom } from "jotai";
import { useEffect } from "react";
import React from "react";
export class HbaseMonitorViewModel {
    viewType = "hbase-monitor";
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
            if (!resp.ok) throw new Error("Error fetching metrics");
            const data = await resp.json();
            globalStore.set(this.metricsAtom, data);
            globalStore.set(this.errorAtom, null);
        } catch (e: any) {
            globalStore.set(this.errorAtom, e.message);
        } finally {
            globalStore.set(this.loadingAtom, false);
        }
    }
    get viewComponent() { return HbaseMonitorView; }
}
function HbaseMonitorView({ model }: { model: HbaseMonitorViewModel }) {
    const [metrics] = useAtom(model.metricsAtom);
    const [loading] = useAtom(model.loadingAtom);
    useEffect(() => { const interval = setInterval(() => { model.refreshMetrics(); }, 15000); return () => clearInterval(interval); }, [model]);
    if (loading && !metrics) return <div className="p-4 text-white">Cargando...</div>;
    return (
        <div className="flex flex-col h-full bg-[#1e1e2e] text-white p-6 overflow-auto">
            <h2 className="text-2xl font-black mb-6 text-blue-500"><i className="fa fa-database mr-2"></i> HBase Gulin-Insights - {model.connectionName}</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
                <MetricCard title="Estado" value={metrics?.service?.status || "OPEN"} icon="fa-power-off" color="text-blue-500" />
                <MetricCard title="Uso (GB)" value={metrics?.storage?.used_gb || "0"} icon="fa-hdd" color="text-blue-500" />
            </div>
            <pre className="bg-black/50 p-4 text-xs font-mono">{JSON.stringify(metrics, null, 2)}</pre>
        </div>
    );
}
function MetricCard({ title, value, icon, color }: { title: string, value: any, icon: string, color: string }) {
    return (
        <div className="bg-zinc-800/50 p-5 rounded-xl flex items-center gap-5 border border-zinc-700">
            <div className={`size-12 rounded-xl bg-zinc-900 flex items-center justify-center border border-zinc-800 ${color}`}><i className={`fa ${icon} text-xl`}></i></div>
            <div><p className="text-[10px] text-zinc-400 uppercase font-black">{title}</p><p className="text-xl font-black">{value}</p></div>
        </div>
    );
}
