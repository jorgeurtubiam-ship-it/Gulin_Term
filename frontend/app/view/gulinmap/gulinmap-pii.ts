// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0
// PII Detection Engine — Basado en Ley 21719 (Chile) y referencias del skill ley_pro_datos

export type PIILevel = "red" | "yellow" | "green" | "unknown";

export interface PIIResult {
    level: PIILevel;
    reason: string;
    law?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nivel 1 — Detección por nombre de columna (instantáneo, sin queries)
// Basado en: ley_pro_datos/SKILL.md Fase 1, línea 60
// ─────────────────────────────────────────────────────────────────────────────

const PII_RED_NAMES = [
    "rut", "run", "dni", "cedula", "passport", "pasaporte",
    "email", "correo", "mail",
    "nombre", "apellido", "name", "firstname", "lastname", "fullname", "full_name",
    "telefono", "celular", "phone", "mobile", "fono",
    "direccion", "domicilio", "address", "calle", "ciudad",
    "fecha_nacimiento", "birth_date", "birthdate", "nacimiento", "edad", "age",
    "genero", "sexo", "gender",
    "nacionalidad", "nationality",
];

const PII_YELLOW_NAMES = [
    "ip", "ip_address", "ipaddress", "remote_ip", "client_ip",
    "lat", "lng", "latitude", "longitude", "geo", "location", "gps",
    "salary", "sueldo", "salario", "income", "wage",
    "password", "passwd", "pwd", "hash", "token", "secret", "api_key", "apikey",
    "card", "tarjeta", "credit_card", "pan", "cvv",
    "cuenta", "account", "iban", "swift",
    "device_id", "mac_address", "imei",
    "cookie", "session", "session_id",
    "diagnostico", "diagnosis", "enfermedad", "disease", "salud", "health",
    "religion", "political", "opinion",
    "biometric", "fingerprint", "huella",
];

// ─────────────────────────────────────────────────────────────────────────────
// Nivel 2 — Detección por patrón de valor (sampleo de filas reales)
// ─────────────────────────────────────────────────────────────────────────────

const VALUE_PATTERNS: { pattern: RegExp; level: PIILevel; reason: string }[] = [
    // RUT chileno: 12.345.678-9 o 12345678-9
    { pattern: /^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/, level: "red", reason: "RUT chileno (Ley 21719)" },
    // Email
    { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, level: "red", reason: "Dirección de email" },
    // Teléfono chileno: +56 9 XXXX XXXX
    { pattern: /^(\+?56)?[\s-]?9[\s-]?\d{4}[\s-]?\d{4}$/, level: "red", reason: "Teléfono chileno" },
    // IP address
    { pattern: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, level: "yellow", reason: "Dirección IP" },
    // Coordenadas GPS
    { pattern: /^-?\d{1,3}\.\d{4,}$/, level: "yellow", reason: "Posible coordenada GPS" },
    // Tarjeta de crédito (parcial)
    { pattern: /^\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}$/, level: "yellow", reason: "Posible número de tarjeta" },
    // Token/JWT
    { pattern: /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, level: "yellow", reason: "Token JWT" },
    // Hash bcrypt
    { pattern: /^\$2[aby]\$\d{2}\$.{53}$/, level: "yellow", reason: "Hash de contraseña (bcrypt)" },
];

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nivel 1: Detecta PII por nombre de columna.
 * Instantáneo, sin queries adicionales.
 */
export function detectPIIByName(columnName: string): PIIResult {
    const col = columnName.toLowerCase().replace(/[_\-\s]/g, "");

    for (const name of PII_RED_NAMES) {
        const normalized = name.replace(/[_\-\s]/g, "");
        if (col === normalized || col.includes(normalized)) {
            return {
                level: "red",
                reason: `Nombre de columna coincide con dato personal directo: "${columnName}"`,
                law: "Ley 21719 Art. 2 — Dato personal identificatorio",
            };
        }
    }

    for (const name of PII_YELLOW_NAMES) {
        const normalized = name.replace(/[_\-\s]/g, "");
        if (col === normalized || col.includes(normalized)) {
            return {
                level: "yellow",
                reason: `Nombre de columna coincide con dato potencialmente sensible: "${columnName}"`,
                law: "Ley 21719 Art. 2 — Dato personal indirecto",
            };
        }
    }

    return {
        level: "unknown",
        reason: `Nombre ambiguo: "${columnName}" — requiere análisis de valores`,
    };
}

/**
 * Nivel 2: Detecta PII analizando valores de muestra (5-10 filas).
 * Retorna el nivel más alto encontrado entre las muestras.
 */
export function detectPIIByValues(sampleValues: string[]): PIIResult {
    let highestLevel: PIILevel = "green";
    let highestReason = "Sin patrones PII detectados en los valores de muestra";
    let highestLaw: string | undefined;

    for (const val of sampleValues) {
        if (!val || val === "null" || val === "") continue;
        const strVal = String(val).trim();

        for (const { pattern, level, reason } of VALUE_PATTERNS) {
            if (pattern.test(strVal)) {
                if (level === "red") {
                    return { level: "red", reason, law: "Ley 21719 — Detectado por patrón de valor" };
                }
                if (level === "yellow") {
                    highestLevel = "yellow";
                    highestReason = reason;
                    highestLaw = "Ley 21719 — Detectado por patrón de valor";
                }
            }
        }
    }

    return { level: highestLevel, reason: highestReason, law: highestLaw };
}

/**
 * Combina Nivel 1 + Nivel 2.
 * Si Nivel 1 es "unknown", usa el resultado del Nivel 2.
 */
export function detectPII(columnName: string, sampleValues?: string[]): PIIResult {
    const byName = detectPIIByName(columnName);
    if (byName.level !== "unknown") return byName;
    if (sampleValues && sampleValues.length > 0) {
        return detectPIIByValues(sampleValues);
    }
    return { level: "unknown", reason: `"${columnName}" — requiere análisis IA para clasificar` };
}

/**
 * Emoji + label para mostrar en UI.
 */
export function piiLabel(level: PIILevel): { emoji: string; text: string; color: string } {
    switch (level) {
        case "red":     return { emoji: "🔴", text: "PII",       color: "#ef4444" };
        case "yellow":  return { emoji: "🟡", text: "Sensible",  color: "#f59e0b" };
        case "green":   return { emoji: "🟢", text: "Público",   color: "#22c55e" };
        case "unknown": return { emoji: "⚪", text: "Sin clasificar", color: "#6b7280" };
    }
}

/**
 * Score de PII para una tabla completa (0-100, donde 100 = todo PII).
 */
export function tablePIIScore(results: PIIResult[]): number {
    if (results.length === 0) return 0;
    const weights = { red: 1, yellow: 0.5, green: 0, unknown: 0.2 };
    const total = results.reduce((sum, r) => sum + weights[r.level], 0);
    return Math.round((total / results.length) * 100);
}
