// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";
import { AutoAgentsWidget } from "@/app/element/auto-agents";

class AutoAgentsViewModel {
    blockId: string;
    nodeModel: any;
    tabModel: any;
    blockAtom: any;
    viewType = "auto-agents";

    constructor(blockId: string, nodeModel: any, tabModel: any) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.blockAtom = null;
    }

    get viewComponent() {
        return AutoAgentsView;
    }
}

function AutoAgentsView({ blockId, model }: { blockId?: string; model: AutoAgentsViewModel }) {
    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            <AutoAgentsWidget />
        </div>
    );
}

export { AutoAgentsViewModel };
