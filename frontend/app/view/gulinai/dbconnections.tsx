// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import { WOS, globalStore, createBlock } from "@/store/global";
import { DBConnectionInfo } from "@/app/aipanel/aitypes";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import Editor from "@monaco-editor/react";
import { getApi } from "@/store/global";
import { getWebServerEndpoint } from "@/util/endpoints";
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

    tabsAtom = jotai.atom<{ id: string; name: string; content: string; type: 'sql' | 'table-detail'; table?: string, subTab?: string, isExternal?: boolean }[]>([
        { id: "new-1", name: "query-1.sql", content: "-- Escribe tu consulta aquí\nSELECT * FROM all_objects WHERE rownum <= 10", type: 'sql', isExternal: false }
    ]) as jotai.WritableAtom<{ id: string; name: string; content: string; type: 'sql' | 'table-detail'; table?: string, subTab?: string, isExternal?: boolean }[], [any], unknown>;
    activeTabIdAtom = jotai.atom<string>("new-1") as jotai.WritableAtom<string, [string], unknown>;
    resultsAtom = jotai.atom<{ columns: string[]; rows: any[] } | null>(null) as jotai.WritableAtom<{ columns: string[]; rows: any[] } | null, [any], unknown>;
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
        
        // Don't add if already exists (check by name/id)
        if (tabs.find(t => t.id === newId)) return;

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
            columns: query.data && query.data.length > 0 ? Object.keys(query.data[0]) : [],
            rows: query.data
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
        globalStore.set(this.resultsAtom, null);
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/db-query?connection=${encodeURIComponent(connName)}&sql=${encodeURIComponent(sql)}&tabid=studio`, { headers });
            if (!resp.ok) {
                const errMsg = await resp.text();
                throw new Error(errMsg || "Error desconocido al ejecutar la consulta");
            }
            const data = await resp.json();
            globalStore.set(this.resultsAtom, data);
        } catch (e) {
            console.error("Error running query", e);
            globalStore.set(this.errorAtom, e instanceof Error ? e.message : String(e));
        } finally {
            globalStore.set(this.executingAtom, false);
        }
    }

    removeTab(id: string) {
        const tabs = globalStore.get(this.tabsAtom);
        const activeId = globalStore.get(this.activeTabIdAtom);
        const filtered = tabs.filter(t => t.id !== id);
        globalStore.set(this.tabsAtom, filtered);
        if (activeId === id && filtered.length > 0) {
            globalStore.set(this.activeTabIdAtom, filtered[filtered.length - 1].id);
        } else if (filtered.length === 0) {
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
            globalStore.set(this.resultsAtom, data);
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
            name: name || `query-${tabs.length + 1}.sql`, 
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

function DBConnectionsView({ model }: { model: DBConnectionsViewModel }) {
    const dbs = jotai.useAtomValue(model.dbsAtom) || [];
    const loading = jotai.useAtomValue(model.loadingAtom);
    const selectedConn = jotai.useAtomValue(model.selectedConnAtom);
    const tables = jotai.useAtomValue(model.tablesAtom);
    const typeObjects = jotai.useAtomValue(model.typeObjectsAtom);
    const schemas = jotai.useAtomValue(model.schemasAtom);
    const selectedSchema = jotai.useAtomValue(model.selectedSchemaAtom);
    const loadingTables = jotai.useAtomValue(model.loadingTablesAtom);
    const loadingSchemas = jotai.useAtomValue(model.loadingSchemasAtom);
    const loadingType = jotai.useAtomValue(model.loadingTypeAtom);

    const tabs = jotai.useAtomValue(model.tabsAtom);
    const activeTabId = jotai.useAtomValue(model.activeTabIdAtom);
    const results = jotai.useAtomValue(model.resultsAtom);
    const executing = jotai.useAtomValue(model.executingAtom);
    const error = jotai.useAtomValue(model.errorAtom);

    const tableColumns = jotai.useAtomValue(model.tableColumnsAtom);
    const tableIndexes = jotai.useAtomValue(model.tableIndexesAtom);
    const tableConstraints = jotai.useAtomValue(model.tableConstraintsAtom);
    const tableTriggers = jotai.useAtomValue(model.tableTriggersAtom);
    const tableScript = jotai.useAtomValue(model.tableScriptAtom);
    const loadingDetail = jotai.useAtomValue(model.loadingDetailAtom);
    const designMode = jotai.useAtomValue(model.designModeAtom);

    const activeTab = tabs.find(t => t.id === activeTabId);

    const [editingConn, setEditingConn] = React.useState<string | null>(null);
    const [editUrl, setEditUrl] = React.useState<string>("");
    const [editType, setEditType] = React.useState<string>("");
    const [expandedGroups, setExpandedGroups] = React.useState<Record<string, boolean>>({});

    const block = jotai.useAtomValue(model.blockAtom);
    const [lastProcessedQueryId, setLastProcessedQueryId] = React.useState<string | null>(null);

    React.useEffect(() => {
        const extQuery = block?.meta?.['db:external-query'] as any;
        console.log("DB Explorer Metadata Update:", block?.meta);
        if (extQuery && extQuery.id !== lastProcessedQueryId) {
            console.log("Processing External Query:", extQuery.id, extQuery.name);
            setLastProcessedQueryId(extQuery.id);
            model.handleExternalQuery(extQuery);
        }
    }, [block?.meta, lastProcessedQueryId, model]);

    const toggleGroup = async (type: string) => {
        const isExpanding = !expandedGroups[type];
        setExpandedGroups(prev => ({
            ...prev,
            [type]: isExpanding
        }));
        if (isExpanding && selectedConn) {
            await model.loadTypeObjects(selectedConn, type);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-zinc-500">
                <i className="fa fa-spinner fa-spin mr-3 text-purple-500"></i> Cargando...
            </div>
        );
    }

    const renderConnections = () => (
        <div className="flex flex-col gap-3">
            {dbs.map(db => {
                const isEditing = editingConn === db.name;
                return (
                    <div
                        key={db.name}
                        className="group connection-card border border-zinc-800 p-5 rounded-2xl flex flex-col gap-2 hover:border-purple-500/50 transition-all shadow-sm hover:shadow-purple-500/10"
                    >
                        {!isEditing ? (
                            <div className="flex items-center justify-between cursor-pointer" onClick={() => model.selectConnection(db.name)}>
                                <div className="flex items-center gap-4">
                                    <div className="bg-purple-500/10 w-10 h-10 flex items-center justify-center rounded-lg text-purple-400 group-hover:bg-purple-500/20 transition-colors">
                                        <i className="fa fa-database text-sm"></i>
                                    </div>
                                    <div>
                                        <div className="text-sm font-bold text-white group-hover:text-purple-300 transition-colors">{db.name}</div>
                                        <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">{db.type}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <button onClick={() => model.testConnection(db.name)} className="bg-zinc-800 hover:bg-blue-500/20 text-blue-400 p-1.5 rounded-md text-[10px] transition-all" title="Probar Conexión">
                                        <i className="fa fa-plug"></i>
                                    </button>
                                    <button onClick={() => { 
                                        setEditingConn(db.name); 
                                        setEditUrl(db.url || ""); 
                                        setEditType(db.type); 
                                        
                                        // Pre-fill oracle fields if it's oracle
                                        if (db.type === 'oracle' && db.url) {
                                            try {
                                                const urlStr = db.url.startsWith('oracle://') ? db.url : `oracle://${db.url}`;
                                                const parsed = new URL(urlStr);
                                                setTimeout(() => {
                                                    const userEl = document.getElementById(`edit-user-${db.name}`) as HTMLInputElement;
                                                    const passEl = document.getElementById(`edit-pass-${db.name}`) as HTMLInputElement;
                                                    const hostEl = document.getElementById(`edit-host-${db.name}`) as HTMLInputElement;
                                                    const portEl = document.getElementById(`edit-port-${db.name}`) as HTMLInputElement;
                                                    const svcEl = document.getElementById(`edit-svc-${db.name}`) as HTMLInputElement;
                                                    
                                                    if (userEl) userEl.value = decodeURIComponent(parsed.username);
                                                    if (passEl) passEl.value = decodeURIComponent(parsed.password);
                                                    if (hostEl) hostEl.value = parsed.hostname;
                                                    if (portEl) portEl.value = parsed.port || "1521";
                                                    if (svcEl) svcEl.value = parsed.pathname.replace(/^\//, "") || "ORCL";
                                                }, 50);
                                            } catch (e) { console.error("Error parsing oracle url", e); }
                                        }
                                    }} className="bg-zinc-800 hover:bg-green-500/20 text-green-400 p-1.5 rounded-md text-[10px] transition-all" title="Editar">
                                        <i className="fa fa-pencil"></i>
                                    </button>
                                    <button onClick={() => model.deleteConnection(db.name)} className="bg-zinc-800 hover:bg-red-500/20 text-red-400 p-1.5 rounded-md text-[10px] transition-all" title="Eliminar">
                                        <i className="fa fa-trash"></i>
                                    </button>
                                    <i className="fa fa-chevron-right text-[10px] text-zinc-700 group-hover:text-purple-500 group-hover:translate-x-1 transition-all ml-2"></i>

                                </div>
                            </div>
                        ) : (
                                <div className="flex flex-col gap-3 mt-2 bg-[#09090b] p-4 rounded-xl border border-zinc-800 animate-in fade-in zoom-in-95 duration-200">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-sm font-black text-white uppercase tracking-widest">{db.name}</div>
                                        <div className="text-[9px] text-zinc-500 font-mono opacity-50">Configuración de Conexión</div>
                                    </div>
                                    <select 
                                        value={editType} 
                                        onChange={(e) => setEditType(e.target.value)}
                                        className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-purple-500 transition-all font-bold"
                                    >
                                        <option value="oracle">Oracle (go-ora)</option>
                                        <option value="postgres">PostgreSQL</option>
                                        <option value="mysql">MySQL / MariaDB</option>
                                        <option value="mssql">SQL Server</option>
                                        <option value="sqlite">SQLite</option>
                                        <option value="mongodb">MongoDB</option>
                                        <option value="odbc">ODBC / Generic</option>
                                    </select>

                                    {editType === "oracle" ? (
                                        <div className="grid grid-cols-2 gap-2 animate-in slide-in-from-top-1">
                                            <div className="flex flex-col gap-1">
                                                <label className="text-[9px] text-zinc-500 uppercase font-black px-1">Usuario</label>
                                                <input type="text" id={`edit-user-${db.name}`} placeholder="SYSTEM" className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white outline-none focus:border-purple-500" />
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <label className="text-[9px] text-zinc-500 uppercase font-black px-1">Password</label>
                                                <input type="password" id={`edit-pass-${db.name}`} placeholder="••••••••" className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white outline-none focus:border-purple-500" />
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <label className="text-[9px] text-zinc-500 uppercase font-black px-1">Host</label>
                                                <input type="text" id={`edit-host-${db.name}`} placeholder="localhost" className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white outline-none focus:border-purple-500" />
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <label className="text-[9px] text-zinc-500 uppercase font-black px-1">Puerto / Servicio</label>
                                                <div className="flex gap-1">
                                                    <input type="text" id={`edit-port-${db.name}`} placeholder="1521" className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white outline-none focus:border-purple-500 w-16" />
                                                    <input type="text" id={`edit-svc-${db.name}`} placeholder="ORCL" className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white outline-none focus:border-purple-500 flex-grow" />
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[9px] text-zinc-500 uppercase font-black px-1">URL de Conexión</label>
                                            <input 
                                                type="text" 
                                                value={editUrl} 
                                                onChange={(e) => setEditUrl(e.target.value)} 
                                                placeholder="postgres://user:pass@host:port/db"
                                                className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-purple-500 w-full font-mono"
                                            />
                                        </div>
                                    )}

                                    <div className="flex gap-2 justify-end mt-4 border-t border-zinc-800/50 pt-4">
                                        <button onClick={() => setEditingConn(null)} className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors">Cancelar</button>
                                        <button 
                                            onClick={async () => { 
                                                let finalUrl = editUrl;
                                                if (editType === 'oracle') {
                                                    const user = (document.getElementById(`edit-user-${db.name}`) as HTMLInputElement)?.value || "";
                                                    const pass = (document.getElementById(`edit-pass-${db.name}`) as HTMLInputElement)?.value || "";
                                                    const host = (document.getElementById(`edit-host-${db.name}`) as HTMLInputElement)?.value || "localhost";
                                                    const port = (document.getElementById(`edit-port-${db.name}`) as HTMLInputElement)?.value || "1521";
                                                    const svc = (document.getElementById(`edit-svc-${db.name}`) as HTMLInputElement)?.value || "ORCL";
                                                    finalUrl = `oracle://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${svc}`;
                                                }
                                                await model.saveConnection(db.name, editType, finalUrl); 
                                                setEditingConn(null); 
                                            }} 
                                            className="px-6 py-2 text-[10px] font-black uppercase tracking-widest text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-all shadow-lg shadow-purple-500/20 active:scale-95"
                                        >
                                            Guardar Cambios
                                        </button>
                                    </div>
                                </div>
                        )}
                    </div>
                );
            })}
            {dbs.length === 0 && (
                <div className="text-center py-12 border-2 border-dashed border-zinc-800 rounded-2xl bg-zinc-900/20">
                    <i className="fa fa-plus-circle text-zinc-700 text-3xl mb-3"></i>
                    <p className="text-sm text-zinc-500 font-medium">No hay bases de datos.</p>
                    <p className="text-[10px] text-zinc-700 mt-2 uppercase tracking-[0.2em]">Usa db_register_connection</p>
                </div>
            )}
        </div>
    );


    const renderTables = () => (
        <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-right-4 duration-300">

            {loadingTables ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-zinc-600">
                    <i className="fa fa-circle-notch fa-spin text-xl text-purple-500"></i>
                    <span className="text-[10px] uppercase font-bold tracking-widest">Leyendo esquema...</span>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    {(() => {
                        const entries = Object.entries(tables);
                        if (entries.length === 0) {
                            return <p className="text-center text-xs text-zinc-600 py-8 italic">No se encontraron objetos.</p>;
                        }
                        return entries.map(([type, count]) => {
                            const isExpanded = expandedGroups[type];
                            const items = typeObjects[type] || [];
                            const isLoading = loadingType[type];
                            
                            return (
                                <div key={type} className="flex flex-col gap-2">
                                    <div 
                                        className="flex items-center gap-2 px-1 cursor-pointer group/header"
                                        onClick={() => toggleGroup(type)}
                                    >
                                        <div className="flex items-center gap-2 bg-zinc-900 px-2 py-1 rounded border border-zinc-800 hover:border-purple-500/50 transition-colors">
                                            <i className={`fa ${isLoading ? 'fa-circle-notch fa-spin text-purple-500' : `fa-chevron-${isExpanded ? 'down' : 'right'} text-zinc-600`} text-[8px] group-hover/header:text-purple-400 transition-all`}></i>
                                            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest group-hover/header:text-zinc-300 transition-colors">
                                                {type} ({count})
                                            </span>
                                        </div>
                                        <div className="h-[1px] flex-grow bg-zinc-900 group-hover/header:bg-zinc-800 transition-colors"></div>
                                    </div>
                                    
                                    {isExpanded && (
                                        <div className="grid grid-cols-1 gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                            {isLoading && items.length === 0 ? (
                                                <div className="px-6 py-4 text-[9px] text-zinc-600 uppercase tracking-widest flex items-center gap-2">
                                                    <i className="fa fa-spinner fa-spin"></i> Cargando objetos...
                                                </div>
                                            ) : (
                                                items.map(table => (
                                                    <div
                                                        key={table}
                                                        className="bg-zinc-900/40 border border-zinc-800/50 p-3 rounded-lg flex items-center justify-between hover:bg-purple-500/5 hover:border-purple-500/30 transition-all cursor-default group"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <i className={`fa ${
                                                                type === 'TABLE' ? 'fa-table' : 
                                                                type === 'VIEW' ? 'fa-eye' : 
                                                                type === 'INDEX' ? 'fa-search' : 
                                                                type === 'PROCEDURE' ? 'fa-code' :
                                                                type === 'FUNCTION' ? 'fa-cube' :
                                                                type === 'PACKAGE' ? 'fa-archive' :
                                                                type === 'TRIGGER' ? 'fa-bolt' :
                                                                type === 'SEQUENCE' ? 'fa-sort-numeric-asc' :
                                                                type === 'SYNONYM' ? 'fa-link' :
                                                                type === 'TABLESPACE' ? 'fa-hdd-o' :
                                                                type === 'CONSTRAINT' ? 'fa-key' :
                                                                type === 'JOB' ? 'fa-clock-o' :
                                                                type === 'DIRECTORY' ? 'fa-folder-open' :
                                                                type === 'INVALID' ? 'fa-exclamation-triangle text-red-500' :
                                                                'fa-cube'
                                                            } text-xs text-zinc-600 group-hover:text-purple-500 transition-colors`}></i>
                                                            <span className="text-xs text-zinc-300 font-mono group-hover:text-white transition-colors">{table}</span>
                                                        </div>
                                                        {type === 'TABLE' && (
                                                            <button
                                                                onClick={() => selectedConn && model.exploreTable(selectedConn, table)}
                                                                className="opacity-0 group-hover:opacity-100 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 p-1.5 rounded-md text-[10px] transition-all"
                                                                title="Ver registros"
                                                            >
                                                                <i className="fa fa-eye"></i>
                                                            </button>
                                                        )}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        });
                    })()}
                </div>
            )}
        </div>
    );

    return (
        <div className="db-connections-view h-full w-full bg-[#09090b] text-white overflow-hidden animate-in fade-in duration-500">
            {!selectedConn ? (
                <OverlayScrollbarsComponent className="h-full" options={{ scrollbars: { autoHide: "leave" } }}>
                    <div className="max-w-[1400px] mx-auto p-12 flex flex-col gap-12">
                        <div className="flex flex-col gap-3">
                            <h2 className="text-4xl font-black tracking-tighter flex items-center gap-4">
                                <div className="size-12 bg-purple-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-purple-500/20">
                                    <i className="fa fa-database text-white text-2xl"></i>
                                </div>
                                Database Explorer
                            </h2>
                            <p className="text-xs text-zinc-500 uppercase tracking-[0.5em] font-black opacity-40">Infraestructura y Datos</p>
                        </div>
                        {renderConnections()}
                    </div>
                </OverlayScrollbarsComponent>
            ) : (
                <PanelGroup direction="horizontal">
                    {/* SIDEBAR: EXPLORER */}
                    <Panel defaultSize={20} minSize={15} className="border-r border-zinc-800 flex flex-col bg-[#0c0c0e]">
                        <div className="p-4 border-b border-zinc-800/50 bg-[#09090b]/50">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-3">
                                    <button onClick={() => model.selectConnection(null)} className="size-8 flex items-center justify-center hover:bg-zinc-800 rounded-lg text-zinc-500 transition-colors" title="Volver">
                                        <i className="fa fa-arrow-left text-xs"></i>
                                    </button>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-bold text-purple-500 uppercase tracking-tighter leading-none mb-1">Explorando</span>
                                        <span className="text-sm font-black tracking-tight leading-none">{selectedConn}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button 
                                        onClick={() => selectedConn && model.loadSchemaObjects(selectedConn, selectedSchema)} 
                                        className="size-7 flex items-center justify-center hover:bg-zinc-800 rounded-md text-zinc-600 hover:text-purple-400 transition-all"
                                        title="Refrescar Objetos"
                                    >
                                        <i className={`fa fa-refresh text-[10px] ${loadingTables ? 'fa-spin' : ''}`}></i>
                                    </button>
                                    <div className="relative group/select">
                                        <i className="fa fa-user text-[8px] absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600"></i>
                                        <select
                                            value={selectedSchema || ""}
                                            onChange={(e) => model.loadSchemaObjects(selectedConn!, e.target.value || null)}
                                            className="bg-zinc-900 border border-zinc-800 rounded-md pl-6 pr-2 py-1 text-[10px] text-zinc-400 focus:outline-none appearance-none cursor-pointer hover:bg-zinc-800 transition-all font-mono min-w-[80px]"
                                        >
                                            <option value="">ACTUAL</option>
                                            {schemas.map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <OverlayScrollbarsComponent className="flex-grow p-4" options={{ scrollbars: { autoHide: "leave" } }}>
                            {renderTables()}
                        </OverlayScrollbarsComponent>
                    </Panel>

                    <PanelResizeHandle className="w-[1px] bg-zinc-800 hover:bg-purple-500/50 transition-colors" />

                    {/* MAIN AREA: EDITOR & RESULTS */}
                    <Panel className="flex flex-col">
                        <PanelGroup direction="vertical">
                            {/* TOP: SQL EDITOR */}
                            <Panel defaultSize={60} minSize={30} className="flex flex-col bg-[#09090b]">
                                {/* Tab Bar */}
                                <div className="flex items-center justify-between px-4 h-10 border-b border-zinc-800 bg-[#0c0c0e]/80">
                                    <div className="flex items-center h-full gap-1 overflow-x-auto no-scrollbar">
                                        {tabs.map(tab => (
                                            <div
                                                key={tab.id}
                                                onClick={() => globalStore.set(model.activeTabIdAtom, tab.id)}
                                                className={`flex items-center gap-2 px-4 h-full cursor-pointer text-[11px] font-mono border-b-2 transition-all group/tab ${
                                                    activeTabId === tab.id ? 'bg-[#09090b] border-purple-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                                                }`}
                                            >
                                                <i className={`fa ${tab.type === 'sql' ? 'fa-file-code-o' : 'fa-table'} text-[10px]`}></i>
                                                {tab.name}
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); model.removeTab(tab.id); }}
                                                    className="ml-2 size-4 flex items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-600 hover:text-red-400 opacity-0 group-hover/tab:opacity-100 transition-all"
                                                >
                                                    <i className="fa fa-times text-[8px]"></i>
                                                </button>
                                            </div>
                                        ))}
                                        <button onClick={() => model.addTab()} className="px-3 text-zinc-600 hover:text-purple-400">
                                            <i className="fa fa-plus text-xs"></i>
                                        </button>
                                    </div>
                                    <button 
                                        onClick={() => createBlock({ meta: { view: "oracle-monitor", connection: selectedConn } })}
                                        className="bg-zinc-800/80 hover:bg-emerald-500/20 text-emerald-400 px-4 py-1 rounded-md text-[11px] font-black uppercase tracking-widest flex items-center gap-2 transition-all border border-emerald-500/20 hover:border-emerald-500/40"
                                    >
                                        <i className="fa fa-chart-line text-[9px]"></i>
                                        Monitoreo
                                    </button>
                                    <button 
                                        onClick={() => model.runQuery(selectedConn)}
                                        disabled={executing}
                                        className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-1 rounded-md text-[11px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-50 transition-all shadow-lg shadow-purple-500/10"
                                    >
                                        {executing ? <i className="fa fa-spinner fa-spin"></i> : <i className="fa fa-play text-[9px]"></i>}
                                        Ejecutar
                                    </button>
                                </div>
                                {/* Editor or Table Detail */}
                                <div className="flex-grow relative overflow-hidden">
                                    {activeTab?.type === 'sql' ? (
                                        <Editor
                                            theme="vs-dark"
                                            language="sql"
                                            value={activeTab?.content || ""}
                                            onChange={(val) => activeTab && model.updateTabContent(activeTab.id, val || "")}
                                            options={{
                                                minimap: { enabled: false },
                                                fontSize: 13,
                                                fontFamily: "var(--font-family-mono)",
                                                lineNumbers: "on",
                                                roundedSelection: false,
                                                scrollBeyondLastLine: false,
                                                automaticLayout: true,
                                                padding: { top: 20 }
                                            }}
                                        />
                                    ) : (
                                        <div className="flex flex-col h-full">
                                            {/* Table Detail Menu - TOAD STYLE - Hidden for external queries */}
                                            {!activeTab?.isExternal && (
                                                <div className="flex flex-col bg-[#0c0c0e] border-b border-zinc-800/50 shadow-inner">
                                                {/* Top Row: Technical Specs */}
                                                <div className="flex items-center gap-0.5 px-2 py-1 border-b border-zinc-800/30 overflow-x-auto no-scrollbar">
                                                    {['Stats/Size', 'Referential', 'Used By', 'Policies', 'Auditing'].map(t => (
                                                        <button 
                                                            key={t} 
                                                            onClick={() => activeTab && model.updateSubTab(activeTab.id, t)}
                                                            className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-tight transition-all border ${activeTab?.subTab === t ? 'bg-zinc-800 border-zinc-700 text-purple-400' : 'border-transparent text-zinc-600 hover:text-zinc-400'}`}
                                                        >
                                                            {t}
                                                        </button>
                                                    ))}
                                                </div>
                                                {/* Bottom Row: Main Components */}
                                                <div className="flex items-center gap-0.5 px-2 py-1 overflow-x-auto no-scrollbar">
                                                    {['Columns', 'Indexes', 'Constraints', 'Triggers', 'Data', 'Script', 'Grants', 'Synonyms', 'Partitions', 'Subpartitions'].map(t => (
                                                        <button 
                                                            key={t} 
                                                            onClick={() => activeTab && model.updateSubTab(activeTab.id, t)}
                                                            className={`px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all border ${activeTab?.subTab === t ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-500/20' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                                                        >
                                                            {t}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            )}
                                            <OverlayScrollbarsComponent className="flex-grow p-6 bg-[#09090b]/40" options={{ scrollbars: { autoHide: "leave" } }}>
                                                {loadingDetail || executing ? (
                                                    <div className="h-full flex flex-col items-center justify-center gap-4 py-20">
                                                        <i className="fa fa-circle-notch fa-spin text-2xl text-purple-500"></i>
                                                        <span className="text-[10px] uppercase font-black tracking-[0.4em] text-zinc-600">Cargando {activeTab?.subTab}...</span>
                                                    </div>
                                                ) : (activeTab?.subTab === 'Data' && activeTab?.isExternal) ? (
                                                    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex flex-col gap-1">
                                                                <h3 className="text-xl font-black text-white tracking-tight">{activeTab?.table}</h3>
                                                                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Vista de Datos (Top 100)</p>
                                                            </div>
                                                        </div>
                                                        <div className="border border-zinc-800 rounded-xl overflow-hidden bg-black/20">
                                                            <table className="w-full text-left border-collapse font-mono text-[11px]">
                                                                <thead className="bg-zinc-900/50">
                                                                    <tr>
                                                                        {(results?.columns || []).map(col => (
                                                                            <th key={col} className="px-3 py-2 border-b border-zinc-800 text-purple-400/80 uppercase font-bold text-[10px] tracking-tight">{col}</th>
                                                                        ))}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {(results?.rows || []).map((row, i) => (
                                                                        <tr key={i} className="hover:bg-purple-500/5 border-b border-zinc-900/50">
                                                                            {(results?.columns || []).map(col => (
                                                                                <td key={col} className="px-3 py-2 text-zinc-400 group-hover:text-zinc-200">
                                                                                    {row[col] === null ? <span className="italic opacity-30 text-[9px]">NULL</span> : String(row[col])}
                                                                                </td>
                                                                            ))}
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                ) : activeTab?.subTab === 'Script' ? (
                                                    <div className="flex flex-col h-full gap-4 animate-in fade-in slide-in-from-bottom-4">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex flex-col gap-1">
                                                                <h3 className="text-xl font-black text-white tracking-tight">{activeTab?.table}</h3>
                                                                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Oracle Table DDL</p>
                                                            </div>
                                                            <button 
                                                                onClick={() => { navigator.clipboard.writeText(tableScript); }}
                                                                className="bg-purple-600/20 text-purple-400 border border-purple-500/30 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-purple-600 hover:text-white transition-all"
                                                            >
                                                                <i className="fa fa-copy mr-2"></i> Copiar SQL
                                                            </button>
                                                        </div>
                                                        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-2xl p-6 relative overflow-hidden">
                                                            <pre className="text-[11px] font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap">
                                                                {tableScript}
                                                            </pre>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex flex-col gap-1">
                                                                <h3 className="text-xl font-black text-white tracking-tight">{activeTab?.table}</h3>
                                                                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Definición de {activeTab?.subTab}</p>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <button 
                                                                    onClick={() => globalStore.set(model.designModeAtom, !designMode)}
                                                                    className={`border p-2 rounded-lg transition-all ${designMode ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-500/40' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'}`} 
                                                                    title={designMode ? "Salir de Modo Diseño" : "Entrar en Modo Diseño"}
                                                                >
                                                                    <i className={`fa ${designMode ? 'fa-save' : 'fa-cog'} text-xs`}></i>
                                                                </button>
                                                            </div>
                                                        </div>
                                                        {activeTab?.subTab === 'Columns' ? (
                                                            <div className="flex flex-col gap-4">
                                                                <table className="w-full text-left border-collapse font-mono text-[11px]">
                                                                    <thead>
                                                                        <tr className="bg-[#111113]">
                                                                            <th className="px-4 py-3 border-b border-zinc-800 text-zinc-500 uppercase font-black tracking-widest">Columna</th>
                                                                            <th className="px-4 py-3 border-b border-zinc-800 text-zinc-500 uppercase font-black tracking-widest">Tipo</th>
                                                                            <th className="px-4 py-3 border-b border-zinc-800 text-zinc-500 uppercase font-black tracking-widest text-center">Largo</th>
                                                                            <th className="px-4 py-3 border-b border-zinc-800 text-zinc-500 uppercase font-black tracking-widest text-center">Null?</th>
                                                                            {designMode && <th className="px-4 py-3 border-b border-zinc-800 text-zinc-500 uppercase font-black tracking-widest text-center">Acción</th>}
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {(tableColumns || []).map((col, i) => (
                                                                            <tr key={i} className="hover:bg-purple-500/5 transition-colors group border-b border-zinc-900/50">
                                                                                <td className="px-4 py-3 text-white font-bold">{col.COLUMN_NAME}</td>
                                                                                <td className="px-4 py-3 text-purple-400/80">{col.DATA_TYPE}</td>
                                                                                <td className="px-4 py-3 text-zinc-500 text-center">{col.DATA_LENGTH}</td>
                                                                                <td className="px-4 py-3 text-center">
                                                                                    <i className={`fa ${col.NULLABLE === 'Y' ? 'fa-check text-green-500/50' : 'fa-times text-red-500/50'} text-[10px]`}></i>
                                                                                </td>
                                                                                {designMode && (
                                                                                    <td className="px-4 py-3 text-center">
                                                                                        <button className="text-red-500/50 hover:text-red-500 transition-colors"><i className="fa fa-trash-o text-xs"></i></button>
                                                                                    </td>
                                                                                )}
                                                                            </tr>
                                                                        ))}
                                                                        {designMode && (
                                                                            <tr className="bg-purple-500/5 animate-pulse">
                                                                                <td className="px-4 py-3"><input autoFocus placeholder="NOMBRE_CAMPO" className="bg-transparent border-b border-purple-500/50 text-white outline-none w-full" /></td>
                                                                                <td className="px-4 py-3">
                                                                                    <select className="bg-zinc-900 text-purple-400 text-[10px] rounded border border-zinc-800">
                                                                                        <option>VARCHAR2</option>
                                                                                        <option>NUMBER</option>
                                                                                        <option>DATE</option>
                                                                                        <option>CLOB</option>
                                                                                    </select>
                                                                                </td>
                                                                                <td className="px-4 py-3 text-center"><input placeholder="255" className="bg-transparent border-b border-purple-500/50 text-white outline-none w-20 text-center" /></td>
                                                                                <td className="px-4 py-3 text-center"><input type="checkbox" defaultChecked /></td>
                                                                                <td className="px-4 py-3 text-center">
                                                                                    <button className="bg-green-600 text-white size-6 rounded-lg shadow-lg shadow-green-500/20"><i className="fa fa-check text-xs"></i></button>
                                                                                </td>
                                                                            </tr>
                                                                        )}
                                                                    </tbody>
                                                                </table>
                                                                {!designMode && (
                                                                    <button 
                                                                        onClick={() => globalStore.set(model.designModeAtom, true)}
                                                                        className="mt-4 border border-dashed border-zinc-800 p-4 rounded-2xl text-zinc-600 hover:border-purple-500 hover:text-purple-400 transition-all flex items-center justify-center gap-3 uppercase font-black text-[10px] tracking-widest"
                                                                    >
                                                                        <i className="fa fa-plus-circle text-lg"></i>
                                                                        Agregar Columna
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ) : activeTab?.subTab === 'Indexes' ? (
                                                            <table className="w-full text-left border-collapse font-mono text-[11px]">
                                                                <thead>
                                                                    <tr className="bg-[#111113]">
                                                                        <th className="px-4 py-3 border-b border-zinc-800 text-zinc-500 uppercase font-black tracking-widest">Nombre</th>
                                                                        <th className="px-4 py-3 border-b border-zinc-800 text-zinc-500 uppercase font-black tracking-widest">Tipo</th>
                                                                        <th className="px-4 py-3 border-b border-zinc-800 text-zinc-500 uppercase font-black tracking-widest">Unicidad</th>
                                                                        <th className="px-4 py-3 border-b border-zinc-800 text-zinc-500 uppercase font-black tracking-widest text-center">Estado</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {(tableIndexes || []).map((idx, i) => (
                                                                        <tr key={i} className="hover:bg-purple-500/5 transition-colors border-b border-zinc-900/50">
                                                                            <td className="px-4 py-3 text-white font-bold">{idx.INDEX_NAME}</td>
                                                                            <td className="px-4 py-3 text-purple-400/80">{idx.INDEX_TYPE}</td>
                                                                            <td className="px-4 py-3 text-zinc-500">{idx.UNIQUENESS}</td>
                                                                            <td className="px-4 py-3 text-center">
                                                                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${idx.STATUS === 'VALID' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                                                                    {idx.STATUS}
                                                                                </span>
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        ) : activeTab?.subTab === 'Constraints' ? (
                                                            <table className="w-full text-left border-collapse font-mono text-[11px]">
                                                                <thead>
                                                                    <tr className="bg-[#111113]">
                                                                        <th className="px-4 py-3 border-b border-zinc-800 text-zinc-500 uppercase font-black tracking-widest">Nombre</th>
                                                                        <th className="px-4 py-3 border-b border-zinc-800 text-zinc-500 uppercase font-black tracking-widest">Tipo</th>
                                                                        <th className="px-4 py-3 border-b border-zinc-800 text-zinc-500 uppercase font-black tracking-widest text-center">Estado</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {(tableConstraints || []).map((cons, i) => (
                                                                        <tr key={i} className="hover:bg-purple-500/5 transition-colors border-b border-zinc-900/50">
                                                                            <td className="px-4 py-3 text-white font-bold">{cons.CONSTRAINT_NAME}</td>
                                                                            <td className="px-4 py-3 text-purple-400/80">
                                                                                {cons.CONSTRAINT_TYPE === 'P' ? 'PRIMARY KEY' : cons.CONSTRAINT_TYPE === 'R' ? 'FOREIGN KEY' : cons.CONSTRAINT_TYPE === 'U' ? 'UNIQUE' : 'CHECK'}
                                                                            </td>
                                                                            <td className="px-4 py-3 text-center">
                                                                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${cons.STATUS === 'ENABLED' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                                                                    {cons.STATUS}
                                                                                </span>
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        ) : (
                                                            <div className="py-20 flex flex-col items-center justify-center text-zinc-700 gap-4 bg-black/10 rounded-3xl border border-dashed border-zinc-800">
                                                                <i className="fa fa-code text-4xl opacity-10"></i>
                                                                <span className="text-[10px] uppercase font-black tracking-widest opacity-40 italic">Módulo {activeTab?.subTab} en desarrollo...</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </OverlayScrollbarsComponent>
                                        </div>
                                    )}
                                </div>
                            </Panel>

                            {!activeTab?.isExternal && (
                                <>
                                    <PanelResizeHandle className="h-[1px] bg-zinc-800 hover:bg-purple-500/50 transition-colors" />

                                    {/* BOTTOM: RESULTS GRID */}
                                    <Panel defaultSize={40} minSize={20} className="bg-[#0c0c0e] flex flex-col border-t border-zinc-800">
                                <div className="px-4 h-8 border-b border-zinc-800 flex items-center justify-between bg-[#09090b]/50">
                                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Resultados</span>
                                    {results && (
                                        <span className="text-[9px] text-zinc-600 font-mono">
                                            {results.rows.length} filas retornadas
                                        </span>
                                    )}
                                </div>
                                <div className="flex-grow overflow-auto p-4">
                                    {error && (
                                        <div className="bg-red-500/10 border border-red-500/30 p-6 rounded-xl flex flex-col gap-3 animate-in fade-in slide-in-from-top-2">
                                            <div className="flex items-center gap-3 text-red-500">
                                                <i className="fa fa-exclamation-triangle text-xl"></i>
                                                <span className="font-black uppercase tracking-widest text-xs">Error de Base de Datos</span>
                                            </div>
                                            <pre className="text-[11px] font-mono text-red-400/80 whitespace-pre-wrap leading-relaxed">
                                                {error}
                                            </pre>
                                        </div>
                                    )}
                                    {!results && !error && (
                                        <div className="h-full flex flex-col items-center justify-center text-zinc-700 gap-2">
                                            <i className="fa fa-terminal text-2xl opacity-20"></i>
                                            <span className="text-[10px] uppercase font-bold tracking-widest opacity-50">Esperando ejecución...</span>
                                        </div>
                                    )}
                                    {results && (
                                        <table className="w-full text-left border-collapse font-mono text-[11px]">
                                            <thead className="sticky top-0 bg-[#0c0c0e] shadow-sm z-10">
                                                <tr>
                                                    {(results?.columns || []).map(col => (
                                                        <th key={col} className="px-3 py-2 border-b border-zinc-800 text-purple-400/80 uppercase font-bold tracking-tight">
                                                            {col}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(results?.rows || []).map((row, i) => (
                                                    <tr key={i} className="hover:bg-purple-500/5 transition-colors group">
                                                        {(results?.columns || []).map(col => (
                                                            <td key={col} className="px-3 py-2 border-b border-zinc-900 text-zinc-400 group-hover:text-zinc-200">
                                                                {row[col] === null ? <span className="italic opacity-30 text-[9px]">NULL</span> : String(row[col])}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                                </Panel>
                            </>
                        )}
                        </PanelGroup>
                    </Panel>
                </PanelGroup>
            )}
        </div>
    );
}

export { DBConnectionsViewModel };
