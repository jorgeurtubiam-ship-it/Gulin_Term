// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import { atom, Atom } from "jotai";
import { DashboardView } from "./dashboard";
import { makeORef, getGulinObjectAtom } from "@/store/wos";

/**
 * DashboardViewModel: Gestiona el estado y la configuración de la vista del dashboard.
 * 
 * Se encarga de la vinculación entre los datos del bloque (Block) y el componente 
 * visual DashboardView. Define los metadatos iniciales del widget como el icono y el nombre.
 */
export class DashboardViewModel implements ViewModel {
    viewType: string;
    viewComponent = DashboardView;
    viewIcon: Atom<string>;
    viewName: Atom<string>;
    viewText: Atom<string>;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;

    // The raw JSON data string sent by the backend/Gulin
    dataContentAtom: Atom<string>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "dashboard";

        this.dataContentAtom = atom("");

        const blockDataAtom = getGulinObjectAtom<Block>(makeORef("block", blockId));

        this.viewIcon = atom((get) => {
            return "chart-pie";
        });

        this.viewName = atom((get) => {
            return "Dashboard";
        });

        this.viewText = atom((get) => {
            return "Interactive Data Dashboard";
        });

        // Initialize state right away
        this.initializeData(blockDataAtom);
    }

    private initializeData(blockDataAtom: any) {
        const getInitData = async () => {
            // In Gulin, config and text are often stored or piped via specific methods.
            // For now we'll listen to the block meta 'dashboard-data' property.
        }
        getInitData();
    }

    dispose() { }
}
