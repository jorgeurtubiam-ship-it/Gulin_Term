// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export interface DebugLogEntry {
    id: string;
    category: string;
    message: string;
    ts: number;
    toolName?: string;
    durationMs?: number;
    status?: 'success' | 'fail';
    errorContext?: string;
}

export type LogCategory = "API" | "TERM" | "FILE" | "DB" | "AI" | "PLAI";

export const LOG_CATEGORIES: LogCategory[] = ["API", "TERM", "FILE", "DB", "AI", "PLAI"];

export const LOG_COLORS: Record<string, string> = {
    API: "text-blue-400 border-blue-500/30 bg-blue-500/5",
    TERM: "text-green-400 border-green-500/30 bg-green-500/5",
    FILE: "text-amber-400 border-amber-500/30 bg-amber-500/5",
    DB: "text-purple-400 border-purple-500/30 bg-purple-500/5",
    AI: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
    PLAI: "text-rose-400 border-rose-500/30 bg-rose-500/5",
};

export const DEFAULT_COLOR = "text-gray-400 border-gray-500/30 bg-gray-500/5";

export const LOG_ICONS: Record<string, string> = {
    API: "fa-cloud",
    TERM: "fa-terminal",
    FILE: "fa-file",
    DB: "fa-database",
    AI: "fa-brain",
    PLAI: "fa-robot",
};

/**
 * Mask sensitive data patterns (tokens, keys, passwords) in log messages.
 * Shows first 4 and last 4 characters, masking the middle with ***.
 */
export function maskSensitiveData(text: string): string {
    return text.replace(
        /(token|key|auth|password|secret|pwd)=([^&\s]+)/gi,
        (match, p1, p2) => {
            if (p2.length <= 8) return `${p1}=****`;
            return `${p1}=${p2.substring(0, 4)}***${p2.substring(p2.length - 4)}`;
        }
    );
}

/**
 * Truncate long messages for preview display.
 */
export function truncateMessage(message: string, maxLen = 200): string {
    if (message.length <= maxLen) return message;
    return message.substring(0, maxLen) + "...";
}
