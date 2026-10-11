const { app, BrowserWindow, screen } = require("electron");
const path = require("path");

const MIN_VISIBLE_MS = 4200;
const SHOW_FALLBACK_MS = 450;
const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

let splashWindow = null;
let openedAt = 0;
let visiblePromise = null;
let resolveVisible = null;
let rejectVisible = null;
let finishPromise = null;
let showFallbackTimer = null;

function markVisible() {
    if (!openedAt) openedAt = Date.now();
    if (showFallbackTimer) {
        clearTimeout(showFallbackTimer);
        showFallbackTimer = null;
    }
    resolveVisible?.();
}

function open() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    const { x = 0, y = 0 } = primaryDisplay.workArea || {};

    visiblePromise = new Promise((resolve, reject) => {
        resolveVisible = resolve;
        rejectVisible = reject;
    });

    splashWindow = new BrowserWindow({
        width,
        height,
        x,
        y,
        frame: false,
        transparent: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: true,
        focusable: true,
        fullscreenable: false,
        skipTaskbar: true,
        center: false,
        show: false,
        backgroundColor: "#10141b",
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "splash-preload.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false
        }
    });
    splashWindow.setMenu(null);
    splashWindow.on("close", (event) => {
        if (finishPromise) return;
        event.preventDefault();
        app.quit();
    });
    splashWindow.once("ready-to-show", () => {
        if (!splashWindow || splashWindow.isDestroyed()) return;
        splashWindow.show();
        markVisible();
    });
    splashWindow.webContents.on("render-process-gone", (_event, details) => {
        rejectVisible?.(new Error(`Splash renderer stopped: ${details.reason}`));
    });
    splashWindow.loadFile(path.join(__dirname, "renderer", "splash.html"))
        .catch((error) => rejectVisible?.(error));

    // بعض الأجهزة لا تطلق ready-to-show سريعاً مع المؤثرات البصرية.
    // نُظهر خلفية نافذة البداية بعد وقت قصير بدلاً من تخطيها أو تعليق الإقلاع.
    showFallbackTimer = setTimeout(() => {
        if (!splashWindow || splashWindow.isDestroyed()) return;
        splashWindow.show();
        markVisible();
    }, SHOW_FALLBACK_MS);

    return splashWindow;
}

function waitUntilVisible() {
    if (!visiblePromise) return Promise.reject(new Error("Splash window has not been created"));
    return visiblePromise;
}

function progress(pct, text) {
    if (!splashWindow || splashWindow.isDestroyed()) return;
    splashWindow.webContents.send("startup:progress", { progress: pct, status: text });
}

function finish(mainWindow) {
    if (finishPromise) return finishPromise;
    if (!splashWindow || splashWindow.isDestroyed()) {
        return Promise.reject(new Error("Splash window is not available for the startup transition"));
    }

    finishPromise = (async () => {
        progress(100, "اكتمل التشغيل");
        const remaining = MIN_VISIBLE_MS - (Date.now() - openedAt);
        if (remaining > 0) await sleep(remaining);
        await sleep(450);

        if (!mainWindow || mainWindow.isDestroyed()) {
            throw new Error("Main window is not available for the startup transition");
        }
        const currentSplash = splashWindow;
        mainWindow.setOpacity(0);
        mainWindow.show();
        mainWindow.focus();

        const steps = 30;
        const stepDuration = 25;
        for (let step = 1; step <= steps; step += 1) {
            const progressRatio = step / steps;
            const eased = progressRatio * progressRatio * (3 - 2 * progressRatio);
            mainWindow.setOpacity(eased);
            if (currentSplash && !currentSplash.isDestroyed()) {
                currentSplash.setOpacity(1 - eased);
            }
            await sleep(stepDuration);
        }

        mainWindow.setOpacity(1);
        if (currentSplash && !currentSplash.isDestroyed()) currentSplash.close();
        splashWindow = null;
    })();

    return finishPromise;
}

module.exports = { open, waitUntilVisible, progress, finish };
