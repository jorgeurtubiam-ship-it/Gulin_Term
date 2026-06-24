import { gulinAIHasFocusWithin } from "@/app/aipanel/gulinai-focus-utils";
import { GulinAIModel } from "@/app/aipanel/gulinai-model";
import { atoms, getBlockComponentModel } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { focusedBlockId } from "@/util/focusutil";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { Atom, atom, type PrimitiveAtom } from "jotai";

export type FocusStrType = "node" | "gulinai";

export class FocusManager {
    private static instance: FocusManager | null = null;

    focusType: PrimitiveAtom<FocusStrType> = atom("node");
    blockFocusAtom: Atom<string | null>;

    private constructor() {
        this.blockFocusAtom = atom((get) => {
            if (get(this.focusType) == "gulinai") {
                return null;
            }
            const layoutModel = getLayoutModelForStaticTab();
            const lnode = get(layoutModel.focusedNode);
            return lnode?.data?.blockId;
        });
    }

    static getInstance(): FocusManager {
        if (!FocusManager.instance) {
            FocusManager.instance = new FocusManager();
        }
        return FocusManager.instance;
    }

    setGulinAIFocused(force: boolean = false) {
        const isAlreadyFocused = globalStore.get(this.focusType) == "gulinai";
        if (!force && isAlreadyFocused) {
            return;
        }
        globalStore.set(this.focusType, "gulinai");
        this.refocusNode();
    }

    setBlockFocus(force: boolean = false) {
        const ftype = globalStore.get(this.focusType);
        if (!force && ftype == "node") {
            return;
        }
        globalStore.set(this.focusType, "node");
        this.refocusNode();
    }

    gulinAIFocusWithin(): boolean {
        return gulinAIHasFocusWithin();
    }

    nodeFocusWithin(): boolean {
        return focusedBlockId() != null;
    }

    requestNodeFocus(): void {
        globalStore.set(this.focusType, "node");
    }

    requestGulinAIFocus(): void {
        globalStore.set(this.focusType, "gulinai");
    }

    getFocusType(): FocusStrType {
        return globalStore.get(this.focusType);
    }

    refocusNode() {
        const ftype = globalStore.get(this.focusType);
        if (ftype == "gulinai") {
            GulinAIModel.getInstance().focusInput();
            return;
        }
        const layoutModel = getLayoutModelForStaticTab();
        const lnode = globalStore.get(layoutModel.focusedNode);
        if (lnode == null || lnode.data?.blockId == null) {
            return;
        }
        layoutModel.focusNode(lnode.id);
        const blockId = lnode.data.blockId;
        const bcm = getBlockComponentModel(blockId);
        const ok = bcm?.viewModel?.giveFocus?.();
        if (!ok) {
            const inputElem = document.getElementById(`${blockId}-dummy-focus`);
            inputElem?.focus();
        }
    }
}
