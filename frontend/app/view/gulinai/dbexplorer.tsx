// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import { WOS, globalStore } from "@/store/global";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import clsx from "clsx";
import { getGulinObjectAtom, makeORef } from "@/store/wos";
import { ErrorBoundary } from "@/element/errorboundary";

class DBExplorerViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "db-explorer";
    }

    get viewComponent(): ViewComponent {
        return DBExplorerView;
    }
}

function DBExplorerView({ model, blockId }: { model: DBExplorerViewModel, blockId: string }) {
    const blockDataAtom = React.useMemo(() => getGulinObjectAtom<Block>(makeORef("block", blockId)), [blockId]);
    const blockData = jotai.useAtomValue(blockDataAtom);

    const rawData = blockData?.meta?.["db:data"];
    const title = (blockData?.meta?.["db:title"] as string) || "DB Explorer";
    const connName = (blockData?.meta?.["db:connection"] as string) || "Desconocida";

    const data = React.useMemo(() => {
        if (!rawData) return [];
        try {
            const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
            if (!Array.isArray(parsed)) return [];
            return parsed.filter((row: any) => row != null);
        } catch (e) {
            return [];
        }
    }, [rawData]);

    const renderContent = () => {
        if (!Array.isArray(data) || data.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-4">
                    <i className="fa fa-database text-4xl opacity-20"></i>
                    <p className="italic">No hay datos para mostrar. Ejecuta una consulta SQL con Gulin.</p>
                </div>
            );
        }

        const keys = data[0] ? Object.keys(data[0]) : [];

        return (
            <div className="flex-1 w-full overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/40 custom-scrollbar shadow-inner mt-4">
                <table className="w-full text-left border-collapse min-w-max">
                    <thead className="sticky top-0 z-10 bg-zinc-900/90 backdrop-blur shadow-sm">
                        <tr>
                            {keys.map(key => (
                                <th key={key} className="px-4 py-3 text-[10px] font-bold text-blue-400 uppercase tracking-widest border-b border-zinc-800">
                                    {key}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/30">
                        {data.map((row: any, i: number) => (
                            <tr key={i} className="hover:bg-blue-500/5 transition-colors group">
                                {keys.map(key => (
                                    <td key={key} className="px-4 py-2.5 text-xs text-zinc-300 font-mono group-hover:text-zinc-100">
                                        {String(row[key] ?? "-")}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    return (
        <ErrorBoundary>
            <div className="flex flex-col w-full h-full bg-zinc-950 p-6 rounded-xl border border-zinc-800 shadow-2xl overflow-hidden self-stretch">
                <header className="flex justify-between items-start mb-4 shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-3">
                            <i className="fa fa-table text-blue-500"></i>
                            {title}
                        </h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Conexión:</span>
                            <span className="text-[10px] font-bold text-blue-400/80 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                                {connName}
                            </span>
                        </div>
                    </div>
                </header>

                {renderContent()}

                <footer className="mt-4 pt-4 border-t border-zinc-900 flex justify-between items-center shrink-0">
                    <span className="text-[9px] text-zinc-600 font-mono uppercase">
                        Gulin DB Engine v1.0
                    </span>
                    <span className="text-[9px] text-zinc-600 font-mono">
                        {data.length} registros encontrados
                    </span>
                </footer>
            </div>
        </ErrorBoundary>
    );
}

export { DBExplorerViewModel };
