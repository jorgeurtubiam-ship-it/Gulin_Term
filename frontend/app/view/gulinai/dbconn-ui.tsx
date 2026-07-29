// SPDX-License-Identifier: Apache-2.0
// DBConn UI Components - QueryHistoryPanel, SideBySideView, DBConnectionsView (main UI)

import * as React from "react";
import * as jotai from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import Editor from "@monaco-editor/react";
import { GlobalModel } from "@/app/store/global-model";
import { renderMiniTable, TableDetailView } from "./dbconn-table";
import { exportToXLSX, exportToCSV, exportToPDF, copyAsMarkdown } from "./dbconn-export";
import type { DBConnectionsViewModel } from "./dbconnections";

// #6: Query History Panel
export function QueryHistoryPanel({ 
    history, 
    onSelect 
}: { 
    history: { id: string; sql: string; conn: string; timestamp: Date; rows: number }[]; 
    onSelect: (sql: string) => void;
}) {
    return (
        <div className="flex flex-col gap-2 p-3">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <i className="fa fa-history"></i>
                    Historial
                </span>
                <span className="text-[8px] text-zinc-700 font-mono">{history.length} queries</span>
            </div>
            {history.length === 0 ? (
                <div className="text-center py-8 text-zinc-700">
                    <i className="fa fa-clock-o text-lg mb-2 opacity-30"></i>
                    <p className="text-[10px] uppercase tracking-widest">Sin historial</p>
                </div>
            ) : (
                <OverlayScrollbarsComponent className="max-h-[300px]" options={{ scrollbars: { autoHide: "leave" } }}>
                    <div className="flex flex-col gap-1.5">
                        {history.map((item, i) => (
                            <div 
                                key={`${item.id}-${i}`}
                                onClick={() => onSelect(item.sql)}
                                className="group cursor-pointer bg-zinc-900/50 hover:bg-purple-500/10 border border-zinc-800/50 hover:border-purple-500/30 p-2 rounded-lg transition-all"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[8px] text-zinc-600 font-mono">{item.conn}</span>
                                    <span className="text-[8px] text-zinc-700">{item.rows} filas</span>
                                </div>
                                <code className="text-[9px] text-zinc-400 font-mono line-clamp-2">
                                    {item.sql.substring(0, 100)}{item.sql.length > 100 ? '...' : ''}
                                </code>
                                <div className="text-[7px] text-zinc-700 mt-1">
                                    {new Date(item.timestamp).toLocaleTimeString()}
                                </div>
                            </div>
                        ))}
                    </div>
                </OverlayScrollbarsComponent>
            )}
        </div>
    );
}

export function DBConnectionsView({ model }: { model: DBConnectionsViewModel }) {
    const dbs = jotai.useAtomValue(model.dbsAtom) ?? [];
    const loading = jotai.useAtomValue(model.loadingAtom) ?? true;
    const selectedConn = jotai.useAtomValue(model.selectedConnAtom) ?? null;
    const schemas = jotai.useAtomValue(model.schemasAtom) ?? [];
    const selectedSchema = jotai.useAtomValue(model.selectedSchemaAtom) ?? null;
    const tables = jotai.useAtomValue(model.tablesAtom) ?? {};
    const typeObjects = jotai.useAtomValue(model.typeObjectsAtom) ?? {};
    const loadingTables = jotai.useAtomValue(model.loadingTablesAtom) ?? false;
    const loadingSchemas = jotai.useAtomValue(model.loadingSchemasAtom) ?? false;
    const loadingType = jotai.useAtomValue(model.loadingTypeAtom) ?? {};
    const tabs = jotai.useAtomValue(model.tabsAtom) ?? [];
    const activeTabId = jotai.useAtomValue(model.activeTabIdAtom) ?? '';
    const results = jotai.useAtomValue(model.resultsAtom) ?? {};
    const executing = jotai.useAtomValue(model.executingAtom) ?? false;
    const error = jotai.useAtomValue(model.errorAtom) ?? null;
    const tableColumns = jotai.useAtomValue(model.tableColumnsAtom) ?? [];
    const tableIndexes = jotai.useAtomValue(model.tableIndexesAtom) ?? [];
    const tableConstraints = jotai.useAtomValue(model.tableConstraintsAtom) ?? [];
    const tableTriggers = jotai.useAtomValue(model.tableTriggersAtom) ?? [];
    const tableScript = jotai.useAtomValue(model.tableScriptAtom) ?? '';
    const loadingDetail = jotai.useAtomValue(model.loadingDetailAtom) ?? false;
    const designMode = jotai.useAtomValue(model.designModeAtom) ?? false;
    const history = jotai.useAtomValue(model.historyAtom) ?? [];
    const sideBySide = jotai.useAtomValue(model.sideBySideAtom) ?? false;
    const sideBySideTabs = jotai.useAtomValue(model.sideBySideTabsAtom) ?? [];
    const presentationMode = jotai.useAtomValue(model.presentationModeAtom) ?? false;
    const schemaSearch = jotai.useAtomValue(model.schemaSearchAtom) ?? '';

    const activeTab = tabs.find(t => t.id === activeTabId);
    const activeResult = activeTabId ? results[activeTabId] : undefined;

    // Modal state for editing/creating connections
    const [showConnModal, setShowConnModal] = React.useState(false);
    const [editingConn, setEditingConn] = React.useState<string | null>(null);
    const [editName, setEditName] = React.useState('');
    const [editType, setEditType] = React.useState('oracle');
    const [editUrl, setEditUrl] = React.useState('');

    const openNewConnection = () => {
        setEditingConn(null);
        setEditName('');
        setEditType('oracle');
        setEditUrl('');
        setShowConnModal(true);
    };

    const openEditConnection = (name: string, type: string, host?: string, port?: number) => {
        setEditingConn(name);
        setEditName(name);
        setEditType(type || 'oracle');
        setEditUrl(`jdbc:${type || 'oracle'}://${host || 'localhost'}:${port || 1521}/${name}`);
        setShowConnModal(true);
    };

    const handleSaveConnection = async () => {
        if (!editName || !editUrl) return;
        try {
            // If editing, delete old first
            if (editingConn && editingConn !== editName) {
                await model.deleteConnection(editingConn);
            }
            await model.saveConnection(editName, editType, editUrl);
            setShowConnModal(false);
        } catch (e) {
            // error is already shown by model
        }
    };

    // Connection Modal
    const renderConnModal = () => {
        if (!showConnModal) return null;
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowConnModal(false)}>
                <div className="bg-[#111113] border border-zinc-800 rounded-2xl p-8 w-[500px] shadow-2xl shadow-purple-500/5" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-4 mb-8">
                        <div className="size-10 bg-purple-600 rounded-xl flex items-center justify-center">
                            <i className="fa fa-database text-white"></i>
                        </div>
                        <div>
                            <h3 className="text-lg font-black tracking-tight">{editingConn ? 'Editar Conexión' : 'Nueva Conexión'}</h3>
                            <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Base de Datos</p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-4">
                        <div>
                            <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1.5 block">Nombre</label>
                            <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="mi-conexion" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-purple-500/50 transition-all" />
                        </div>
                        <div>
                            <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1.5 block">Tipo</label>
                            <select value={editType} onChange={e => setEditType(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-purple-500/50 transition-all appearance-none cursor-pointer">
                                <option value="oracle">Oracle</option>
                                <option value="postgres">PostgreSQL</option>
                                <option value="mysql">MySQL</option>
                                <option value="mssql">SQL Server</option>
                                <option value="sqlite">SQLite</option>
                                <option value="mongodb">MongoDB</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1.5 block">URL de Conexión</label>
                            <textarea value={editUrl} onChange={e => setEditUrl(e.target.value)} placeholder={editType === 'oracle' ? 'oracle://user:pass@host:1521/service' : 'postgres://user:pass@host:5432/db'} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500/50 transition-all resize-none" />
                        </div>
                    </div>
                    <div className="flex items-center justify-end gap-3 mt-8">
                        <button onClick={() => setShowConnModal(false)} className="px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest text-zinc-500 hover:text-white border border-zinc-800 hover:border-zinc-700 transition-all">Cancelar</button>
                        <button onClick={handleSaveConnection} disabled={!editName || !editUrl} className="px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-30 transition-all shadow-lg shadow-purple-500/10">
                            <i className="fa fa-save mr-2"></i>
                            {editingConn ? 'Actualizar' : 'Guardar'}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderConnections = () => (
        <>
            <div className="flex items-center justify-between mb-6">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{dbs.length} conexiones</span>
                <button onClick={openNewConnection} className="bg-purple-600 hover:bg-purple-500 text-white px-5 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg shadow-purple-500/20">
                    <i className="fa fa-plus-circle text-xs"></i>
                    Nueva Conexión
                </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px", width: "100%" }}>
            {dbs.map((db, i) => (
                <div
                    key={db.name || i}
                    onClick={() => model.selectConnection(db.name)}
                    className="group cursor-pointer bg-zinc-900/30 hover:bg-purple-500/5 border border-zinc-800 hover:border-purple-500/30 p-5 rounded-2xl transition-all hover:shadow-xl hover:shadow-purple-500/5"
                >
                    <div className="flex items-center gap-4 mb-4">
                        <div className="size-12 bg-gradient-to-br from-purple-600 to-purple-800 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:scale-110 transition-transform">
                            <i className="fa fa-database text-white text-xl"></i>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-black text-white tracking-tight">{db.name}</span>
                            <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">{db.type}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-zinc-600 mb-4">
                        <span className="flex items-center gap-1.5">
                            <i className="fa fa-server text-[8px]"></i>
                            {db.host || 'localhost'}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <i className="fa fa-hashtag text-[8px]"></i>
                            {db.port || '1521'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEditConnection(db.name, db.type, db.host, db.port)} className="flex-1 bg-zinc-800/80 hover:bg-yellow-500/20 text-yellow-400 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all">
                            <i className="fa fa-pencil"></i>
                            Editar
                        </button>
                        <button onClick={() => model.testConnection(db.name)} className="flex-1 bg-zinc-800/80 hover:bg-emerald-500/20 text-emerald-400 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all">
                            <i className="fa fa-plug"></i>
                            Probar
                        </button>
                        <button onClick={() => model.deleteConnection(db.name)} className="flex-1 bg-zinc-800/80 hover:bg-red-500/20 text-red-400 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all">
                            <i className="fa fa-trash"></i>
                            Eliminar
                        </button>
                    </div>
                </div>
            ))}
            </div>
            {renderConnModal()}
        </>
    );

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'TABLE': return 'fa-table text-blue-400';
            case 'VIEW': return 'fa-eye text-green-400';
            case 'INDEX': return 'fa-list-ul text-yellow-400';
            case 'PROCEDURE': return 'fa-cog text-purple-400';
            case 'FUNCTION': return 'fa-code text-orange-400';
            case 'PACKAGE': return 'fa-archive text-red-400';
            case 'PACKAGE_BODY': return 'fa-cubes text-red-400';
            case 'TRIGGER': return 'fa-bolt text-amber-400';
            case 'SEQUENCE': return 'fa-sort-numeric-asc text-indigo-400';
            case 'SYNONYM': return 'fa-link text-teal-400';
            case 'TABLESPACE': return 'fa-hdd-o text-zinc-400';
            case 'CONSTRAINT': return 'fa-key text-rose-400';
            case 'JOB': return 'fa-clock-o text-cyan-400';
            case 'DIRECTORY': return 'fa-folder-open text-sky-400';
            case 'INVALID': return 'fa-exclamation-triangle text-red-500';
            default: return 'fa-cube text-zinc-500';
        }
    };

    const renderTables = () => {
        if (loadingTables || loadingSchemas) {
            return (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <i className="fa fa-circle-notch fa-spin text-2xl text-purple-500"></i>
                    <span className="text-[10px] uppercase font-black tracking-[0.3em] text-zinc-600">
                        {loadingSchemas ? 'CARGANDO ESQUEMAS...' : 'CARGANDO OBJETOS...'}
                    </span>
                </div>
            );
        }
        
        if (Object.keys(tables).length === 0 && Object.keys(typeObjects).length === 0) {
            return (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-700 gap-3">
                    <i className="fa fa-database text-3xl opacity-20"></i>
                    <p className="text-[10px] uppercase tracking-widest font-bold">
                        {selectedConn ? 'No hay objetos disponibles' : 'Selecciona una conexión'}
                    </p>
                </div>
            );
        }

        // Use typeObjects if available, otherwise fallback to tables
        const objectKeys = Object.keys(typeObjects).length > 0 ? Object.keys(typeObjects) : Object.keys(tables);
        
        // Filter by schema search
        const filteredKeys = schemaSearch
            ? objectKeys.filter(key => key.toLowerCase().includes(schemaSearch.toLowerCase()))
            : objectKeys;

        return (
            <div className="flex flex-col gap-3">
                {filteredKeys.map((type) => {
                    const items = typeObjects[type] || [];
                    const count = tables[type] || items.length;
                    return (
                        <div key={type} className="flex flex-col">
                            <div className="flex items-center gap-2 mb-2">
                                <i className={`fa ${getTypeIcon(type).split(' ')[0]} text-[10px] ${getTypeIcon(type).split(' ')[1] || 'text-zinc-500'}`}></i>
                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{type}</span>
                                <span className="text-[8px] text-zinc-700 font-mono ml-auto">{count}</span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                                {items.map((table: string) => (
                                    <div
                                        key={table}
                                        onClick={() => selectedConn && model.loadTableDetail(selectedConn, table)}
                                        className="group flex items-center gap-2 px-3 py-1.5 hover:bg-purple-500/10 rounded-lg cursor-pointer transition-all border border-transparent hover:border-purple-500/20"
                                    >
                                        <i className={`fa ${getTypeIcon(type)} text-[10px] w-4 text-center`}></i>
                                        <span className="text-xs text-zinc-300 font-mono group-hover:text-white transition-colors">{table}</span>
                                        <div className="ml-auto flex items-center gap-1">
                                            {type === 'TABLE' && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); selectedConn && model.exploreTable(selectedConn, table); }}
                                                    className="opacity-0 group-hover:opacity-100 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 p-1.5 rounded-md text-[10px] transition-all"
                                                    title="Ver registros"
                                                >
                                                    <i className="fa fa-eye"></i>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };



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
                            <div className="mt-3 flex items-center gap-2">
                                <div className="relative flex-1">
                                    <i className="fa fa-search text-[8px] absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600"></i>
                                    <input
                                        value={schemaSearch}
                                        onChange={e => globalStore.set(model.schemaSearchAtom, e.target.value)}
                                        placeholder="Buscar objetos..."
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-md pl-6 pr-2 py-1.5 text-[10px] text-zinc-400 focus:outline-none focus:border-purple-500/30 transition-all font-mono placeholder:text-zinc-700"
                                    />
                                    {schemaSearch && (
                                        <button onClick={() => globalStore.set(model.schemaSearchAtom, '')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400">
                                            <i className="fa fa-times-circle text-[8px]"></i>
                                        </button>
                                    )}
                                </div>
                                <button onClick={() => openEditConnection(selectedConn, dbs.find(d => d.name === selectedConn)?.type || '', dbs.find(d => d.name === selectedConn)?.host || '', dbs.find(d => d.name === selectedConn)?.port || 0)} className="size-7 flex items-center justify-center hover:bg-yellow-500/10 rounded-md text-zinc-600 hover:text-yellow-400 transition-all" title="Editar Conexión">
                                    <i className="fa fa-pencil text-[9px]"></i>
                                </button>
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
                                        onClick={() => activeTab?.content && model.explainQueryWithAI(activeTab.content)}
                                        className="bg-zinc-800/80 hover:bg-cyan-500/20 text-cyan-400 px-3 py-1 rounded-md text-[11px] font-black uppercase tracking-widest flex items-center gap-2 transition-all border border-cyan-500/20 hover:border-cyan-500/40"
                                        title="Explicar consulta con IA"
                                    >
                                        <i className="fa fa-magic text-[9px]"></i>
                                        Explain
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
                                                                        {(activeResult?.columns || []).map(col => (
                                                                            <th key={col} className="px-3 py-2 border-b border-zinc-800 text-purple-400/80 uppercase font-bold text-[10px] tracking-tight">{col}</th>
                                                                        ))}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {(activeResult?.rows || []).map((row, i) => (
                                                                        <tr key={i} className="hover:bg-purple-500/5 border-b border-zinc-900/50">
                                                                            {(activeResult?.columns || []).map(col => (
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
                                    {activeResult && (
                                        <span className="text-[9px] text-zinc-600 font-mono">
                                            {activeResult.rows.length} filas retornadas
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
                                    {!activeResult && !error && (
                                        <div className="h-full flex flex-col items-center justify-center text-zinc-700 gap-2">
                                            <i className="fa fa-terminal text-2xl opacity-20"></i>
                                            <span className="text-[10px] uppercase font-bold tracking-widest opacity-50">Esperando ejecución...</span>
                                        </div>
                                    )}
                                    {activeResult && (
                                        <table className="w-full text-left border-collapse font-mono text-[11px]">
                                            <thead className="sticky top-0 bg-[#0c0c0e] shadow-sm z-10">
                                                <tr>
                                                    {(activeResult?.columns || []).map(col => (
                                                        <th key={col} className="px-3 py-2 border-b border-zinc-800 text-purple-400/80 uppercase font-bold tracking-tight">
                                                            {col}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(activeResult?.rows || []).map((row, i) => (
                                                    <tr key={i} className="hover:bg-purple-500/5 transition-colors group">
                                                        {(activeResult?.columns || []).map(col => (
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