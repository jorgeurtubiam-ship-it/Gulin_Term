// SPDX-License-Identifier: Apache-2.0
// DBConn Table Detail Components - Table detail tabs (Columns, Indexes, Constraints, Triggers, Script)

import * as React from "react";

interface TableDetailProps {
    activeSubTab: string;
    updateSubTab: (id: string, subTab: string) => void;
    detail: {
        columns: any[];
        indexes: any[];
        constraints: any[];
        triggers: any[];
        script: string;
    };
    loading: boolean;
    designMode: boolean;
    tabId: string;
}

export function TableDetailView({ activeSubTab, updateSubTab, detail, loading, designMode, tabId }: TableDetailProps) {
    const subTabs = [
        { id: 'Data', label: 'Datos', icon: 'fa-table' },
        { id: 'Columns', label: 'Columnas', icon: 'fa-columns' },
        { id: 'Indexes', label: 'Índices', icon: 'fa-search' },
        { id: 'Constraints', label: 'Restricciones', icon: 'fa-key' },
        { id: 'Triggers', label: 'Triggers', icon: 'fa-bolt' },
        { id: 'Script', label: 'Script', icon: 'fa-code' },
    ];

    return (
        <div className="flex flex-col h-full">
            {/* Sub-tabs navigation */}
            <div className="flex gap-1 px-4 py-2 bg-[#0d0d10] border-b border-zinc-800/50 overflow-x-auto">
                {subTabs.map(st => (
                    <button
                        key={st.id}
                        onClick={() => updateSubTab(tabId, st.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                            activeSubTab === st.id
                                ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                                : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/30'
                        }`}
                    >
                        <i className={`fa ${st.icon}`}></i>
                        {st.label}
                    </button>
                ))}
            </div>

            {/* Sub-tab content */}
            <div className="flex-1 overflow-auto p-4">
                {loading ? (
                    <div className="flex items-center justify-center h-full text-zinc-600 gap-2">
                        <i className="fa fa-spinner fa-spin text-purple-500"></i>
                        <span className="text-[10px] uppercase tracking-widest font-bold">Cargando...</span>
                    </div>
                ) : (
                    <>
                        {activeSubTab === 'Columns' && (
                            <div className="flex flex-col gap-2">
                                <div className="text-[10px] text-zinc-500 font-mono mb-2">
                                    {detail.columns.length} columnas
                                </div>
                                {detail.columns.length > 0 ? (
                                    <table className="w-full text-left border-collapse font-mono text-[11px]">
                                        <thead>
                                            <tr className="bg-[#111113] sticky top-0">
                                                <th className="px-3 py-2 border-b border-zinc-800 text-purple-400/80 font-bold">Nombre</th>
                                                <th className="px-3 py-2 border-b border-zinc-800 text-purple-400/80 font-bold">Tipo</th>
                                                <th className="px-3 py-2 border-b border-zinc-800 text-purple-400/80 font-bold">Longitud</th>
                                                <th className="px-3 py-2 border-b border-zinc-800 text-purple-400/80 font-bold">Nullable</th>
                                                <th className="px-3 py-2 border-b border-zinc-800 text-purple-400/80 font-bold">Default</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {detail.columns.map((col: any, i: number) => (
                                                <tr key={i} className="hover:bg-purple-500/5 transition-colors">
                                                    <td className="px-3 py-2 border-b border-zinc-900 text-zinc-200">{col.COLUMN_NAME}</td>
                                                    <td className="px-3 py-2 border-b border-zinc-900 text-cyan-400">{col.DATA_TYPE}</td>
                                                    <td className="px-3 py-2 border-b border-zinc-900 text-zinc-400">{col.DATA_LENGTH}</td>
                                                    <td className="px-3 py-2 border-b border-zinc-900">
                                                        <span className={`text-[10px] font-bold ${col.NULLABLE === 'Y' ? 'text-green-500' : 'text-red-500'}`}>
                                                            {col.NULLABLE === 'Y' ? 'SÍ' : 'NO'}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2 border-b border-zinc-900 text-zinc-500 font-mono text-[10px]">{col.DATA_DEFAULT || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <div className="text-center py-8 text-zinc-600 text-[10px] uppercase tracking-widest">
                                        No se encontraron columnas
                                    </div>
                                )}
                            </div>
                        )}

                        {activeSubTab === 'Indexes' && (
                            <RenderTable list={detail.indexes} columns={['INDEX_NAME', 'INDEX_TYPE', 'UNIQUENESS', 'STATUS']} />
                        )}

                        {activeSubTab === 'Constraints' && (
                            <RenderTable list={detail.constraints} columns={['CONSTRAINT_NAME', 'CONSTRAINT_TYPE', 'STATUS', 'SEARCH_CONDITION']} />
                        )}

                        {activeSubTab === 'Triggers' && (
                            <RenderTable list={detail.triggers} columns={['TRIGGER_NAME', 'TRIGGER_TYPE', 'TRIGGERING_EVENT', 'STATUS']} />
                        )}

                        {activeSubTab === 'Script' && (
                            <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap bg-[#0d0d10] p-4 rounded-xl border border-zinc-800/50">
                                {detail.script || '-- No se pudo generar el script'}
                            </pre>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function RenderTable({ list, columns }: { list: any[]; columns: string[] }) {
    if (!list || list.length === 0) {
        return (
            <div className="text-center py-8 text-zinc-600 text-[10px] uppercase tracking-widest">
                Sin datos
            </div>
        );
    }
    return (
        <table className="w-full text-left border-collapse font-mono text-[11px]">
            <thead>
                <tr className="bg-[#111113] sticky top-0">
                    {columns.map(col => (
                        <th key={col} className="px-3 py-2 border-b border-zinc-800 text-purple-400/80 font-bold uppercase">
                            {col.replace(/_/g, ' ')}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {list.map((row: any, i: number) => (
                    <tr key={i} className="hover:bg-purple-500/5 transition-colors">
                        {columns.map(col => (
                            <td key={col} className="px-3 py-2 border-b border-zinc-900 text-zinc-400">
                                {row[col] === null || row[col] === undefined ? '-' : String(row[col])}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function renderMiniTable(result: { columns: string[]; rows: any[] } | null) {
    if (!result || !result.rows) {
        return <div className="flex items-center justify-center h-32 text-zinc-700 text-[9px] uppercase tracking-widest">Sin datos</div>;
    }
    return (
        <table className="w-full text-left border-collapse font-mono text-[9px]">
            <thead>
                <tr className="bg-[#111113] sticky top-0">
                    {result.columns.map(col => (
                        <th key={col} className="px-2 py-1.5 border-b border-zinc-800 text-purple-400/80 font-bold">{col}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {result.rows.slice(0, 10).map((row, i) => (
                    <tr key={i} className="hover:bg-purple-500/5">
                        {result.columns.map(col => (
                            <td key={col} className="px-2 py-1 border-b border-zinc-900 text-zinc-500">{row[col] === null ? 'NULL' : String(row[col])}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
