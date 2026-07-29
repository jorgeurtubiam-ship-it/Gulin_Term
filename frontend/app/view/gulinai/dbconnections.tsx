// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import { WOS, globalStore, createBlock } from "@/store/global";
import { DBConnectionInfo } from "@/app/aipanel/aitypes";
import { getApi } from "@/store/global";
import { uxCloseBlock } from "@/app/store/keymodel";
import { WindowService } from "@/app/store/services";
import { getWebServerEndpoint } from "@/util/endpoints";
import { DBConnectionsView } from "./dbconn-ui";
import "./dbconnections.scss";


class DBConnectionsViewModel implements ViewModel {
    viewType: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    blockId: string;
    blockAtom: jotai.Atom<Block>;
    viewIcon: jotai.Atom<string>;
    viewText: jotai.Atom<string>;
    viewName: jotai.Atom<string>;

    dbsAtom = jotai.atom<DBConnectionInfo[]>([]);
    loadingAtom = jotai.atom<boolean>(true);
    selectedConnAtom = jotai.atom<string | null>(null) as jotai.WritableAtom<string | null, [string | null], unknown>;
    schemasAtom = jotai.atom<string[]>([]) as jotai.WritableAtom<string[], [string[]], unknown>;
    selectedSchemaAtom = jotai.atom<string | null>(null) as jotai.WritableAtom<string | null, [string | null], unknown>;
    tablesAtom = jotai.atom<Record<string, number>>({}) as jotai.WritableAtom<Record<string, number>, [Record<string, number>], unknown>;
    typeObjectsAtom = jotai.atom<Record<string, string[]>>({});
    loadingTablesAtom = jotai.atom<boolean>(false);
    loadingSchemasAtom = jotai.atom<boolean>(false);
    loadingTypeAtom = jotai.atom<Record<string, boolean>>({});

    // #6: Query History
    historyAtom = jotai.atom<{ id: string; sql: string; conn: string; timestamp: Date; rows: number }[]>([]);
    // #9: Side-by-side comparison
    sideBySideAtom = jotai.atom<boolean>(false);
    sideBySideTabsAtom = jotai.atom<string[]>([]);
    // #10: Presentation mode
    presentationModeAtom = jotai.atom<boolean>(false);
    // #4: Tab type (sql | mongodb)
    tabTypeAtom = jotai.atom<Record<string, 'sql' | 'mongodb'>>({});
    // #8: Schema search filter
    schemaSearchAtom = jotai.atom<string>("");

    tabsAtom = jotai.atom<{ id: string; name: string; content: string; type: 'sql' | 'table-detail' | 'mongodb'; table?: string, subTab?: string, isExternal?: boolean }[]>([
        { id: "new-1", name: "query-1.sql", content: "-- Escribe tu consulta aquí\nSELECT * FROM all_objects WHERE rownum <= 10", type: 'sql', isExternal: false }
    ]) as jotai.WritableAtom<{ id: string; name: string; content: string; type: 'sql' | 'table-detail' | 'mongodb'; table?: string, subTab?: string, isExternal?: boolean }[], [any], unknown>;
    activeTabIdAtom = jotai.atom<string>("new-1") as jotai.WritableAtom<string, [string], unknown>;
    resultsAtom = jotai.atom<Record<string, { columns: string[]; rows: any[] } | null>>({}) as jotai.WritableAtom<Record<string, { columns: string[]; rows: any[] } | null>, [any], unknown>;
    executingAtom = jotai.atom<boolean>(false) as jotai.WritableAtom<boolean, [boolean], unknown>;
    errorAtom = jotai.atom<string | null>(null) as jotai.WritableAtom<string | null, [string | null], unknown>;

    // Table Detail Atoms
    tableColumnsAtom = jotai.atom<any[]>([]) as jotai.WritableAtom<any[], [any[]], unknown>;
    tableIndexesAtom = jotai.atom<any[]>([]) as jotai.WritableAtom<any[], [any[]], unknown>;
    tableConstraintsAtom = jotai.atom<any[]>([]) as jotai.WritableAtom<any[], [any[]], unknown>;
    tableTriggersAtom = jotai.atom<any[]>([]) as jotai.WritableAtom<any[], [any[]], unknown>;
    tableScriptAtom = jotai.atom<string>("") as jotai.WritableAtom<string, [string], unknown>;
    loadingDetailAtom = jotai.atom<boolean>(false) as jotai.WritableAtom<boolean, [boolean], unknown>;
    designModeAtom = jotai.atom<boolean>(false) as jotai.WritableAtom<boolean, [boolean], unknown>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "db-connections";
        this.blockId = blockId;
        this.blockAtom = WOS.getGulinObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = jotai.atom<string>("database") as jotai.WritableAtom<string, [string], unknown>;
        this.viewName = jotai.atom<string>("DB Explorer") as jotai.WritableAtom<string, [string], unknown>;
        this.viewText = jotai.atom<string>("DB Explorer") as jotai.WritableAtom<string, [string], unknown>;
        this.loadData();
    }

    async loadData() {
        globalStore.set(this.loadingAtom, true);
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-list`, { headers });
            if (!resp.ok) return;
            const dbs = await resp.json();
            globalStore.set(this.dbsAtom, dbs || []);
        } catch (e) {
            console.error("Error loading db connections", e);
        } finally {
            globalStore.set(this.loadingAtom, false);
        }
    }

    async selectConnection(connName: string | null) {
        globalStore.set(this.selectedConnAtom, connName);
        if (!connName) {
            globalStore.set(this.tablesAtom, {});
            globalStore.set(this.typeObjectsAtom, {});
            globalStore.set(this.schemasAtom, []);
            globalStore.set(this.selectedSchemaAtom, null);
            return;
        }

        // Fetch schemas first
        globalStore.set(this.loadingSchemasAtom, true);
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-schema?connection=${encodeURIComponent(connName)}&mode=list-users`, { headers });
            if (resp.ok) {
                const schemas = await resp.json();
                globalStore.set(this.schemasAtom, schemas || []);
            }
        } catch (e) {
            console.error("Error loading schemas", e);
        } finally {
            globalStore.set(this.loadingSchemasAtom, false);
        }

        // Ensure we load the schema objects right away
        await this.loadSchemaObjects(connName, null);
    }

    handleExternalQuery(query: { id: string; name: string; connection: string; data: any[] }) {
        const tabs = globalStore.get(this.tabsAtom);
        const newId = `ext-${query.id}`;
        
        // Si ya existe un tab con el mismo ID, o con la misma consulta exacta (name), lo reusamos
        const existingTab = tabs.find(t => t.id === newId || t.name === query.name);
        
        if (existingTab) {
            globalStore.set(this.activeTabIdAtom, existingTab.id);
            globalStore.set(this.selectedConnAtom, query.connection);
            globalStore.set(this.resultsAtom, {
                ...globalStore.get(this.resultsAtom),
                [existingTab.id]: {
                    columns: query.data && query.data?.length > 0 ? Object.keys(query.data[0]) : [],
                    rows: query.data
                }
            });
            return;
        }

        const newTab = {
            id: newId,
            name: query.name,
            content: "-- Consulta desde Chat\n" + query.name,
            type: 'table-detail' as const,
            subTab: 'Data',
            table: query.name,
            isExternal: true
        };

        globalStore.set(this.tabsAtom, [...tabs, newTab]);
        globalStore.set(this.activeTabIdAtom, newId);
        globalStore.set(this.selectedConnAtom, query.connection);
        globalStore.set(this.resultsAtom, {
            ...globalStore.get(this.resultsAtom),
            [newId]: {
                columns: query.data && query.data?.length > 0 ? Object.keys(query.data[0]) : [],
                rows: query.data
            }
        });
    }

    async loadSchemaObjects(connName: string, owner: string | null) {
        globalStore.set(this.selectedSchemaAtom, owner);
        globalStore.set(this.loadingTablesAtom, true);
        globalStore.set(this.typeObjectsAtom, {});
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            let url = `${endpoint}/gulin/db-schema?connection=${encodeURIComponent(connName)}`;
            if (owner) url += `&owner=${encodeURIComponent(owner)}`;
            const resp = await fetch(url, { headers });
            if (!resp.ok) return;
            const tables = await resp.json();
            globalStore.set(this.tablesAtom, tables || {});
        } catch (e) {
            console.error("Error loading tables", e);
        } finally {
            globalStore.set(this.loadingTablesAtom, false);
        }
    }

    async loadTypeObjects(connName: string, type: string) {
        const owner = globalStore.get(this.selectedSchemaAtom);
        const loaded = globalStore.get(this.typeObjectsAtom)[type];
        if (loaded) return;

        globalStore.set(this.loadingTypeAtom, { ...globalStore.get(this.loadingTypeAtom), [type]: true });
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            let url = `${endpoint}/gulin/db-schema?connection=${encodeURIComponent(connName)}&type=${encodeURIComponent(type)}`;
            if (owner) url += `&owner=${encodeURIComponent(owner)}`;
            const resp = await fetch(url, { headers });
            if (!resp.ok) return;
            const list = await resp.json();
            globalStore.set(this.typeObjectsAtom, { ...globalStore.get(this.typeObjectsAtom), [type]: list || [] });
        } catch (e) {
            console.error("Error loading type objects", e);
        } finally {
            globalStore.set(this.loadingTypeAtom, { ...globalStore.get(this.loadingTypeAtom), [type]: false });
        }
    }

    async runQuery(connName: string) {
        const activeId = globalStore.get(this.activeTabIdAtom);
        const tabs = globalStore.get(this.tabsAtom);
        const tab = tabs.find(t => t.id === activeId);
        if (!tab || !tab.content) return;

        // Strip trailing semicolon for Oracle compatibility
        let sql = tab.content.trim();
        if (sql.endsWith(';')) sql = sql.substring(0, sql.length - 1);

        globalStore.set(this.executingAtom, true);
        globalStore.set(this.errorAtom, null);
        globalStore.set(this.resultsAtom, { ...globalStore.get(this.resultsAtom), [activeId]: null });
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-query?connection=${encodeURIComponent(connName)}&sql=${encodeURIComponent(sql)}&tabid=studio`, { headers });
            if (!resp.ok) {
                const errMsg = await resp.text();
                throw new Error(errMsg || "Error desconocido al ejecutar la consulta");
            }
            const data = await resp.json();
            globalStore.set(this.resultsAtom, { ...globalStore.get(this.resultsAtom), [activeId]: data });
            
            // #6: Add to history
            const history = globalStore.get(this.historyAtom);
            globalStore.set(this.historyAtom, [{
                id: activeId,
                sql: sql,
                conn: connName,
                timestamp: new Date(),
                rows: data?.rows?.length || 0
            }, ...history].slice(0, 50));
        } catch (e) {
            console.error("Error running query", e);
            globalStore.set(this.errorAtom, e instanceof Error ? e.message : String(e));
        } finally {
            globalStore.set(this.executingAtom, false);
        }
    }

    // #4: MongoDB Query Runner
    async runMongoQuery(connName: string) {
        const activeId = globalStore.get(this.activeTabIdAtom);
        const tabs = globalStore.get(this.tabsAtom);
        const tab = tabs.find(t => t.id === activeId);
        if (!tab || !tab.content) return;

        globalStore.set(this.executingAtom, true);
        globalStore.set(this.errorAtom, null);
        globalStore.set(this.resultsAtom, { ...globalStore.get(this.resultsAtom), [activeId]: null });
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-query?connection=${encodeURIComponent(connName)}&sql=${encodeURIComponent(tab.content)}&tabid=mongodb`, { headers });
            if (!resp.ok) {
                const errMsg = await resp.text();
                throw new Error(errMsg || "Error al ejecutar consulta MongoDB");
            }
            const data = await resp.json();
            globalStore.set(this.resultsAtom, { ...globalStore.get(this.resultsAtom), [activeId]: data });
        } catch (e) {
            console.error("Error running mongo query", e);
            globalStore.set(this.errorAtom, e instanceof Error ? e.message : String(e));
        } finally {
            globalStore.set(this.executingAtom, false);
        }
    }

    // #1: Get Monaco auto-complete suggestions from real schema
    async getCompletions(connName: string): Promise<{ label: string; kind: string; insertText: string; detail: string }[]> {
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-schema?connection=${encodeURIComponent(connName)}&mode=completions`, { headers });
            if (!resp.ok) return [];
            return await resp.json();
        } catch {
            return [];
        }
    }

    async sendToDashboard(connName: string) {
        const activeId = globalStore.get(this.activeTabIdAtom);
        const tabs = globalStore.get(this.tabsAtom);
        const tab = tabs.find(t => t.id === activeId);
        const results = globalStore.get(this.resultsAtom)?.[activeId];
        
        if (!tab || !tab.content) return;
        
        // Si no hay resultados aún, ejecutar primero
        if (!results || !results.rows || results.rows.length === 0) {
            await this.runQuery(connName);
            // Esperar a que se actualicen los atoms
            await new Promise(r => setTimeout(r, 500));
        }
        
        const finalResults = globalStore.get(this.resultsAtom)?.[activeId];
        if (!finalResults || !finalResults.rows || finalResults.rows.length === 0) return;
        
        // Convertir results al formato dashboard
        const chartData = finalResults.rows;
        const title = `📊 ${tab.name?.replace('.sql', '') || 'Query'}`;
        
        createBlock({ 
            meta: { 
                view: "dashboard",
                "dashboard:data": JSON.stringify(chartData),
                "dashboard:title": title,
                "dashboard:type": "bar",
                "dashboard:connection": connName,
                "dashboard:sql": tab.content
            } as any 
        });
    }

    async sendResultsToDashboard(results: { columns: string[]; rows: any[] }, title: string) {
        if (!results || !results.rows || results.rows.length === 0) return;
        
        createBlock({ 
            meta: { 
                view: "dashboard",
                "dashboard:data": JSON.stringify(results.rows),
                "dashboard:title": `📊 ${title}`,
                "dashboard:type": "bar"
            } as any 
        });
    }

    // #5: Export to XLSX
    async exportToXLSX(results: { columns: string[]; rows: any[] }, title: string) {
        if (!results || !results.rows || results.rows.length === 0) return;
        try {
            const XLSX = await import('xlsx');
            const ws = XLSX.utils.json_to_sheet(results.rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Data');
            XLSX.writeFile(wb, `${title.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`);
        } catch (e) {
            console.error('XLSX export error:', e);
            // Fallback to CSV
            this.exportToCSV(results, title);
        }
    }

    // #5: Export to CSV (enhanced)
    exportToCSV(results: { columns: string[]; rows: any[] }, title: string) {
        if (!results || !results.rows || results.rows.length === 0) return;
        const keys = results.columns;
        const csv = [
            keys.join(","),
            ...results.rows.map(row => keys.map(k => `"${row[k] ?? ''}"`).join(","))
        ].join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    // #5: Export to PDF
    async exportToPDF(title: string) {
        try {
            const { default: jsPDF } = await import('jspdf');
            const { default: autoTable } = await import('jspdf-autotable');
            const activeId = globalStore.get(this.activeTabIdAtom);
            const results = globalStore.get(this.resultsAtom)?.[activeId];
            if (!results || !results.rows) return;
            
            const doc = new jsPDF();
            doc.setFontSize(16);
            doc.text(title, 14, 20);
            
            const headers = results.columns.map(c => ({ header: c, dataKey: c }));
            const rows = results.rows.map(row => results.columns.map(c => row[c]));
            
            autoTable(doc, {
                head: [results.columns],
                body: rows,
                startY: 30,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [88, 28, 135] }
            });
            doc.save(`${title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
        } catch (e) {
            console.error('PDF export error:', e);
        }
    }

    // #5: Copy to clipboard as Markdown table
    copyAsMarkdown(results: { columns: string[]; rows: any[] }) {
        if (!results || !results.rows) return;
        const header = `| ${results.columns.join(' | ')} |`;
        const sep = `| ${results.columns.map(() => '---').join(' | ')} |`;
        const body = results.rows.map(row => `| ${results.columns.map(c => row[c] ?? '').join(' | ')} |`).join('\n');
        const md = `${header}\n${sep}\n${body}`;
        navigator.clipboard.writeText(md);
    }

    // #7: Explain query with Gulin AI
    async explainQueryWithAI(sql: string) {
        if (!sql) return;
        const encoded = encodeURIComponent(sql.substring(0, 500));
        const endpoint = getWebServerEndpoint();
        try {
            const resp = await fetch(`${endpoint}/gulin/ai/explain?sql=${encoded}&type=sqlexplain`, {
                headers: { "X-AuthKey": getApi().getAuthKey() }
            });
            if (!resp.ok) throw new Error('Error calling AI');
            const data = await resp.json();
            // Open result as block
            createBlock({
                meta: {
                    view: "gulin-ai",
                    "ai:prompt": `Explica esta consulta:\n\n${sql}`,
                    "ai:response": data.explanation || data.text || JSON.stringify(data),
                    "ai:context": "sql-explain"
                }
            });
        } catch (e) {
            console.error('AI explain error:', e);
            // Fallback: open Gulin AI with the query as context
            createBlock({
                meta: {
                    view: "gulin-ai",
                    "ai:preset": "sql-expert",
                    "ai:prompt": `Analiza y optimiza esta consulta SQL:\n\n${sql}\n\nExplica qué hace, posibles problemas de rendimiento y sugerencias de optimización.`
                }
            });
        }
    }

    // #9: Toggle side-by-side comparison
    toggleSideBySide() {
        const current = globalStore.get(this.sideBySideAtom);
        if (current) {
            globalStore.set(this.sideBySideAtom, false);
            globalStore.set(this.sideBySideTabsAtom, []);
        } else {
            // Collect all tab IDs that have results
            const results = globalStore.get(this.resultsAtom);
            const tabs = globalStore.get(this.tabsAtom);
            const withData = tabs.filter(t => results[t.id]?.rows?.length > 0).map(t => t.id);
            globalStore.set(this.sideBySideAtom, true);
            globalStore.set(this.sideBySideTabsAtom, withData.slice(0, 3));
        }
    }

    // #10: Toggle presentation mode
    togglePresentationMode() {
        const current = globalStore.get(this.presentationModeAtom);
        globalStore.set(this.presentationModeAtom, !current);
    }

    // #4: Add MongoDB tab
    addMongoTab() {
        const tabs = globalStore.get(this.tabsAtom);
        const newId = `mongo-${Date.now()}`;
        globalStore.set(this.tabsAtom, [...tabs, { 
            id: newId, 
            name: `mongo-${(tabs?.length || 0) + 1}.json`, 
            content: `{
  "find": "collection_name",
  "filter": {},
  "limit": 10
}`, 
            type: 'mongodb'
        }]);
        globalStore.set(this.activeTabIdAtom, newId);
    }

    removeTab(id: string) {
        const tabs = globalStore.get(this.tabsAtom);
        const activeId = globalStore.get(this.activeTabIdAtom);
        const filtered = tabs.filter(t => t.id !== id);
        globalStore.set(this.tabsAtom, filtered);
        if (activeId === id && filtered?.length > 0) {
            globalStore.set(this.activeTabIdAtom, filtered[filtered.length - 1].id);
        } else if (filtered?.length === 0) {
            globalStore.set(this.activeTabIdAtom, "");
            this.addTab('sql');
        }
    }

    updateSubTab(id: string, subTab: string) {
        const tabs = globalStore.get(this.tabsAtom);
        globalStore.set(this.tabsAtom, tabs.map(t => t.id === id ? { ...t, subTab } : t));
        
        const tab = tabs.find(t => t.id === id);
        if (!tab || !tab.table) return;

        const conn = globalStore.get(this.selectedConnAtom)!;
        if (subTab === 'Data') {
            this.loadTableData(conn, tab.table);
        } else if (subTab === 'Columns') {
            this.loadTableDetail(conn, tab.table);
        } else if (subTab === 'Indexes') {
            this.loadTableIndexes(conn, tab.table);
        } else if (subTab === 'Constraints') {
            this.loadTableConstraints(conn, tab.table);
        } else if (subTab === 'Triggers') {
            this.loadTableTriggers(conn, tab.table);
        } else if (subTab === 'Script') {
            this.loadTableScript(conn, tab.table);
        }
    }

    async loadTableIndexes(connName: string, tableName: string) {
        const owner = globalStore.get(this.selectedSchemaAtom);
        globalStore.set(this.loadingDetailAtom, true);
        try {
            const sql = `SELECT index_name, index_type, uniqueness, status FROM all_indexes WHERE table_name = '${tableName}' ${owner ? `AND owner = '${owner}'` : ""}`;
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-query?connection=${encodeURIComponent(connName)}&sql=${encodeURIComponent(sql)}&tabid=studio`, { headers });
            if (resp.ok) {
                const data = await resp.json();
                globalStore.set(this.tableIndexesAtom, data.rows || []);
            }
        } catch (e) { console.error(e); } finally { globalStore.set(this.loadingDetailAtom, false); }
    }

    async loadTableConstraints(connName: string, tableName: string) {
        const owner = globalStore.get(this.selectedSchemaAtom);
        globalStore.set(this.loadingDetailAtom, true);
        try {
            const sql = `SELECT constraint_name, constraint_type, status, search_condition FROM all_constraints WHERE table_name = '${tableName}' ${owner ? `AND owner = '${owner}'` : ""}`;
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-query?connection=${encodeURIComponent(connName)}&sql=${encodeURIComponent(sql)}&tabid=studio`, { headers });
            if (resp.ok) {
                const data = await resp.json();
                globalStore.set(this.tableConstraintsAtom, data.rows || []);
            }
        } catch (e) { console.error(e); } finally { globalStore.set(this.loadingDetailAtom, false); }
    }

    async loadTableTriggers(connName: string, tableName: string) {
        const owner = globalStore.get(this.selectedSchemaAtom);
        globalStore.set(this.loadingDetailAtom, true);
        try {
            const sql = `SELECT trigger_name, trigger_type, triggering_event, status FROM all_triggers WHERE table_name = '${tableName}' ${owner ? `AND owner = '${owner}'` : ""}`;
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-query?connection=${encodeURIComponent(connName)}&sql=${encodeURIComponent(sql)}&tabid=studio`, { headers });
            if (resp.ok) {
                const data = await resp.json();
                globalStore.set(this.tableTriggersAtom, data.rows || []);
            }
        } catch (e) { console.error(e); } finally { globalStore.set(this.loadingDetailAtom, false); }
    }

    async loadTableScript(connName: string, tableName: string) {
        const owner = globalStore.get(this.selectedSchemaAtom);
        globalStore.set(this.loadingDetailAtom, true);
        try {
            const sql = `SELECT dbms_metadata.get_ddl('TABLE', '${tableName}'${owner ? `, '${owner}'` : ""}) FROM dual`;
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-query?connection=${encodeURIComponent(connName)}&sql=${encodeURIComponent(sql)}&tabid=studio-script`, { headers });
            if (resp.ok) {
                const data = await resp.text();
                globalStore.set(this.tableScriptAtom, data || "-- No se pudo generar el script");
            }
        } catch (e) { console.error(e); } finally { globalStore.set(this.loadingDetailAtom, false); }
    }

    async loadTableData(connName: string, tableName: string) {
        const owner = globalStore.get(this.selectedSchemaAtom);
        globalStore.set(this.executingAtom, true);
        globalStore.set(this.errorAtom, null);
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const sql = `SELECT * FROM ${owner ? `${owner}.` : ""}${tableName} WHERE rownum <= 100`;
            const resp = await fetch(`${endpoint}/gulin/db-query?connection=${encodeURIComponent(connName)}&sql=${encodeURIComponent(sql)}&tabid=studio`, { headers });
            if (!resp.ok) throw new Error("Error cargando datos");
            const data = await resp.json();
            const activeId = globalStore.get(this.activeTabIdAtom);
            globalStore.set(this.resultsAtom, { ...globalStore.get(this.resultsAtom), [activeId]: data });
        } catch (e) {
            globalStore.set(this.errorAtom, String(e));
        } finally {
            globalStore.set(this.executingAtom, false);
        }
    }

    async loadTableDetail(connName: string, tableName: string) {
        const owner = globalStore.get(this.selectedSchemaAtom);
        globalStore.set(this.loadingDetailAtom, true);
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            // Query for columns
            const sql = `SELECT column_name, data_type, data_length, nullable, data_default FROM all_tab_columns WHERE table_name = '${tableName}' ${owner ? `AND owner = '${owner}'` : ""} ORDER BY column_id`;
            const resp = await fetch(`${endpoint}/gulin/db-query?connection=${encodeURIComponent(connName)}&sql=${encodeURIComponent(sql)}&tabid=studio`, { headers });
            if (resp.ok) {
                const data = await resp.json();
                globalStore.set(this.tableColumnsAtom, data.rows || []);
            }
        } catch (e) {
            console.error("Error loading table detail", e);
        } finally {
            globalStore.set(this.loadingDetailAtom, false);
        }
    }

    addTab(type: 'sql' | 'table-detail' = 'sql', name?: string, table?: string) {
        const tabs = globalStore.get(this.tabsAtom);
        const newId = `new-${Date.now()}`;
        globalStore.set(this.tabsAtom, [...tabs, { 
            id: newId, 
            name: name || `query-${(tabs?.length || 0) + 1}.sql`, 
            content: "", 
            type,
            table,
            subTab: 'Columns'
        }]);
        globalStore.set(this.activeTabIdAtom, newId);
        
        if (type === 'table-detail' && table) {
            this.loadTableDetail(globalStore.get(this.selectedConnAtom)!, table);
        }
    }

    updateTabContent(id: string, content: string) {
        const tabs = globalStore.get(this.tabsAtom);
        globalStore.set(this.tabsAtom, tabs.map(t => t.id === id ? { ...t, content } : t));
    }
    async exploreTable(connName: string, tableName: string) {
        this.addTab('table-detail', tableName, tableName);
    }


    async testConnection(connName: string) {
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-test?connection=${encodeURIComponent(connName)}`, { headers });
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(text || "Error testing connection");
            }
            alert(`Conexión '${connName}' exitosa.`);
        } catch (e: any) {
            console.error("Error testing connection", e);
            alert(`Error al probar conexión:\n${e.message}`);
        }
    }

    async deleteConnection(connName: string) {
        if (!confirm(`¿Estás seguro de que quieres eliminar la conexión '${connName}'?`)) return;
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-delete?connection=${encodeURIComponent(connName)}`, { headers });
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(text || "Error deleting connection");
            }
            await this.loadData();
            if (globalStore.get(this.selectedConnAtom) === connName) {
                globalStore.set(this.selectedConnAtom, null);
                globalStore.set(this.tablesAtom, {});
            }
        } catch (e: any) {
            console.error("Error deleting connection", e);
            alert(`Error al eliminar conexión:\n${e.message}`);
        }
    }

    async saveConnection(connName: string, type: string, url: string) {
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { 
                "X-AuthKey": getApi().getAuthKey(),
                "Content-Type": "application/json"
            };
            const resp = await fetch(`${endpoint}/gulin/db-save`, { 
                method: "POST",
                headers,
                body: JSON.stringify({ name: connName, type, url })
            });
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(text || "Error saving connection");
            }
            await this.loadData();
        } catch (e: any) {
            console.error("Error saving connection", e);
            alert(`Error al guardar conexión:\n${e.message}`);
            throw e;
        }
    }

    get viewComponent(): ViewComponent {
        return DBConnectionsView;
    }
}


export { DBConnectionsViewModel };
