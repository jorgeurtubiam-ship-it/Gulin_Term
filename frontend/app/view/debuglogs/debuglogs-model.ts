// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import { WOS } from "@/store/global";
import { UniversalLogsView } from "./debuglogs";

export class DebugLogsViewModel implements ViewModel {
    viewType: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    blockId: string;
    blockAtom: jotai.Atom<Block>;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "debug-logs";
        this.blockId = blockId;
        this.blockAtom = WOS.getGulinObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = jotai.atom("bug");
        this.viewName = jotai.atom("Consola de Servicios Gulin");
    }

    get viewComponent(): any {
        return UniversalLogsView;
    }
}
