import { ChatRequestOptions, FileUIPart, UIMessage, UIMessagePart } from "ai";

export interface ChatSummary {
    chatid: string;
    lastupdate: number;
    model: string;
    snippet: string;
    messagecount: number;
}

export interface BrainSummary {
    filename: string;
    title: string;
    lastupdate: number;
    snippet: string;
}

export interface DBConnectionInfo {
    name: string;
    type: string;
    url?: string;
}

type GulinUIDataTypes = {
    // pkg/aiusechat/uctypes/uctypes.go UIMessageDataUserFile
    userfile: {
        filename: string;
        size: number;
        mimetype: string;
        previewurl?: string;
    };
    // pkg/aiusechat/uctypes/uctypes.go UIMessageDataToolUse
    tooluse: {
        toolcallid: string;
        toolname: string;
        tooldesc: string;
        status: "pending" | "error" | "completed";
        runts?: number;
        errormessage?: string;
        approval?: "needs-approval" | "user-approved" | "user-denied" | "auto-approved" | "timeout";
        blockid?: string;
        writebackupfilename?: string;
        inputfilename?: string;
        thought?: string;
    };

    toolprogress: {
        toolcallid: string;
        toolname: string;
        statuslines: string[];
    };
    "data-expert-status": {
        expertid: string;
        status: "running" | "completed";
        task?: string;
    };
    debuglog: {
        category: string;
        message: string;
        ts: number;
    };
};

export type GulinUIMessage = UIMessage<any, GulinUIDataTypes, any>;
export type GulinUIMessagePart = UIMessagePart<GulinUIDataTypes, any>;

export type UseChatSetMessagesType = (
    messages: GulinUIMessage[] | ((messages: GulinUIMessage[]) => GulinUIMessage[])
) => void;

export type UseChatSendMessageType = (
    message?:
        | (Omit<GulinUIMessage, "id" | "role"> & {
            id?: string;
            role?: "system" | "user" | "assistant";
        } & {
            text?: never;
            files?: never;
            messageId?: string;
        })
        | {
            text: string;
            files?: FileList | FileUIPart[];
            metadata?: unknown;
            parts?: never;
            messageId?: string;
        }
        | {
            files: FileList | FileUIPart[];
            metadata?: unknown;
            parts?: never;
            messageId?: string;
        },
    options?: ChatRequestOptions
) => Promise<void>;
