// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0



// ─────────────────────────────────────────────────────────────────────────────
// Tipos de nodo del mapa unificado
// ─────────────────────────────────────────────────────────────────────────────

export type NodeCategory = "infra" | "data" | "neural" | "aws" | "unknown";

export interface MapNode {
    id: string;
    label: string;
    type: string;
    category: NodeCategory;
    status: "online" | "offline" | "degraded" | "pending" | "unknown" | "active" | "stopped";
    icon: string;
    x3: number;
    y3: number;
    z3: number;
    px?: number;
    py?: number;
    pz?: number;
    opacity?: number;
    // 2D position (draggable)
    x2: number;
    y2: number;
    // Metadata
    description?: string;
    metadata?: Record<string, any>;
    xp_value?: number;
    node_group?: string;
    status_color?: string;
    parent_id?: string;
    // Data Catalog fields (solo nodos tipo "data")
    db_type?: string;
    db_name?: string;
    table_name?: string;
    row_count?: number;
    last_updated?: string;
    columns?: CatalogColumn[];
    quality_score?: number;
}

export interface CatalogColumn {
    name: string;
    data_type: string;
    pii_level: "red" | "yellow" | "green" | "unknown";
    pii_reason?: string;
    pii_law?: string;
    sample_values?: string[];
    nullable?: boolean;
    is_pk?: boolean;
}

export interface MapEdge {
    id: string;
    source: string;
    target: string;
    traffic?: string;
    label?: string;
}

export interface MapStats {
    total_nodes: number;
    online: number;
    offline: number;
    pii_tables: number;
    memory_nodes: number;
    avg_confidence: number;
}

export interface ChatMessage {
    role: "user" | "map";
    text: string;
    nodeContext?: string;
    timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function inferCategory(type: string, parentId?: string): NodeCategory {
    const t = (type || "").toLowerCase();
    const p = (parentId || "").toLowerCase();

    if (t.includes("aws") || t.includes("ec2") || t.includes("s3") || t.includes("lightsail") || p.includes("aws")) return "aws";
    if (t.includes("docker") || t.includes("vm") || t.includes("host") || t.includes("net") || t.includes("infra") || t.includes("server")) return "infra";
    if (t.includes("db") || t.includes("database") || t.includes("sql") || t.includes("mongo") || t.includes("table") || t.includes("schema") || t.includes("postgres") || t.includes("mysql") || t.includes("oracle") || t.includes("redis")) return "data";
    if (t.includes("core") || t.includes("skill") || t.includes("plugin") || t.includes("memory") || t.includes("agent") || t.includes("episodic") || t.includes("semantic") || t.includes("neural")) return "neural";

    return "unknown";
}

export function statusColor(status: string): string {
    switch ((status || "").toLowerCase()) {
        case "online": case "active": case "running": case "up": return "#22c55e";
        case "offline": case "stopped": case "down": case "error": return "#ef4444";
        case "degraded": case "warning": case "ext": return "#f59e0b";
        case "pending": return "#6366f1";
        default: return "#6b7280";
    }
}

