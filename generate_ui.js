const fs = require('fs');
const path = require('path');

const databases = [
  { id: 'saphana', name: 'SAP HANA', icon: 'fa-microchip', color: 'text-blue-400' },
  { id: 'db2', name: 'IBM Db2', icon: 'fa-server', color: 'text-blue-600' },
  { id: 'sybase', name: 'Sybase ASE', icon: 'fa-database', color: 'text-green-500' },
  { id: 'informix', name: 'Informix', icon: 'fa-hdd', color: 'text-indigo-500' },
  { id: 'dameng', name: 'Dameng', icon: 'fa-database', color: 'text-red-500' },
  { id: 'maxdb', name: 'SAP MaxDB', icon: 'fa-server', color: 'text-teal-500' },
  { id: 'mongodb', name: 'MongoDB', icon: 'fa-leaf', color: 'text-green-500' },
  { id: 'cassandra', name: 'Cassandra', icon: 'fa-circle-notch', color: 'text-blue-400' },
  { id: 'redis', name: 'Redis', icon: 'fa-server', color: 'text-red-500' },
  { id: 'memcached', name: 'Memcached', icon: 'fa-memory', color: 'text-pink-500' },
  { id: 'neo4j', name: 'Neo4j', icon: 'fa-project-diagram', color: 'text-blue-600' },
  { id: 'couchbase', name: 'Couchbase', icon: 'fa-couch', color: 'text-red-400' },
  { id: 'hazelcast', name: 'Hazelcast', icon: 'fa-bolt', color: 'text-yellow-400' },
  { id: 'hadoop', name: 'Hadoop', icon: 'fa-elephant', color: 'text-yellow-500' },
  { id: 'hbase', name: 'HBase', icon: 'fa-database', color: 'text-blue-500' }
];

const template = (id, name, icon, color) => `// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { getApi, globalStore, WOS } from "@/store/global";
import { atom, useAtom } from "jotai";
import { useEffect } from "react";
import React from "react";

export class ${id.charAt(0).toUpperCase() + id.slice(1)}MonitorViewModel {
    viewType = "${id}-monitor";
    blockId: string;
    blockAtom: any;
    metricsAtom = atom<any>(null);
    loadingAtom = atom<boolean>(true);
    errorAtom = atom<string | null>(null);
    connectionName: string = "";

    constructor(blockId: string) {
        this.blockId = blockId;
        this.blockAtom = WOS.getGulinObjectAtom(\`block:\${blockId}\`);
        this.refreshMetrics();
    }

    async refreshMetrics() {
        globalStore.set(this.loadingAtom, true);
        try {
            const block: any = globalStore.get(this.blockAtom);
            this.connectionName = block?.meta?.connection || "";
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(\`\${endpoint}/gulin/db-metrics?connection=\${encodeURIComponent(this.connectionName)}\`, { headers });
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

    get viewComponent() { return ${id.charAt(0).toUpperCase() + id.slice(1)}MonitorView; }
}

function ${id.charAt(0).toUpperCase() + id.slice(1)}MonitorView({ model }: { model: ${id.charAt(0).toUpperCase() + id.slice(1)}MonitorViewModel }) {
    const [metrics] = useAtom(model.metricsAtom);
    const [loading] = useAtom(model.loadingAtom);
    
    useEffect(() => {
        const interval = setInterval(() => {
            model.refreshMetrics();
        }, 15000);
        return () => clearInterval(interval);
    }, [model]);

    if (loading && !metrics) return <div className="p-4 text-white"><i className="fa fa-spinner fa-spin mr-2"></i> Cargando...</div>;
    if (!metrics) return <div className="p-4 text-white">Sin datos</div>;
    
    return (
        <div className="flex flex-col h-full bg-[#1e1e2e] text-white p-6 overflow-auto">
            <h2 className="text-2xl font-black mb-6 ${color}"><i className="fa ${icon} mr-2"></i> ${name} APM - {model.connectionName}</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
                <MetricCard title="Estado" value={metrics?.service?.status || "OPEN"} icon="fa-power-off" color="${color}" />
                <MetricCard title="Uso (GB)" value={metrics?.storage?.used_gb || "0"} icon="fa-hdd" color="${color}" />
            </div>
            <pre className="bg-black/50 p-4 text-xs font-mono">{JSON.stringify(metrics, null, 2)}</pre>
        </div>
    );
}

function MetricCard({ title, value, icon, color }: { title: string, value: any, icon: string, color: string }) {
    return (
        <div className="bg-zinc-800/50 p-5 rounded-xl flex items-center gap-5 border border-zinc-700">
            <div className={\`size-12 rounded-xl bg-zinc-900 flex items-center justify-center border border-zinc-800 \${color}\`}>
                <i className={\`fa \${icon} text-xl\`}></i>
            </div>
            <div>
                <p className="text-[10px] text-zinc-400 uppercase font-black">{title}</p>
                <p className="text-xl font-black">{value}</p>
            </div>
        </div>
    );
}
`;

const viewDir = path.join(__dirname, 'frontend/app/view');

databases.forEach(db => {
    const dir = path.join(viewDir, `${db.id}monitor`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${db.id}monitor.tsx`), template(db.id, db.name, db.icon, db.color));
});

console.log("Generated all React components successfully.");
