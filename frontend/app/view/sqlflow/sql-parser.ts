// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * sql-parser.ts
 * Converts a SQL string into a React Flow graph (nodes + edges).
 * Uses node-sql-parser@5.4.0 — same library as SQL Crack.
 */

import { Parser } from "node-sql-parser";
import type { Node, Edge } from "@xyflow/react";

export type SqlNodeType =
    | "TABLE"
    | "JOIN"
    | "FILTER"
    | "AGGREGATE"
    | "WINDOW"
    | "CTE"
    | "SUBQUERY"
    | "SORT"
    | "LIMIT"
    | "RESULT";

export interface SqlFlowNode extends Record<string, unknown> {
    sqlType: SqlNodeType;
    details?: string[];
}

export interface ParseResult {
    nodes: Node<SqlFlowNode>[];
    edges: Edge[];
    error?: string;
}

// Dialect mapping from Gulin DB type → node-sql-parser database option
const DIALECT_MAP: Record<string, string> = {
    oracle: "Oracle",
    postgres: "PostgreSQL",
    postgresql: "PostgreSQL",
    mysql: "MySQL",
    mariadb: "MySQL",
    mssql: "TransactSQL",
    sqlserver: "TransactSQL",
    sqlite: "SQLite",
    bigquery: "BigQuery",
};

let nodeCounter = 0;
const newId = (prefix: string) => `${prefix}-${++nodeCounter}`;

export function parseSqlToGraph(sql: string, dbType: string = "oracle"): ParseResult {
    nodeCounter = 0;
    const dialect = DIALECT_MAP[dbType?.toLowerCase()] ?? "Oracle";
    const parser = new Parser();
    let ast: any;

    try {
        ast = parser.astify(sql, { database: dialect });
    } catch (e) {
        // Fallback: try MySQL dialect (most permissive)
        try {
            ast = parser.astify(sql, { database: "MySQL" });
        } catch (e2) {
            return buildFallbackGraph(sql, String(e));
        }
    }

    const stmts = Array.isArray(ast) ? ast : [ast];
    const allNodes: Node<SqlFlowNode>[] = [];
    const allEdges: Edge[] = [];

    for (const stmt of stmts) {
        if (!stmt) continue;
        const { nodes, edges } = buildGraphFromStmt(stmt);
        allNodes.push(...nodes);
        allEdges.push(...edges);
    }

    // Add final RESULT node connected to last node
    if (allNodes.length > 0) {
        const resultId = newId("result");
        allNodes.push({
            id: resultId,
            type: "sqlNode",
            data: { sqlType: "RESULT", label: "Result" },
            position: { x: 0, y: 0 },
        });
        const lastNode = allNodes[allNodes.length - 2]; // second to last (before result)
        if (lastNode) {
            allEdges.push({ id: `e-${lastNode.id}-${resultId}`, source: lastNode.id, target: resultId });
        }
    }

    return { nodes: allNodes, edges: allEdges };
}

function buildGraphFromStmt(stmt: any): { nodes: Node<SqlFlowNode>[]; edges: Edge[] } {
    const nodes: Node<SqlFlowNode>[] = [];
    const edges: Edge[] = [];

    if (stmt.type !== "select") {
        // For non-select (INSERT, UPDATE, MERGE, etc.) show a simple node
        const id = newId("stmt");
        nodes.push({
            id,
            type: "sqlNode",
            data: { sqlType: "TABLE", label: stmt.type?.toUpperCase() ?? "STATEMENT" },
            position: { x: 0, y: 0 },
        });
        return { nodes, edges };
    }

    // ── CTEs (WITH clause) ──
    const cteMap: Record<string, string> = {}; // cte name → node id
    if (stmt.with) {
        for (const cte of stmt.with) {
            const cteId = newId("cte");
            const cteName = cte.name?.value ?? cte.name ?? "CTE";
            cteMap[cteName.toUpperCase()] = cteId;
            nodes.push({
                id: cteId,
                type: "sqlNode",
                data: { sqlType: "CTE", label: cteName },
                position: { x: 0, y: 0 },
            });
        }
    }

    // ── FROM tables ──
    const fromTables = extractTables(stmt.from ?? []);
    const tableNodeIds: string[] = [];

    for (const tbl of fromTables) {
        const upperName = tbl.toUpperCase();
        // If it's a CTE reference, reuse the CTE node
        if (cteMap[upperName]) {
            tableNodeIds.push(cteMap[upperName]);
            continue;
        }
        const tblId = newId("table");
        tableNodeIds.push(tblId);
        nodes.push({
            id: tblId,
            type: "sqlNode",
            data: { sqlType: "TABLE", label: tbl },
            position: { x: 0, y: 0 },
        });
    }

    // ── JOINs ──
    let lastJoinId: string | null = null;
    const joins = extractJoins(stmt.from ?? []);

    if (joins.length > 0) {
        for (const join of joins) {
            const joinId = newId("join");
            nodes.push({
                id: joinId,
                type: "sqlNode",
                data: {
                    sqlType: "JOIN",
                    label: join.type || "JOIN",
                    details: join.on ? [join.on] : undefined,
                },
                position: { x: 0, y: 0 },
            });

            // Connect table nodes to join
            for (const tblId of tableNodeIds) {
                edges.push({ id: `e-${tblId}-${joinId}`, source: tblId, target: joinId });
            }
            tableNodeIds.length = 0; // consumed
            tableNodeIds.push(joinId);
            lastJoinId = joinId;

            // Add the joined table
            const joinTable = join.table;
            if (joinTable) {
                const jtId = newId("table");
                nodes.push({
                    id: jtId,
                    type: "sqlNode",
                    data: { sqlType: "TABLE", label: joinTable },
                    position: { x: 0, y: 0 },
                });
                edges.push({ id: `e-${jtId}-${joinId}`, source: jtId, target: joinId });
            }
        }
    }

    let prevId = lastJoinId ?? tableNodeIds[0] ?? null;

    // If multiple table nodes with no join, connect them all to a virtual join node
    if (!lastJoinId && tableNodeIds.length > 1) {
        const crossId = newId("join");
        nodes.push({
            id: crossId,
            type: "sqlNode",
            data: { sqlType: "JOIN", label: "CROSS JOIN" },
            position: { x: 0, y: 0 },
        });
        for (const tblId of tableNodeIds) {
            edges.push({ id: `e-${tblId}-${crossId}`, source: tblId, target: crossId });
        }
        prevId = crossId;
    }

    // ── WHERE / FILTER ──
    if (stmt.where) {
        const filterId = newId("filter");
        nodes.push({
            id: filterId,
            type: "sqlNode",
            data: { sqlType: "FILTER", label: "WHERE", details: [serializeExpr(stmt.where)] },
            position: { x: 0, y: 0 },
        });
        if (prevId) edges.push({ id: `e-${prevId}-${filterId}`, source: prevId, target: filterId });
        prevId = filterId;
    }

    // ── GROUP BY + HAVING ──
    if (stmt.groupby) {
        const aggId = newId("agg");
        const groupCols = extractColumnNames(stmt.groupby);
        nodes.push({
            id: aggId,
            type: "sqlNode",
            data: {
                sqlType: "AGGREGATE",
                label: "GROUP BY",
                details: groupCols.length > 0 ? groupCols : undefined,
            },
            position: { x: 0, y: 0 },
        });
        if (prevId) edges.push({ id: `e-${prevId}-${aggId}`, source: prevId, target: aggId });
        prevId = aggId;
    }

    // ── ORDER BY ──
    if (stmt.orderby) {
        const sortId = newId("sort");
        const sortCols = stmt.orderby.map((o: any) => {
            const col = o.expr?.column ?? serializeExpr(o.expr);
            return `${col} ${o.type ?? "ASC"}`;
        });
        nodes.push({
            id: sortId,
            type: "sqlNode",
            data: { sqlType: "SORT", label: "ORDER BY", details: sortCols },
            position: { x: 0, y: 0 },
        });
        if (prevId) edges.push({ id: `e-${prevId}-${sortId}`, source: prevId, target: sortId });
        prevId = sortId;
    }

    // ── LIMIT / ROWNUM ──
    if (stmt.limit) {
        const limitId = newId("limit");
        const limitVal = stmt.limit?.value?.[0]?.value ?? stmt.limit?.value ?? "N";
        nodes.push({
            id: limitId,
            type: "sqlNode",
            data: { sqlType: "LIMIT", label: "LIMIT", details: [`${limitVal} rows`] },
            position: { x: 0, y: 0 },
        });
        if (prevId) edges.push({ id: `e-${prevId}-${limitId}`, source: prevId, target: limitId });
        prevId = limitId;
    }

    return { nodes, edges };
}

// ── Helpers ──

function extractTables(from: any[]): string[] {
    if (!Array.isArray(from)) return [];
    const tables: string[] = [];
    for (const item of from) {
        if (item?.table) {
            const schema = item.db ? `${item.db}.` : "";
            tables.push(`${schema}${item.table}`);
        }
    }
    return tables;
}

function extractJoins(from: any[]): { type: string; table: string; on: string | null }[] {
    if (!Array.isArray(from)) return [];
    const joins: { type: string; table: string; on: string | null }[] = [];
    for (const item of from) {
        if (item?.join) {
            joins.push({
                type: item.join.replace(/_/g, " "),
                table: item.table ?? "",
                on: item.on ? serializeExpr(item.on) : null,
            });
        }
    }
    return joins;
}

function extractColumnNames(exprs: any[]): string[] {
    if (!Array.isArray(exprs)) return [];
    return exprs.map((e) => e?.column ?? serializeExpr(e)).filter(Boolean);
}

function serializeExpr(expr: any): string {
    if (!expr) return "";
    if (typeof expr === "string") return expr;
    if (expr.type === "column_ref") return `${expr.table ? expr.table + "." : ""}${expr.column}`;
    if (expr.type === "binary_expr") return `${serializeExpr(expr.left)} ${expr.operator} ${serializeExpr(expr.right)}`;
    if (expr.type === "function") return `${expr.name}(...)`;
    if (expr.type === "number") return String(expr.value);
    if (expr.type === "string") return `'${expr.value}'`;
    return JSON.stringify(expr)?.slice(0, 40) ?? "";
}

// Fallback when parser fails completely — extract tables via regex
function buildFallbackGraph(sql: string, error: string): ParseResult {
    nodeCounter = 0;
    const nodes: Node<SqlFlowNode>[] = [];
    const edges: Edge[] = [];

    const tableRegex = /\bFROM\s+([\w.]+)|JOIN\s+([\w.]+)/gi;
    const tables = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = tableRegex.exec(sql)) !== null) {
        tables.add(match[1] ?? match[2]);
    }

    let prevId: string | null = null;
    for (const tbl of tables) {
        const id = newId("table");
        nodes.push({ id, type: "sqlNode", data: { sqlType: "TABLE", label: tbl }, position: { x: 0, y: 0 } });
        if (prevId) edges.push({ id: `e-${prevId}-${id}`, source: prevId, target: id });
        prevId = id;
    }

    const resultId = newId("result");
    nodes.push({ id: resultId, type: "sqlNode", data: { sqlType: "RESULT", label: "Result" }, position: { x: 0, y: 0 } });
    if (prevId) edges.push({ id: `e-${prevId}-${resultId}`, source: prevId, target: resultId });

    return { nodes, edges, error };
}
