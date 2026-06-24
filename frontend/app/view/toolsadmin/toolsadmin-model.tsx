import { BlockNodeModel, FullBlockProps, ViewModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import { atom } from "jotai";
import { ToolsAdminView } from "./toolsadmin";

export class ToolsAdminViewModel implements ViewModel {
    viewType: string;
    viewIcon: ReturnType<typeof atom<string>>;
    viewName: ReturnType<typeof atom<string>>;
    viewComponent: React.ComponentType<FullBlockProps>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.viewType = "tools-admin";
        this.viewIcon = atom("wrench");
        this.viewName = atom("Tools Admin");
        this.viewComponent = ToolsAdminView;
    }
}
