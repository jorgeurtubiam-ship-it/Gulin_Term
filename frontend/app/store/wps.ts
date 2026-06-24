// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { isBlank } from "@/util/util";
import { Subject } from "rxjs";

let WpsRpcClient: WshClient;

function setWpsRpcClient(client: WshClient) {
    WpsRpcClient = client;
}

type GulinEventSubject<T extends GulinEventName = GulinEventName> = {
    handler: (event: Extract<GulinEvent, { event: T }>) => void;
    scope?: string;
};

type GulinEventSubjectContainer = {
    handler: (event: GulinEvent) => void;
    scope?: string;
    id: string;
};

type GulinEventSubscription<T extends GulinEventName = GulinEventName> = GulinEventSubject<T> & {
    eventType: T;
};

type GulinEventUnsubscribe = {
    id: string;
    eventType: string;
};

// key is "eventType" or "eventType|oref"
const fileSubjects = new Map<string, SubjectWithRef<WSFileEventData>>();
const gulinEventSubjects = new Map<string, GulinEventSubjectContainer[]>();

function wpsReconnectHandler() {
    for (const eventType of gulinEventSubjects.keys()) {
        updateGulinEventSub(eventType);
    }
}

function updateGulinEventSub(eventType: string) {
    const subjects = gulinEventSubjects.get(eventType);
    if (subjects == null) {
        RpcApi.EventUnsubCommand(WpsRpcClient, eventType, { noresponse: true });
        return;
    }
    const subreq: SubscriptionRequest = { event: eventType, scopes: [], allscopes: false };
    for (const scont of subjects) {
        if (isBlank(scont.scope)) {
            subreq.allscopes = true;
            subreq.scopes = [];
            break;
        }
        subreq.scopes.push(scont.scope);
    }
    RpcApi.EventSubCommand(WpsRpcClient, subreq, { noresponse: true });
}

function gulinEventSubscribeSingle<T extends GulinEventName>(subscription: GulinEventSubscription<T>): () => void {
    // console.log("gulinEventSubscribeSingle", subscription);
    if (subscription.handler == null) {
        return () => {};
    }
    const id: string = crypto.randomUUID();
    let subjects = gulinEventSubjects.get(subscription.eventType);
    if (subjects == null) {
        subjects = [];
        gulinEventSubjects.set(subscription.eventType, subjects);
    }
    const subcont: GulinEventSubjectContainer = {
        id,
        handler: subscription.handler as (event: GulinEvent) => void,
        scope: subscription.scope,
    };
    subjects.push(subcont);
    updateGulinEventSub(subscription.eventType);
    return () => gulinEventUnsubscribe({ id, eventType: subscription.eventType });
}

function gulinEventUnsubscribe(...unsubscribes: GulinEventUnsubscribe[]) {
    const eventTypeSet = new Set<string>();
    for (const unsubscribe of unsubscribes) {
        let subjects = gulinEventSubjects.get(unsubscribe.eventType);
        if (subjects == null) {
            return;
        }
        const idx = subjects.findIndex((s) => s.id === unsubscribe.id);
        if (idx === -1) {
            return;
        }
        subjects.splice(idx, 1);
        if (subjects.length === 0) {
            gulinEventSubjects.delete(unsubscribe.eventType);
        }
        eventTypeSet.add(unsubscribe.eventType);
    }

    for (const eventType of eventTypeSet) {
        updateGulinEventSub(eventType);
    }
}

function getFileSubject(zoneId: string, fileName: string): SubjectWithRef<WSFileEventData> {
    const subjectKey = zoneId + "|" + fileName;
    let subject = fileSubjects.get(subjectKey);
    if (subject == null) {
        subject = new Subject<any>() as any;
        subject.refCount = 0;
        subject.release = () => {
            subject.refCount--;
            if (subject.refCount === 0) {
                subject.complete();
                fileSubjects.delete(subjectKey);
            }
        };
        fileSubjects.set(subjectKey, subject);
    }
    subject.refCount++;
    return subject;
}

function handleGulinEvent(event: GulinEvent) {
    // console.log("handleGulinEvent", event);
    const subjects = gulinEventSubjects.get(event.event);
    if (subjects == null) {
        return;
    }
    for (const scont of subjects) {
        if (isBlank(scont.scope)) {
            scont.handler(event);
            continue;
        }
        if (event.scopes == null) {
            continue;
        }
        if (event.scopes.includes(scont.scope)) {
            scont.handler(event);
        }
    }
}

export {
    getFileSubject,
    handleGulinEvent,
    setWpsRpcClient,
    gulinEventSubscribeSingle,
    gulinEventUnsubscribe,
    wpsReconnectHandler,
};
