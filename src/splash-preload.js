const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("elSharqStartup", {
    ready: () => ipcRenderer.send("startup:splash-ready"),
    retry: () => ipcRenderer.send("startup:retry"),
    quit: () => ipcRenderer.send("startup:quit"),
    showError: () => ipcRenderer.send("startup:show-error"),
    fail: (message) => ipcRenderer.send("startup:failed", String(message || "Startup failed")),
    onProgress: (callback) => {
        if (typeof callback !== "function") throw new TypeError("Progress callback must be a function");
        const listener = (_event, progress) => callback(progress);
        ipcRenderer.on("startup:progress", listener);
        return () => ipcRenderer.removeListener("startup:progress", listener);
    },
    onError: (callback) => {
        if (typeof callback !== "function") throw new TypeError("Error callback must be a function");
        const listener = () => callback();
        ipcRenderer.on("startup:error", listener);
        return () => ipcRenderer.removeListener("startup:error", listener);
    }
});
