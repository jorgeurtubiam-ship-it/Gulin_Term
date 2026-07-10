const { Arch } = require("electron-builder");
const pkg = require("./package.json");
const fs = require("fs");
const path = require("path");

const windowsShouldSign = !!process.env.SM_CODE_SIGNING_CERT_SHA1_HASH;

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config = {
    appId: pkg.build.appId,
    productName: pkg.productName,
    executableName: pkg.productName,
    publish: {
        provider: "generic",
        url: "https://www.ecogulin.cl/downloads/"
    },
    directories: {
        output: "make",
    },
    artifactName: "${productName}-${platform}-${arch}-${version}.${ext}",
    generateUpdatesFilesForAllChannels: true,
    npmRebuild: false,
    nodeGypRebuild: false,
    electronCompile: false,
    files: [
        {
            from: "./dist",
            to: "./dist",
            filter: ["main/**/*", "preload/**/*", "frontend/**/*", "schema/**/*"],
        },
        {
            from: ".",
            to: ".",
            filter: ["package.json"],
        },
        "!node_modules", // We don't need electron-builder to package in Node modules as Vite has already bundled any code that our program is using.
    ],
    asarUnpack: [
        "dist/schema/**/*", // schema files for Monaco editor
    ],
    extraResources: [
        {
            from: "dist/tsunamiscaffold",
            to: "tsunamiscaffold",
        },
        {
            from: "dist/bin",
            to: "bin",
            filter: ["gulinsrv*", "wsh*"],
        },
    ],
    mac: {
        target: [
            {
                target: "dmg",
                arch: ["arm64", "x64"],
            },
        ],
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "10.15.0",
        mergeASARs: false,
        singleArchFiles: "**/bin/gulinsrv.*",
        entitlements: "build/entitlements.mac.plist",
        entitlementsInherit: "build/entitlements.mac.plist",
        extendInfo: {
            NSContactsUsageDescription: "A CLI application running in GuLiN wants to use your contacts.",
            NSRemindersUsageDescription: "A CLI application running in GuLiN wants to use your reminders.",
            NSLocationWhenInUseUsageDescription:
                "A CLI application running in GuLiN wants to use your location information while active.",
            NSLocationAlwaysUsageDescription:
                "A CLI application running in GuLiN wants to use your location information, even in the background.",
            NSCameraUsageDescription: "A CLI application running in GuLiN wants to use the camera.",
            NSMicrophoneUsageDescription: "A CLI application running in GuLiN wants to use your microphone.",
            NSCalendarsUsageDescription: "A CLI application running in GuLiN wants to use Calendar data.",
            NSLocationUsageDescription: "A CLI application running in GuLiN wants to use your location information.",
            NSAppleEventsUsageDescription: "A CLI application running in GuLiN wants to use AppleScript.",
        },
    },
    linux: {
        artifactName: "${name}-${platform}-${arch}-${version}.${ext}",
        category: "TerminalEmulator",
        executableName: pkg.name,
        target: ["zip", "deb", "rpm", "snap", "AppImage", "pacman"],
        synopsis: pkg.description,
        description: null,
        desktop: {
            entry: {
                Name: pkg.productName,
                Comment: pkg.description,
                Keywords: "developer;terminal;emulator;",
                Categories: "Development;Utility;",
            },
        },
        executableArgs: ["--enable-features", "UseOzonePlatform", "--ozone-platform-hint", "auto"], // Hint Electron to use Ozone abstraction layer for native Wayland support
    },
    deb: {
        afterInstall: "build/deb-postinstall.tpl",
    },
    win: {
        target: ["nsis", "zip"]
    }
};

module.exports = config;
