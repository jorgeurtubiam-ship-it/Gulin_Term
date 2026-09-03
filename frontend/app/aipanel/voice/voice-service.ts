// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/global";
import {
    audioLevelAtom,
    finalTranscriptAtom,
    googleAudioModelAtom,
    interimTranscriptAtom,
    isTTSEnabledAtom,
    lastQueryWasVoiceAtom,
    recordingDurationAtom,
    voiceConfigAtom,
    voiceStateAtom,
} from "./voice-atoms";
import { GulinAIModel } from "../gulinai-model";

export class VoiceService {
    private static instance: VoiceService | null = null;

    private mediaStream: MediaStream | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private animationFrameId: number | null = null;
    private timerIntervalId: any = null;
    private isRecording: boolean = false;
    private onTranscriptReadyCallback: ((text: string) => void) | null = null;

    private constructor() {}

    public static getInstance(): VoiceService {
        if (!VoiceService.instance) {
            VoiceService.instance = new VoiceService();
        }
        return VoiceService.instance;
    }

    /**
     * Inicia la captura de audio y análisis de volumen para la onda sonora
     */
    public async startRecording(onTranscriptReady?: (text: string) => void): Promise<boolean> {
        if (this.isRecording) return true;

        this.stopSpeaking();

        this.onTranscriptReadyCallback = onTranscriptReady || null;
        this.audioChunks = [];
        globalStore.set(interimTranscriptAtom, "");
        globalStore.set(finalTranscriptAtom, "");
        globalStore.set(recordingDurationAtom, 0);
        globalStore.set(audioLevelAtom, 0);

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                ? "audio/webm;codecs=opus"
                : MediaRecorder.isTypeSupported("audio/webm")
                ? "audio/webm"
                : "audio/mp4";

            this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    this.audioChunks.push(e.data);
                }
            };
            this.mediaRecorder.start(100);

            // Iniciar analizador Web Audio API para animación de ondas en vivo
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            this.audioContext = new AudioContextClass();
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            source.connect(this.analyser);

            this.startAudioMeter();

            this.isRecording = true;
            globalStore.set(voiceStateAtom, "recording");
            this.playTone(440, 0.08, "sine");

            let seconds = 0;
            this.timerIntervalId = setInterval(() => {
                seconds++;
                globalStore.set(recordingDurationAtom, seconds);
            }, 1000);

            return true;
        } catch (err) {
            console.error("No se pudo acceder al micrófono:", err);
            this.cleanupRecording();
            globalStore.set(voiceStateAtom, "idle");
            return false;
        }
    }

    /**
     * Detiene la grabación, envía el audio a Google Gemini directamente y ejecuta el comando
     */
    public async stopAndSubmit(): Promise<string> {
        if (!this.isRecording) return "";

        globalStore.set(voiceStateAtom, "processing");
        globalStore.set(interimTranscriptAtom, "Transcribiendo en tu Mac...");
        globalStore.set(lastQueryWasVoiceAtom, true);

        this.playTone(880, 0.08, "sine");

        let recordedBlob: Blob | null = null;
        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
            try {
                const mime = this.mediaRecorder.mimeType || "audio/webm";
                await new Promise<void>((resolve) => {
                    if (!this.mediaRecorder) {
                        resolve();
                        return;
                    }
                    this.mediaRecorder.onstop = () => resolve();
                    this.mediaRecorder.stop();
                });

                if (this.audioChunks.length > 0) {
                    recordedBlob = new Blob(this.audioChunks, { type: mime });
                }
            } catch (e) {
                console.warn("Error finalizando MediaRecorder:", e);
            }
        }

        this.cleanupRecording();

        let finalResult = "";

        if (recordedBlob && recordedBlob.size > 200) {
            try {
                const aiConfigs = globalStore.get(GulinAIModel.getInstance().aiModeConfigs) || {};

                // 1. Transcribir con Whisper (OpenAI)
                let openAiKey = "";
                for (const [k, v] of Object.entries(aiConfigs)) {
                    if ((v as any)["ai:provider"] === "openai" || k.includes("openai")) {
                        if ((v as any)["ai:apitoken"]) {
                            openAiKey = (v as any)["ai:apitoken"];
                            break;
                        }
                    }
                }

                if (openAiKey) {
                    globalStore.set(interimTranscriptAtom, "Transcribiendo con Whisper...");
                    try {
                        const formData = new FormData();
                        const isWebm = recordedBlob.type?.includes("webm") || !recordedBlob.type?.includes("mp4");
                        const ext = isWebm ? "webm" : "mp4";
                        const mime = isWebm ? "audio/webm" : "audio/mp4";
                        const cleanBlob = new Blob(this.audioChunks, { type: mime });
                        formData.append("file", cleanBlob, `audio.${ext}`);
                        formData.append("model", "whisper-1");
                        formData.append("language", "es");

                        const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
                            method: "POST",
                            headers: {
                                Authorization: `Bearer ${openAiKey}`,
                            },
                            body: formData,
                        });

                        if (resp.ok) {
                            const data = await resp.json();
                            if (data && data.text) {
                                finalResult = data.text.trim();
                            }
                        } else {
                            const err = await resp.text();
                            console.warn("Whisper OpenAI STT status:", resp.status, err);
                        }
                    } catch (err) {
                        console.warn("Error conectando con Whisper:", err);
                    }
                }

                // 2. Fallback a Google Gemini si no hay resultado
                if (!finalResult) {
                    let foundApiKey = "";
                    let selectedGoogleModel = globalStore.get(googleAudioModelAtom) || "gemini-2.5-flash";

                    for (const [k, v] of Object.entries(aiConfigs)) {
                        if ((v as any)["ai:provider"] === "google" || k.includes("gemini")) {
                            if ((v as any)["ai:apitoken"]) {
                                foundApiKey = (v as any)["ai:apitoken"];
                            }
                            if ((v as any)["ai:model"]) {
                                selectedGoogleModel = (v as any)["ai:model"];
                            }
                            break;
                        }
                    }

                    if (foundApiKey) {
                        const base64Audio = await this.blobToBase64(recordedBlob);
                        const modelsToTry = [
                            selectedGoogleModel || "gemini-2.5-flash",
                            "gemini-2.5-flash",
                            "gemini-1.5-flash",
                        ];
                        const uniqueModels = Array.from(new Set(modelsToTry));

                        for (const modelToUse of uniqueModels) {
                            try {
                                globalStore.set(interimTranscriptAtom, `Procesando con ${modelToUse}...`);
                                const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent`;
                                const payload = {
                                    contents: [
                                        {
                                            parts: [
                                                {
                                                    inlineData: {
                                                        mimeType: recordedBlob.type || "audio/webm",
                                                        data: base64Audio,
                                                    },
                                                },
                                                {
                                                    text: "Transcribe this audio verbatim in its original language. Output ONLY the plain transcription text without commentary, markdown, or quotation marks.",
                                                },
                                            ],
                                        },
                                    ],
                                };

                                const requestHeaders: Record<string, string> = {
                                    "Content-Type": "application/json",
                                };
                                if (foundApiKey.startsWith("AQ.") || foundApiKey.startsWith("ya29.")) {
                                    requestHeaders["Authorization"] = `Bearer ${foundApiKey}`;
                                    requestHeaders["x-goog-api-key"] = foundApiKey;
                                } else {
                                    requestHeaders["x-goog-api-key"] = foundApiKey;
                                }

                                const response = await fetch(endpoint, {
                                    method: "POST",
                                    headers: requestHeaders,
                                    body: JSON.stringify(payload),
                                });

                                if (response.ok) {
                                    const data = await response.json();
                                    if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
                                        finalResult = data.candidates[0].content.parts[0].text.trim();
                                        break;
                                    }
                                }
                            } catch (e) {
                                console.warn(`Error probando modelo ${modelToUse}:`, e);
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn("Error en transcripción de voz:", err);
            }
        }

        globalStore.set(interimTranscriptAtom, "");
        globalStore.set(finalTranscriptAtom, finalResult);
        globalStore.set(voiceStateAtom, "idle");

        if (this.onTranscriptReadyCallback && finalResult) {
            this.onTranscriptReadyCallback(finalResult);
        }

        return finalResult;
    }

    public cancelRecording() {
        this.cleanupRecording();
        globalStore.set(voiceStateAtom, "idle");
        globalStore.set(interimTranscriptAtom, "");
        globalStore.set(finalTranscriptAtom, "");
        globalStore.set(audioLevelAtom, 0);
        globalStore.set(recordingDurationAtom, 0);
    }

    private cleanupRecording() {
        this.isRecording = false;

        if (this.timerIntervalId) {
            clearInterval(this.timerIntervalId);
            this.timerIntervalId = null;
        }

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track) => track.stop());
            this.mediaStream = null;
        }

        if (this.audioContext && this.audioContext.state !== "closed") {
            try {
                this.audioContext.close();
            } catch (e) {}
            this.audioContext = null;
        }

        this.mediaRecorder = null;
        this.analyser = null;
    }

    private startAudioMeter() {
        if (!this.analyser) return;

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

        const updateMeter = () => {
            if (!this.isRecording || !this.analyser) return;

            this.analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            const normalizedLevel = Math.min(1, Math.max(0, average / 100));

            globalStore.set(audioLevelAtom, normalizedLevel);
            this.animationFrameId = requestAnimationFrame(updateMeter);
        };

        this.animationFrameId = requestAnimationFrame(updateMeter);
    }

    private currentUtterance: SpeechSynthesisUtterance | null = null;
    private currentAudio: HTMLAudioElement | null = null;

    public async speakResponse(text: string) {
        if (typeof window === "undefined") return;

        this.stopSpeaking();

        const cleanText = this.cleanMarkdownForSpeech(text);
        if (!cleanText || cleanText.trim().length === 0) return;

        globalStore.set(voiceStateAtom, "speaking");

        const aiConfigs = globalStore.get(GulinAIModel.getInstance().aiModeConfigs) || {};
        let miniMaxKey = "";
        let openAiKey = "";
        for (const [k, v] of Object.entries(aiConfigs)) {
            const val = v as any;
            const provider = (val["ai:provider"] || "").toLowerCase();
            const apitoken = val["ai:apitoken"] || "";
            if (provider.includes("minimax") || k.toLowerCase().includes("minimax")) {
                if (apitoken) miniMaxKey = apitoken;
            }
            if (provider.includes("openai") || k.toLowerCase().includes("openai")) {
                if (apitoken) openAiKey = apitoken;
            }
        }

        // 1. MiniMax Speech T2A (speech-01-turbo) - Voz ultra realista en tu plan
        if (miniMaxKey) {
            try {
                const resp = await fetch("https://api.minimax.io/v1/t2a_v2", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${miniMaxKey}`,
                    },
                    body: JSON.stringify({
                        model: "speech-01-turbo",
                        text: cleanText,
                        stream: false,
                        voice_setting: {
                            voice_id: "male-qn-qingse",
                            speed: 1.0,
                            vol: 1.0,
                            pitch: 0,
                        },
                        audio_setting: {
                            sample_rate: 32000,
                            bitrate: 128000,
                            format: "mp3",
                            channel: 1,
                        },
                    }),
                });

                if (resp.ok) {
                    const data = await resp.json();
                    if (data?.data?.audio) {
                        const hex = data.data.audio;
                        const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)));
                        const blob = new Blob([bytes], { type: "audio/mp3" });
                        const audioUrl = URL.createObjectURL(blob);
                        const audio = new Audio(audioUrl);
                        this.currentAudio = audio;

                        audio.onplay = () => {
                            globalStore.set(voiceStateAtom, "speaking");
                        };

                        audio.onended = () => {
                            this.currentAudio = null;
                            globalStore.set(voiceStateAtom, "idle");
                            URL.revokeObjectURL(audioUrl);
                        };

                        audio.onerror = (e) => {
                            console.warn("Error reproduciendo audio MiniMax T2A:", e);
                            this.currentAudio = null;
                            globalStore.set(voiceStateAtom, "idle");
                        };

                        await audio.play();
                        return;
                    }
                }
            } catch (err) {
                console.warn("MiniMax T2A error:", err);
            }
        }

        // 2. Fallback a OpenAI TTS (tts-1)
        if (openAiKey) {
            try {
                const resp = await fetch("https://api.openai.com/v1/audio/speech", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${openAiKey}`,
                    },
                    body: JSON.stringify({
                        model: "tts-1",
                        input: cleanText,
                        voice: "nova",
                    }),
                });

                if (resp.ok) {
                    const blob = await resp.blob();
                    const audioUrl = URL.createObjectURL(blob);
                    const audio = new Audio(audioUrl);
                    this.currentAudio = audio;

                    audio.onplay = () => {
                        globalStore.set(voiceStateAtom, "speaking");
                    };

                    audio.onended = () => {
                        this.currentAudio = null;
                        globalStore.set(voiceStateAtom, "idle");
                        URL.revokeObjectURL(audioUrl);
                    };

                    audio.onerror = (e) => {
                        console.warn("Error reproduciendo audio TTS:", e);
                        this.currentAudio = null;
                        globalStore.set(voiceStateAtom, "idle");
                    };

                    await audio.play();
                    return;
                }
            } catch (err) {
                console.warn("OpenAI TTS error:", err);
            }
        }

        // 2. Fallback a voz nativa de macOS
        const api = (window as any).api;
        if (api && typeof api.nativeSpeak === "function") {
            try {
                await api.nativeSpeak(cleanText);
                globalStore.set(voiceStateAtom, "idle");
                return;
            } catch (e) {
                console.warn("Native speak fallback:", e);
            }
        }

        // 3. Fallback a SpeechSynthesis del navegador
        if (window.speechSynthesis) {
            try {
                if (window.speechSynthesis.paused) {
                    window.speechSynthesis.resume();
                }
            } catch (e) {}

            const utterance = new SpeechSynthesisUtterance(cleanText);
            this.currentUtterance = utterance;
            utterance.lang = "es-ES";
            utterance.rate = 1.05;
            utterance.onend = () => {
                this.currentUtterance = null;
                globalStore.set(voiceStateAtom, "idle");
            };
            utterance.onerror = () => {
                this.currentUtterance = null;
                globalStore.set(voiceStateAtom, "idle");
            };
            window.speechSynthesis.speak(utterance);
        }

        // Timeout de seguridad para resetear voiceState si por cualquier motivo el audio termina silenciosamente
        setTimeout(() => {
            if (globalStore.get(voiceStateAtom) === "speaking") {
                globalStore.set(voiceStateAtom, "idle");
            }
        }, 12000);
    }

    public stopSpeaking() {
        if (this.currentAudio) {
            try {
                this.currentAudio.pause();
                this.currentAudio.currentTime = 0;
            } catch (e) {}
            this.currentAudio = null;
        }

        const api = (window as any).api;
        if (api && typeof api.nativeStopSpeak === "function") {
            try {
                api.nativeStopSpeak();
            } catch (e) {}
        }

        if (typeof window !== "undefined" && window.speechSynthesis) {
            try {
                window.speechSynthesis.cancel();
            } catch (e) {}
            this.currentUtterance = null;
        }

        globalStore.set(voiceStateAtom, "idle");
    }

    private cleanMarkdownForSpeech(md: string): string {
        if (!md) return "";

        // Remover bloques de razonamiento/pensamiento interno
        let text = md.replace(/<(?:think|thought)>[\s\S]*?(?:<\/(?:think|thought)>|$)/gi, "");
        text = text.replace(/```[\s\S]*?```/g, " [Código generado en pantalla] ");
        text = text.replace(/`([^`]+)`/g, "$1");
        text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
        text = text.replace(/#{1,6}\s+/g, "");
        text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
        text = text.replace(/(\*|_)(.*?)\1/g, "$2");
        text = text.replace(/\|[^\n]+\|/g, "");
        text = text.replace(/<!--[\s\S]*?-->/g, "");
        text = text.replace(/https?:\/\/\S+/g, "enlace");
        text = text.replace(/^\s*[-*+]\s+/gm, "");
        text = text.replace(/^\s*\d+\.\s+/gm, "");
        text = text.replace(/\n\s*\n/g, ". ");
        text = text.replace(/\n/g, " ");
        text = text.replace(/\s+/g, " ").trim();

        if (text.length > 500) {
            const firstDot = text.indexOf(".", 350);
            if (firstDot !== -1 && firstDot < 500) {
                text = text.substring(0, firstDot + 1);
            } else {
                text = text.substring(0, 450) + "... el resto está visible en pantalla.";
            }
        }

        return text;
    }

    private blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64data = reader.result as string;
                const pureBase64 = base64data.split(",")[1] || base64data;
                resolve(pureBase64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    private playTone(freq: number, duration: number, type: OscillatorType = "sine") {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);

            gain.gain.setValueAtTime(0.04, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + duration);

            setTimeout(() => ctx.close(), duration * 1000 + 100);
        } catch (e) {}
    }
}
