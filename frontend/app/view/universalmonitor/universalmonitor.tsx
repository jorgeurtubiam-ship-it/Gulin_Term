// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { getApi, globalStore, WOS } from "@/store/global";
import { atom, useAtom } from "jotai";
import { useEffect } from "react";
import React from "react";

export class UniversalMonitorViewModel {
    viewType: string;
    blockId: string;
    blockAtom: any;
    metricsAtom = atom<any>(null);
    loadingAtom = atom<boolean>(true);
    errorAtom = atom<string | null>(null);
    connectionName: string = "";

    constructor(blockId: string, viewType: string) {
        this.viewType = viewType;
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
        return UniversalMonitorView;
    }
}

export class SqliteMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "sqlite-monitor"); } }
export class SaphanaMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "saphana-monitor"); } }
export class Db2MonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "db2-monitor"); } }
export class SybaseMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "sybase-monitor"); } }
export class InformixMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "informix-monitor"); } }
export class DamengMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "dameng-monitor"); } }
export class MaxdbMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "maxdb-monitor"); } }
export class MongodbMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "mongodb-monitor"); } }
export class CassandraMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "cassandra-monitor"); } }
export class RedisMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "redis-monitor"); } }
export class MemcachedMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "memcached-monitor"); } }
export class Neo4jMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "neo4j-monitor"); } }
export class CouchbaseMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "couchbase-monitor"); } }
export class HazelcastMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "hazelcast-monitor"); } }
export class HadoopMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "hadoop-monitor"); } }
export class HbaseMonitorViewModel extends UniversalMonitorViewModel { constructor(blockId: string) { super(blockId, "hbase-monitor"); } }


function UniversalMonitorView({ model }: { model: UniversalMonitorViewModel }) {
    const [metrics] = useAtom(model.metricsAtom);
    const [loading] = useAtom(model.loadingAtom);
    const [error] = useAtom(model.errorAtom);

    useEffect(() => {
        const interval = setInterval(() => {
            model.refreshMetrics();
        }, 15000);
        return () => clearInterval(interval);
    }, [model]);

    if (loading && !metrics) return <div className="p-4 text-white text-xs opacity-50"><i className="fa fa-spinner fa-spin mr-2"></i> Cargando métricas Gulin-Insights...</div>;
    if (error) return <div className="p-4 text-red-500 font-bold bg-red-500/10 rounded-md border border-red-500/20"><i className="fa fa-exclamation-triangle mr-2"></i> Error: {error}</div>;
    if (!metrics) return <div className="p-4 text-white opacity-50"><i className="fa fa-inbox mr-2"></i> Sin datos de monitoreo</div>;

    return (
        <div className="flex flex-col h-full bg-[#09090b] text-white p-6 overflow-auto">
            <h2 className="text-2xl font-black mb-6 flex items-center gap-3 tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">
                <i className="fa fa-chart-line text-blue-500"></i>
                Monitor Universal - {model.connectionName}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <MetricCard title="Estado" value={metrics.service?.status || "N/A"} icon="fa-server" color="text-green-500" />
                <MetricCard title="Uptime" value={metrics.service?.uptime || "N/A"} icon="fa-clock" color="text-blue-500" />
                <MetricCard title="Sesiones Activas" value={metrics.sessions?.active || 0} icon="fa-users" color="text-purple-500" />
                <MetricCard title="Almacenamiento (GB)" value={metrics.storage?.used_gb || "N/A"} icon="fa-database" color="text-yellow-500" />
            </div>
            
            <div className="bg-[#121216] border border-zinc-800/50 rounded-xl p-5 shadow-lg relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-emerald-500/20"></div>
                <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <i className="fa fa-bug"></i>
                    Métricas Crudas (Diagnóstico Temprano)
                </h3>
                <pre className="text-[10px] text-emerald-500/70 overflow-auto max-h-64 font-mono bg-black/40 p-4 rounded-lg border border-emerald-900/30">
                    {JSON.stringify(metrics, null, 2)}
                </pre>
            </div>
        </div>
    );
}

function MetricCard({ title, value, icon, color }: { title: string, value: any, icon: string, color: string }) {
    return (
        <div className="bg-[#121216] border border-zinc-800/50 p-5 rounded-xl flex items-center gap-5 hover:border-zinc-700 hover:bg-[#18181c] transition-all cursor-default shadow-md hover:shadow-xl">
            <div className={`size-12 rounded-xl bg-zinc-900 flex items-center justify-center border border-zinc-800 ${color} shadow-inner`}>
                <i className={`fa ${icon} text-xl`}></i>
            </div>
            <div>
                <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">{title}</p>
                <p className="text-xl font-black tracking-tight">{value}</p>
            </div>
        </div>
    );
}
