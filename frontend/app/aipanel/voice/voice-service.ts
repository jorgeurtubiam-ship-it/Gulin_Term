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
        globalStore.set(interimTranscriptAtom, "Transcribiendo con Google...");
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
                const base64Audio = await this.blobToBase64(recordedBlob);
                const googleModel = globalStore.get(googleAudioModelAtom) || "gemini-3.1-flash-lite";

                // Extraer apiKey de Google desde aiModeConfigs
                const aiConfigs = globalStore.get(GulinAIModel.getInstance().aiModeConfigs) || {};
                let foundApiKey = "";
                for (const [k, v] of Object.entries(aiConfigs)) {
                    if ((v as any)["ai:provider"] === "google" || k.includes("gemini")) {
                        if ((v as any)["ai:apitoken"]) {
                            foundApiKey = (v as any)["ai:apitoken"];
                            break;
                        }
                    }
                }

                if (!foundApiKey) {
                    foundApiKey = "AIzaSyAVdLm2MSjJjvyuisFa3O4oS0u0Zoyxd-U";
                }

                // Llamada directa a Google Gemini desde Electron Renderer
                const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:generateContent`;
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
                                    text: "Transcribe this audio in its original language. Return ONLY the plain transcription text without commentary, quotes or formatting.",
                                },
                            ],
                        },
                    ],
                };

                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": foundApiKey,
                    },
                    body: JSON.stringify(payload),
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
                        finalResult = data.candidates[0].content.parts[0].text.trim();
                    }
                } else {
                    const errText = await response.text();
                    console.warn(`Error en Google Gemini Voice HTTP ${response.status}:`, errText);
                }
            } catch (err) {
                console.warn("Error en transcripción de Google Gemini:", err);
            }
        }

        globalStore.set(interimTranscriptAtom, "");
        globalStore.set(finalTranscriptAtom, finalResult);

        if (this.onTranscriptReadyCallback && finalResult) {
            this.onTranscriptReadyCallback(finalResult);
        }

        if (!finalResult) {
            globalStore.set(voiceStateAtom, "idle");
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

        this.analyser = null;
        this.mediaRecorder = null;
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

    public speakResponse(text: string) {
        if (typeof window === "undefined" || !window.speechSynthesis) return;

        const isTTSEnabled = globalStore.get(isTTSEnabledAtom);
        if (!isTTSEnabled) return;

        this.stopSpeaking();

        const cleanText = this.cleanMarkdownForSpeech(text);
        if (!cleanText || cleanText.trim().length === 0) return;

        const utterance = new SpeechSynthesisUtterance(cleanText);
        const config = globalStore.get(voiceConfigAtom);

        utterance.lang = config.lang || "es-ES";
        utterance.rate = config.rate || 1.05;
        utterance.pitch = config.pitch || 1.0;
        utterance.volume = 1.0;

        const voices = window.speechSynthesis.getVoices();
        const spanishVoices = voices.filter((v) => v.lang.startsWith("es"));
        const preferredVoice =
            spanishVoices.find((v) => v.name.includes("Mónica") || v.name.includes("Jorge") || v.name.includes("Natural") || v.name.includes("Google")) ||
            spanishVoices[0];

        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }

        utterance.onstart = () => {
            globalStore.set(voiceStateAtom, "speaking");
        };

        utterance.onend = () => {
            globalStore.set(voiceStateAtom, "idle");
        };

        utterance.onerror = () => {
            globalStore.set(voiceStateAtom, "idle");
        };

        window.speechSynthesis.speak(utterance);
    }

    public stopSpeaking() {
        if (typeof window !== "undefined" && window.speechSynthesis) {
            window.speechSynthesis.cancel();
            if (globalStore.get(voiceStateAtom) === "speaking") {
                globalStore.set(voiceStateAtom, "idle");
            }
        }
    }

    private cleanMarkdownForSpeech(md: string): string {
        if (!md) return "";

        let text = md.replace(/```[\s\S]*?```/g, " [Código generado en pantalla] ");
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
