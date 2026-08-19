// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";

export type VoiceState = "idle" | "listening" | "recording" | "processing" | "speaking";

// Estado principal del motor de voz
export const voiceStateAtom = atom<VoiceState>("idle");

// Nivel de volumen en tiempo real (0.0 a 1.0) para animación de onda sonora
export const audioLevelAtom = atom<number>(0);

// Duración de la grabación actual en segundos (estilo WhatsApp)
export const recordingDurationAtom = atom<number>(0);

// Transcripción en curso mientras el usuario habla
export const interimTranscriptAtom = atom<string>("");

// Transcripción final lista para enviarse
export const finalTranscriptAtom = atom<string>("");

// Modo Manos Libres activo / inactivo (persiste en localStorage)
const savedHandsFree = typeof window !== "undefined" ? localStorage.getItem("gulin_voice_handsfree") === "true" : false;
const baseHandsFreeAtom = atom<boolean>(savedHandsFree);

export const isHandsFreeEnabledAtom = atom(
    (get) => get(baseHandsFreeAtom),
    (get, set, newValue: boolean) => {
        set(baseHandsFreeAtom, newValue);
        if (typeof window !== "undefined") {
            localStorage.setItem("gulin_voice_handsfree", newValue ? "true" : "false");
        }
    }
);

// Toggle para activar/desactivar la voz de respuesta (TTS)
const savedTTS = typeof window !== "undefined" ? localStorage.getItem("gulin_voice_tts_enabled") !== "false" : true;
const baseTTSEnabledAtom = atom<boolean>(savedTTS);

export const isTTSEnabledAtom = atom(
    (get) => get(baseTTSEnabledAtom),
    (get, set, newValue: boolean) => {
        set(baseTTSEnabledAtom, newValue);
        if (typeof window !== "undefined") {
            localStorage.setItem("gulin_voice_tts_enabled", newValue ? "true" : "false");
        }
    }
);

// Modelo de Google para procesamiento de voz (gemini-3.1-flash-lite)
const savedGoogleModel = typeof window !== "undefined" ? localStorage.getItem("gulin_voice_google_model") || "gemini-3.1-flash-lite" : "gemini-3.1-flash-lite";
const baseGoogleAudioModelAtom = atom<string>(savedGoogleModel);

export const googleAudioModelAtom = atom(
    (get) => get(baseGoogleAudioModelAtom),
    (get, set, newValue: string) => {
        set(baseGoogleAudioModelAtom, newValue);
        if (typeof window !== "undefined") {
            localStorage.setItem("gulin_voice_google_model", newValue);
        }
    }
);

// Indica si la última consulta se realizó por voz (para responder con voz al finalizar)
export const lastQueryWasVoiceAtom = atom<boolean>(false);

// Configuración de voz (idioma, velocidad, tono)
export interface VoiceConfig {
    lang: string;
    rate: number;
    pitch: number;
    wakeWord: string;
}

export const voiceConfigAtom = atom<VoiceConfig>({
    lang: "es-ES",
    rate: 1.05,
    pitch: 1.0,
    wakeWord: "oye gulin",
});
