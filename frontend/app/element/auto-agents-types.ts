// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

export interface AgentData {
    id: string;
    name: string;
    icon: string;
    provider: string;
    endpoint: string;
    model: string;
    api_key_secret: string;
    system_prompt: string;
    color: string;
    enabled: boolean;
    tools?: string[];
    skills?: string[];
    log_file?: string;
    lastStatus?: "idle" | "running" | "success" | "error";
    lastResult?: string;
    lastRun?: string;
}

export interface AgentGroup {
    id: string;
    name: string;
    agent_ids: string[];
}

export interface AgentTask {
    id: string;
    agent_id: string;
    cron: string;
    prompt: string;
    enabled: boolean;
}

export interface AgentChatMessage {
    role: "user" | "assistant";
    agent_id?: string;
    text: string;
    timestamp: string;
    is_group?: boolean;
}

// C1: Tipos para Swarm Canvas (Flujo Real)
export type NodeType = "agent" | "condition" | "router" | "loop" | "evaluate" | "extract";

export interface NodeData {
    type: NodeType;
    id: string;
    label: string;
    config?: any; // Configuraciones específicas del nodo
    status?: "idle" | "running" | "success" | "error";
    lastResult?: any; // Datos reales procesados
}

export interface EdgeData {
    id: string;
    source: string;
    target: string;
    label?: string; // Etiqueta del edge ("true", "false", "item", etc.)
    sourceHandle?: string;
}
