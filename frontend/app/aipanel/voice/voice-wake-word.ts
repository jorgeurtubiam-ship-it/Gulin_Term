// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/global";
import {
    finalTranscriptAtom,
    googleAudioModelAtom,
    interimTranscriptAtom,
    isHandsFreeEnabledAtom,
    lastQueryWasVoiceAtom,
    voiceStateAtom,
} from "./voice-atoms";
import { VoiceService } from "./voice-service";
import { GulinAIModel } from "../gulinai-model";

export class VoiceWakeWordService {
    private static instance: VoiceWakeWordService | null = null;

    private mediaStream: MediaStream | null = null;
    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private recordedChunks: Blob[] = [];

    private isRunning: boolean = false;
    private isSpeaking: boolean = false;
    private speechStartTime: number = 0;
    private silenceStartTime: number = 0;
    private maxRecordingTimer: any = null;
    private animationFrameId: number | null = null;
    private onSubmitCommandCallback: ((command: string) => void) | null = null;

    private readonly SPEECH_START_THRESHOLD = 0.13;
    private readonly SPEECH_CONTINUE_THRESHOLD = 0.08;
    private readonly SILENCE_DURATION_MS = 900;
    private readonly MAX_RECORDING_DURATION_MS = 5000;

    private readonly WAKE_WORDS = [
        "oye gulin",
        "hola gulin",
        "gulin",
        "hey gulin",
    ];

    private constructor() {}

    public static getInstance(): VoiceWakeWordService {
        if (!VoiceWakeWordService.instance) {
            VoiceWakeWordService.instance = new VoiceWakeWordService();
        }
        return VoiceWakeWordService.instance;
    }

    public setSubmitCallback(callback: (command: string) => void) {
        this.onSubmitCommandCallback = callback;
    }

    public async start() {
        if (this.isRunning) return;

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            this.audioContext = new AudioContextClass();
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            source.connect(this.analyser);

            this.isRunning = true;
            this.isSpeaking = false;
            this.silenceStartTime = 0;
            this.speechStartTime = 0;
            this.monitorAudioLevel();
        } catch (err) {
            console.error("No se pudo iniciar el modo Manos Libres en Electron:", err);
            this.stop();
            globalStore.set(isHandsFreeEnabledAtom, false);
        }
    }

    public stop() {
        this.isRunning = false;
        this.isSpeaking = false;

        if (this.maxRecordingTimer) {
            clearTimeout(this.maxRecordingTimer);
            this.maxRecordingTimer = null;
        }

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
            try {
                this.mediaRecorder.stop();
            } catch (e) {}
            this.mediaRecorder = null;
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

        if (globalStore.get(voiceStateAtom) === "listening" || globalStore.get(voiceStateAtom) === "processing") {
            globalStore.set(voiceStateAtom, "idle");
        }
        globalStore.set(interimTranscriptAtom, "");
    }

    private monitorAudioLevel() {
        if (!this.analyser || !this.isRunning) return;

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

        const checkLevel = () => {
            if (!this.isRunning || !this.analyser) return;

            const currentState = globalStore.get(voiceStateAtom);
            if (currentState === "recording" || currentState === "speaking") {
                this.animationFrameId = requestAnimationFrame(checkLevel);
                return;
            }

            this.analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            const normalizedLevel = Math.min(1, Math.max(0, average / 100));
            const now = Date.now();

            if (!this.isSpeaking) {
                if (normalizedLevel > this.SPEECH_START_THRESHOLD) {
                    this.isSpeaking = true;
                    this.speechStartTime = now;
                    this.silenceStartTime = 0;
                    this.startAudioRecording();

                    if (this.maxRecordingTimer) clearTimeout(this.maxRecordingTimer);
                    this.maxRecordingTimer = setTimeout(() => {
                        if (this.isSpeaking) {
                            this.isSpeaking = false;
                            this.finishAndProcessRecording();
                        }
                    }, this.MAX_RECORDING_DURATION_MS);
                }
            } else {
                if (normalizedLevel > this.SPEECH_CONTINUE_THRESHOLD) {
                    this.silenceStartTime = 0;
                } else {
                    if (this.silenceStartTime === 0) {
                        this.silenceStartTime = now;
                    } else if (now - this.silenceStartTime > this.SILENCE_DURATION_MS) {
                        const totalSpeechDuration = now - this.speechStartTime;
                        this.isSpeaking = false;
                        this.silenceStartTime = 0;
                        if (this.maxRecordingTimer) {
                            clearTimeout(this.maxRecordingTimer);
                            this.maxRecordingTimer = null;
                        }

                        if (totalSpeechDuration > 600) {
                            this.finishAndProcessRecording();
                        } else {
                            this.discardCurrentRecording();
                        }
                    }
                }
            }

            this.animationFrameId = requestAnimationFrame(checkLevel);
        };

        this.animationFrameId = requestAnimationFrame(checkLevel);
    }

    private startAudioRecording() {
        if (!this.mediaStream) return;

        try {
            VoiceService.getInstance().stopSpeaking();
            globalStore.set(voiceStateAtom, "listening");
            globalStore.set(interimTranscriptAtom, "Escuchando orden...");

            this.recordedChunks = [];
            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                ? "audio/webm;codecs=opus"
                : MediaRecorder.isTypeSupported("audio/webm")
                ? "audio/webm"
                : "audio/mp4";

            this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };
            this.mediaRecorder.start(100);
        } catch (err) {
            console.error("Error iniciando MediaRecorder en manos libres:", err);
        }
    }

    private async finishAndProcessRecording() {
        if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
            globalStore.set(voiceStateAtom, "idle");
            globalStore.set(interimTranscriptAtom, "");
            return;
        }

        globalStore.set(voiceStateAtom, "processing");
        globalStore.set(interimTranscriptAtom, "Procesando con Google...");

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

            if (this.recordedChunks.length === 0) {
                globalStore.set(voiceStateAtom, "idle");
                globalStore.set(interimTranscriptAtom, "");
                return;
            }

            const audioBlob = new Blob(this.recordedChunks, { type: mime });
            const base64Audio = await this.blobToBase64(audioBlob);
            const googleModel = globalStore.get(googleAudioModelAtom) || "gemini-3.1-flash-lite";

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

            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:generateContent`;
            const payload = {
                contents: [
                    {
                        parts: [
                            {
                                inlineData: {
                                    mimeType: audioBlob.type || "audio/webm",
                                    data: base64Audio,
                                },
                            },
                            {
                                text: "Transcribe this user speech audio verbatim in its original language. Return ONLY the plain transcribed text without quotation marks, markdown formatting, or commentary.",
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
                    let transcript = data.candidates[0].content.parts[0].text.trim();

                    let cleanCommand = transcript;
                    for (const wakeWord of this.WAKE_WORDS) {
                        if (cleanCommand.toLowerCase().startsWith(wakeWord)) {
                            cleanCommand = cleanCommand.substring(wakeWord.length).trim();
                            break;
                        }
                    }

                    const finalCmd = (cleanCommand || transcript).replace(/^[,.:;! ]+/, "").trim();

                    if (finalCmd.length > 2) {
                        this.playWakeSound();
                        globalStore.set(lastQueryWasVoiceAtom, true);
                        globalStore.set(finalTranscriptAtom, finalCmd);
                        globalStore.set(interimTranscriptAtom, "");

                        if (this.onSubmitCommandCallback) {
                            this.onSubmitCommandCallback(finalCmd);
                        }
                        return;
                    }
                }
            }
        } catch (err) {
            console.warn("Error procesando audio de manos libres:", err);
        } finally {
            globalStore.set(interimTranscriptAtom, "");
            globalStore.set(voiceStateAtom, "idle");
        }
    }

    private discardCurrentRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
            try {
                this.mediaRecorder.stop();
            } catch (e) {}
        }
        this.recordedChunks = [];
        globalStore.set(voiceStateAtom, "idle");
        globalStore.set(interimTranscriptAtom, "");
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

    private playWakeSound() {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const now = ctx.currentTime;

            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();

            osc1.type = "sine";
            osc1.frequency.setValueAtTime(523.25, now);
            osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.12);

            osc2.type = "sine";
            osc2.frequency.setValueAtTime(659.25, now);
            osc2.frequency.exponentialRampToValueAtTime(1046.5, now + 0.12);

            gain.gain.setValueAtTime(0.06, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(ctx.destination);

            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 0.2);
            osc2.stop(now + 0.2);

            setTimeout(() => ctx.close(), 350);
        } catch (e) {}
    }
}
