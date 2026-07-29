// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import { atom, Atom } from "jotai";
import { DashboardView } from "./dashboard";
import { makeORef, getGulinObjectAtom } from "@/store/wos";
import { getWebServerEndpoint } from "@/util/endpoints";

/** Tipos para los datos del Brain Map */
interface NodeData {
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

interface EdgeData {
    id: number;
    source: string;
    target: string;
    traffic: string;
}

interface BrainDataResponse {
    nodes: NodeData[];
    edges: EdgeData[];
    total_xp: number;
    level: number;
}

interface XPStatsResponse {
    total_xp: number;
    level: number;
    xp_breakdown: { action: string; total: number; count: number }[];
    recent_actions: { id: number; action: string; xp_gained: number; source: string; created_at: string }[];
}

const BASE_URL = getWebServerEndpoint();

/**
 * DashboardViewModel: Gestiona el estado reactivo del dashboard.
 * 
 * Ahora incluye:
 * - Datos del bloque para gráficos BI (legacy).
 * - Datos en tiempo real desde /brain/data y /brain/stats.
 * - Polling automático cada 30s.
 * - Estado de la pestaña activa (BI Charts vs Brain Grafo).
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

    /** Atom reactivo con el dataset actual del dashboard (parseado como array) */
    dataAtom: Atom<any[]>;
    /** Atom reactivo con el título actual */
    titleAtom: Atom<string>;
    /** Atom reactivo con el tipo de gráfico por defecto */
    chartTypeAtom: Atom<string>;

    // --- Nuevos atoms para Brain Map ---
    /** Datos del cerebro (nodos, aristas, XP) */
    brainDataAtom: Atom<BrainDataResponse | null>;
    /** Stats de XP */
    xpStatsAtom: Atom<XPStatsResponse | null>;
    /** Loading state */
    loadingAtom: Atom<boolean>;
    /** Error state */
    errorAtom: Atom<string | null>;
    /** Pestaña activa en el dashboard */
    activeTabAtom: Atom<"charts" | "brain"> & { init: "charts"; write: (v: "charts" | "brain") => void };

    private pollInterval: ReturnType<typeof setInterval> | null = null;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "dashboard";

        const blockDataAtom = getGulinObjectAtom<any>(makeORef("block", blockId));

        // --- Atoms reactivos del bloque (BI charts) ---
        this.dataAtom = atom((get) => {
            const block = get(blockDataAtom);
            if (!block?.meta) return [];
            const raw = block.meta["dashboard:data"];
            if (!raw) return [];
            try {
                const strData = typeof raw === "string" ? raw : JSON.stringify(raw);
                const parsed = JSON.parse(strData);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        });

        this.titleAtom = atom((get) => {
            const block = get(blockDataAtom);
            return (block?.meta?.["dashboard:title"] as string) || "Gulin BI Station";
        });

        this.chartTypeAtom = atom((get) => {
            const block = get(blockDataAtom);
            return (block?.meta?.["dashboard:type"] as string) || "bar";
        });

        // --- Atoms para Brain Map con polling ---
        const brainDataBaseAtom = atom<BrainDataResponse | null>(null);
        const xpStatsBaseAtom = atom<XPStatsResponse | null>(null);
        const loadingBaseAtom = atom(false);
        const errorBaseAtom = atom<string | null>(null);

        this.brainDataAtom = brainDataBaseAtom;
        this.xpStatsAtom = xpStatsBaseAtom;
        this.loadingAtom = loadingBaseAtom;
        this.errorAtom = errorBaseAtom;
        this.activeTabAtom = atom<"charts" | "brain">("charts") as any;

        // Iniciar polling al crear el ViewModel
        // Nota: como no tenemos acceso directo al lifecycle del bloque,
        // el fetch se hace en el componente DashboardView mediante useEffect.
        // Esto asegura que el fetch ocurra dentro del contexto React correcto.

        this.viewIcon = atom(() => "chart-pie");
        this.viewName = atom(() => "Dashboard");
        this.viewText = atom(() => "Interactive Data Dashboard & Brain Map");
    }

    dispose() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }
}

/** Función helper para hacer fetch de datos del brain desde el componente */
export async function fetchBrainData(): Promise<BrainDataResponse | null> {
    try {
        const res = await fetch(`${BASE_URL}/brain/data`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error("[dashboard] fetchBrainData error:", err);
        return null;
    }
}

export async function fetchXPStats(): Promise<XPStatsResponse | null> {
    try {
        const res = await fetch(`${BASE_URL}/brain/stats`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error("[dashboard] fetchXPStats error:", err);
        return null;
    }
}
