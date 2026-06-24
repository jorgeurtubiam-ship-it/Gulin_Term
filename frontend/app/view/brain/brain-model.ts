// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import { atom, Atom } from "jotai";
import { getWebServerEndpoint } from "@/util/endpoints";
import { BrainView } from "./brain";

export interface SkillData {
    name: string;
    level: number;
    description: string;
}

export interface NodeData {
    id: string;
    label: string;
    type: string;
    status: string;
    icon: string;
    x: number;
    y: number;
    description: string;
    parent_id?: string;
    xp_value: number;
    node_group: string;
    status_color: string;
}

export interface EdgeData {
    id: number;
    source: string;
    target: string;
    traffic: string;
}

export interface EpistemicData {
    total_memory_nodes: number;
    avg_confidence: number;
    memory_breakdown: Record<string, number>;
}

export interface BrainDataResponse {
    nodes: NodeData[];
    edges: EdgeData[];
    epistemic: EpistemicData;
    skills: SkillData[];
    total_xp: number;
    level: number;
}

export interface XPBreakdown {
    action: string;
    total: number;
    count: number;
}

export interface XPAction {
    id: number;
    action: string;
    xp_gained: number;
    source: string;
    created_at: string;
}

export interface XPStatsResponse {
    total_xp: number;
    level: number;
    xp_breakdown: XPBreakdown[];
    recent_actions: XPAction[];
}

export const BRAIN_BASE_URL = getWebServerEndpoint();

export class BrainViewModel implements ViewModel {
    viewType: string;
    viewComponent = BrainView;
    viewIcon: Atom<string>;
    viewName: Atom<string>;
    viewText: Atom<string>;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "brain";

        this.viewIcon = atom(() => "brain");
        this.viewName = atom(() => "Brain Map");
        this.viewText = atom(() => "Interactive Brain / Map of Knowledge & Infrastructure");
    }

    dispose() {}
}
