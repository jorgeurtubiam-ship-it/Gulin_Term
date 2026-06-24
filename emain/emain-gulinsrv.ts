// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import * as child_process from "node:child_process";
import * as readline from "readline";
import { WebServerEndpointVarName, WSServerEndpointVarName } from "../frontend/util/endpoints";
import { AuthKey, GulinAuthKeyEnv } from "./authkey";
import { setForceQuit, setUserConfirmedQuit } from "./emain-activity";
import {
    getElectronAppResourcesPath,
    getElectronAppUnpackedBasePath,
    getGulinConfigDir,
    getGulinDataDir,
    getGulinSrvCwd,
    getGulinSrvPath,
    getXdgCurrentDesktop,
    GulinConfigHomeVarName,
    GulinDataHomeVarName,
} from "./emain-platform";
import {
    getElectronExecPath,
    GulinAppElectronExecPath,
    GulinAppPathVarName,
    GulinAppResourcesPathVarName,
} from "./emain-util";
import { updater } from "./updater";

let isGulinSrvDead = false;
let gulinSrvProc: child_process.ChildProcessWithoutNullStreams | null = null;
let GulinVersion = "unknown"; // set by GULINSRV-ESTART
let GulinBuildTime = 0; // set by GULINSRV-ESTART

export function getGulinVersion(): { version: string; buildTime: number } {
    return { version: GulinVersion, buildTime: GulinBuildTime };
}

let gulinSrvReadyResolve = (value: boolean) => {};
const gulinSrvReady: Promise<boolean> = new Promise((resolve, _) => {
    gulinSrvReadyResolve = resolve;
});

export function getGulinSrvReady(): Promise<boolean> {
    return gulinSrvReady;
}

export function getGulinSrvProc(): child_process.ChildProcessWithoutNullStreams | null {
    return gulinSrvProc;
}

export function getIsGulinSrvDead(): boolean {
    return isGulinSrvDead;
}

export function runGulinSrv(handleWSEvent: (evtMsg: WSEventType) => void): Promise<boolean> {
    let pResolve: (value: boolean) => void;
    let pReject: (reason?: any) => void;
    const rtnPromise = new Promise<boolean>((argResolve, argReject) => {
        pResolve = argResolve;
        pReject = argReject;
    });
    const envCopy = { ...process.env };
    const xdgCurrentDesktop = getXdgCurrentDesktop();
    if (xdgCurrentDesktop != null) {
        envCopy["XDG_CURRENT_DESKTOP"] = xdgCurrentDesktop;
    }
    envCopy[GulinAppPathVarName] = getElectronAppUnpackedBasePath();
    envCopy[GulinAppResourcesPathVarName] = getElectronAppResourcesPath();
    envCopy[GulinAppElectronExecPath] = getElectronExecPath();
    envCopy[GulinAuthKeyEnv] = AuthKey;
    envCopy[GulinDataHomeVarName] = getGulinDataDir();
    envCopy[GulinConfigHomeVarName] = getGulinConfigDir();
    const gulinSrvCmd = getGulinSrvPath();
    console.log("trying to run local server", gulinSrvCmd);
    const proc = child_process.spawn(getGulinSrvPath(), {
        cwd: getGulinSrvCwd(),
        env: envCopy,
    });
    proc.on("exit", (e) => {
        if (updater?.status == "installing") {
            return;
        }
        console.log("gulinsrv exited, shutting down");
        setForceQuit(true);
        isGulinSrvDead = true;
        electron.app.quit();
    });
    proc.on("spawn", (e) => {
        console.log("spawned gulinsrv");
        gulinSrvProc = proc;
        pResolve(true);
    });
    proc.on("error", (e) => {
        console.log("error running gulinsrv", e);
        pReject(e);
    });
    const rlStdout = readline.createInterface({
        input: proc.stdout,
        terminal: false,
    });
    rlStdout.on("line", (line) => {
        console.log(line);
    });
    const rlStderr = readline.createInterface({
        input: proc.stderr,
        terminal: false,
    });
    rlStderr.on("line", (line) => {
        if (line.includes("GULINSRV-ESTART")) {
            const startParams = /ws:([a-z0-9.:]+) web:([a-z0-9.:]+) version:([a-z0-9.-]+) buildtime:(\d+)/gm.exec(
                line
            );
            if (startParams == null) {
                console.log("error parsing GULINSRV-ESTART line", line);
                setUserConfirmedQuit(true);
                electron.app.quit();
                return;
            }
            process.env[WSServerEndpointVarName] = startParams[1];
            process.env[WebServerEndpointVarName] = startParams[2];
            GulinVersion = startParams[3];
            GulinBuildTime = parseInt(startParams[4]);
            gulinSrvReadyResolve(true);
            return;
        }
        if (line.startsWith("GULINSRV-EVENT:")) {
            const evtJson = line.slice("GULINSRV-EVENT:".length);
            try {
                const evtMsg: WSEventType = JSON.parse(evtJson);
                handleWSEvent(evtMsg);
            } catch (e) {
                console.log("error handling GULINSRV-EVENT", e);
            }
            return;
        }
        console.log(line);
    });
    return rtnPromise;
}
