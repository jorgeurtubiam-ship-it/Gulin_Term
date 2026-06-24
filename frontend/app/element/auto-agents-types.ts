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
}
