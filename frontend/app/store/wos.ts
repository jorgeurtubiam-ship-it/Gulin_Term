// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// GulinObjectStore

import { gulinEventSubscribeSingle } from "@/app/store/wps";
import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { fireAndForget } from "@/util/util";
import { atom, Atom, Getter, PrimitiveAtom, Setter, useAtomValue } from "jotai";
import { useEffect } from "react";
import { globalStore } from "./jotaiStore";
import { ObjectService } from "./services";

type GulinObjectDataItemType<T extends GulinObj> = {
    value: T;
    loading: boolean;
};

type GulinObjectValue<T extends GulinObj> = {
    pendingPromise: Promise<T>;
    dataAtom: PrimitiveAtom<GulinObjectDataItemType<T>>;
    refCount: number;
    holdTime: number;
};

function splitORef(oref: string): [string, string] {
    const parts = oref.split(":");
    if (parts.length != 2) {
        throw new Error("invalid oref");
    }
    return [parts[0], parts[1]];
}

function isBlank(str: string): boolean {
    return str == null || str == "";
}

function isBlankNum(num: number): boolean {
    return num == null || isNaN(num) || num == 0;
}

function isValidGulinObj(val: GulinObj): boolean {
    if (val == null) {
        return false;
    }
    if (isBlank(val.otype) || isBlank(val.oid) || isBlankNum(val.version)) {
        return false;
    }
    return true;
}

function makeORef(otype: string, oid: string): string {
    if (isBlank(otype) || isBlank(oid)) {
        return null;
    }
    return `${otype}:${oid}`;
}

function GetObject<T>(oref: string): Promise<T> {
    return callBackendService("object", "GetObject", [oref], true);
}

function debugLogBackendCall(methodName: string, durationStr: string, args: any[]) {
    durationStr = "| " + durationStr;
    if (methodName == "object.UpdateObject" && args.length > 0) {
        console.log("[service] object.UpdateObject", args[0].otype, args[0].oid, durationStr, args[0]);
        return;
    }
    if (methodName == "object.GetObject" && args.length > 0) {
        console.log("[service] object.GetObject", args[0], durationStr);
        return;
    }
    if (methodName == "file.StatFile" && args.length >= 2) {
        console.log("[service] file.StatFile", args[1], durationStr);
        return;
    }
    console.log("[service]", methodName, durationStr);
}

function wpsSubscribeToObject(oref: string): () => void {
    return gulinEventSubscribeSingle({
        eventType: "gulinobj:update",
        scope: oref,
        handler: (event) => {
            updateGulinObject(event.data);
        },
    });
}

function callBackendService(service: string, method: string, args: any[], noUIContext?: boolean): Promise<any> {
    const startTs = Date.now();
    let uiContext: UIContext = null;
    if (!noUIContext && globalThis.window != null) {
        uiContext = globalStore.get(((window as any).globalAtoms as GlobalAtomsType).uiContext);
    }
    const gulinCall: WebCallType = {
        service: service,
        method: method,
        args: args,
        uicontext: uiContext,
    };
    // usp is just for debugging (easier to filter URLs)
    const methodName = `${service}.${method}`;
    const usp = new URLSearchParams();
    usp.set("service", service);
    usp.set("method", method);
    const url = getWebServerEndpoint() + "/gulin/service?" + usp.toString();
    const fetchPromise = fetch(url, {
        method: "POST",
        body: JSON.stringify(gulinCall),
    });
    const prtn = fetchPromise
        .then((resp) => {
            if (!resp.ok) {
                throw new Error(`call ${methodName} failed: ${resp.status} ${resp.statusText}`);
            }
            return resp.json();
        })
        .then((respData: WebReturnType) => {
            if (respData == null) {
                return null;
            }
            if (respData.updates != null) {
                updateGulinObjects(respData.updates);
            }
            if (respData.error != null) {
                throw new Error(`call ${methodName} error: ${respData.error}`);
            }
            const durationStr = Date.now() - startTs + "ms";
            debugLogBackendCall(methodName, durationStr, args);
            return respData.data;
        });
    return prtn;
}

const gulinObjectValueCache = new Map<string, GulinObjectValue<any>>();

function clearGulinObjectCache() {
    gulinObjectValueCache.clear();
}

const defaultHoldTime = 5000; // 5-seconds

function reloadGulinObject<T extends GulinObj>(oref: string): Promise<T> {
    let wov = gulinObjectValueCache.get(oref);
    if (wov === undefined) {
        wov = getGulinObjectValue<T>(oref, true);
        return wov.pendingPromise;
    }
    const prtn = GetObject<T>(oref);
    prtn.then((val) => {
        globalStore.set(wov.dataAtom, { value: val, loading: false });
    });
    return prtn;
}

function createGulinValueObject<T extends GulinObj>(oref: string, shouldFetch: boolean): GulinObjectValue<T> {
    const wov = { pendingPromise: null, dataAtom: null, refCount: 0, holdTime: Date.now() + 5000 };
    wov.dataAtom = atom({ value: null, loading: true });
    if (!shouldFetch) {
        return wov;
    }
    const startTs = Date.now();
    const localPromise = GetObject<T>(oref);
    wov.pendingPromise = localPromise;
    localPromise.then((val) => {
        if (wov.pendingPromise != localPromise) {
            return;
        }
        const [otype, oid] = splitORef(oref);
        if (val != null) {
            if (val["otype"] != otype) {
                throw new Error("GetObject returned wrong type");
            }
            if (val["oid"] != oid) {
                throw new Error("GetObject returned wrong id");
            }
        }
        wov.pendingPromise = null;
        globalStore.set(wov.dataAtom, { value: val, loading: false });
        console.log("GulinObj resolved", oref, Date.now() - startTs + "ms");
    });
    return wov;
}

function getGulinObjectValue<T extends GulinObj>(oref: string, createIfMissing = true): GulinObjectValue<T> {
    let wov = gulinObjectValueCache.get(oref);
    if (wov === undefined && createIfMissing) {
        wov = createGulinValueObject(oref, true);
        gulinObjectValueCache.set(oref, wov);
    }
    return wov;
}

function loadAndPinGulinObject<T extends GulinObj>(oref: string): Promise<T> {
    const wov = getGulinObjectValue<T>(oref);
    wov.refCount++;
    if (wov.pendingPromise == null) {
        const dataValue = globalStore.get(wov.dataAtom);
        return Promise.resolve(dataValue.value);
    }
    return wov.pendingPromise;
}

function getGulinObjectAtom<T extends GulinObj>(oref: string): WritableGulinObjectAtom<T> {
    const wov = getGulinObjectValue<T>(oref);
    return atom(
        (get) => get(wov.dataAtom).value,
        (_get, set, value: T) => {
            setObjectValue(value, set, true);
        }
    );
}

function getGulinObjectLoadingAtom(oref: string): Atom<boolean> {
    const wov = getGulinObjectValue(oref);
    return atom((get) => {
        const dataValue = get(wov.dataAtom);
        if (dataValue.loading) {
            return null;
        }
        return dataValue.loading;
    });
}

function useGulinObjectValue<T extends GulinObj>(oref: string): [T, boolean] {
    const wov = getGulinObjectValue<T>(oref);
    useEffect(() => {
        wov.refCount++;
        return () => {
            wov.refCount--;
        };
    }, [oref]);
    const atomVal = useAtomValue(wov.dataAtom);
    return [atomVal.value, atomVal.loading];
}

function updateGulinObject(update: GulinObjUpdate) {
    if (update == null) {
        return;
    }
    const oref = makeORef(update.otype, update.oid);
    const wov = getGulinObjectValue(oref);
    if (update.updatetype == "delete") {
        console.log("GulinObj deleted", oref);
        globalStore.set(wov.dataAtom, { value: null, loading: false });
    } else {
        if (!isValidGulinObj(update.obj)) {
            console.log("invalid gulin object update", update);
            return;
        }
        const curValue: GulinObjectDataItemType<GulinObj> = globalStore.get(wov.dataAtom);
        if (curValue.value != null && curValue.value.version >= update.obj.version) {
            return;
        }
        console.log("GulinObj updated", oref);
        globalStore.set(wov.dataAtom, { value: update.obj, loading: false });
    }
    wov.holdTime = Date.now() + defaultHoldTime;
    return;
}

function updateGulinObjects(vals: GulinObjUpdate[]) {
    for (const val of vals) {
        updateGulinObject(val);
    }
}

function cleanGulinObjectCache() {
    const now = Date.now();
    for (const [oref, wov] of gulinObjectValueCache) {
        if (wov.refCount == 0 && wov.holdTime < now) {
            gulinObjectValueCache.delete(oref);
        }
    }
}

// gets the value of a GulinObject from the cache.
// should provide getFn if it is available (e.g. inside of a jotai atom)
// otherwise it will use the globalStore.get function
function getObjectValue<T extends GulinObj>(oref: string, getFn?: Getter): T {
    const wov = getGulinObjectValue<T>(oref);
    if (getFn == null) {
        getFn = globalStore.get;
    }
    const atomVal = getFn(wov.dataAtom);
    return atomVal.value;
}

// sets the value of a GulinObject in the cache.
// should provide setFn if it is available (e.g. inside of a jotai atom)
// otherwise it will use the globalStore.set function
function setObjectValue<T extends GulinObj>(value: T, setFn?: Setter, pushToServer?: boolean) {
    const oref = makeORef(value.otype, value.oid);
    const wov = getGulinObjectValue(oref, false);
    if (wov === undefined) {
        return;
    }
    if (setFn === undefined) {
        setFn = globalStore.set;
    }
    setFn(wov.dataAtom, { value: value, loading: false });
    if (pushToServer) {
        fireAndForget(() => ObjectService.UpdateObject(value, false));
    }
}

export {
    callBackendService,
    cleanGulinObjectCache,
    clearGulinObjectCache,
    getObjectValue,
    getGulinObjectAtom,
    getGulinObjectLoadingAtom,
    loadAndPinGulinObject,
    makeORef,
    reloadGulinObject,
    setObjectValue,
    splitORef,
    updateGulinObject,
    updateGulinObjects,
    useGulinObjectValue,
    wpsSubscribeToObject,
};
