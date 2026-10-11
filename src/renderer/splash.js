(() => {
    const stage = document.getElementById("stage");
    const fill = document.getElementById("fill");
    const bar = document.querySelector(".bar");
    const status = document.getElementById("status");
    const startupError = document.getElementById("startupError");
    let lastStatus = status.textContent;

    function setProgress({ progress, status: nextStatus }) {
        const percent = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
        fill.style.width = `${percent}%`;
        bar.setAttribute("aria-valuenow", String(percent));

        if (percent === 100) {
            stage.classList.add("is-ready");
        }

        if (nextStatus && nextStatus !== lastStatus) {
            lastStatus = nextStatus;
            status.classList.add("swap");
            window.setTimeout(() => {
                status.textContent = nextStatus;
                status.classList.remove("swap");
            }, 180);
        }
    }

    function showStartupError() {
        stage.classList.add("has-error");
        startupError.hidden = false;
        status.textContent = "حدث خطأ أثناء تشغيل النظام";
        lastStatus = status.textContent;
    }

    window.elSharqStartup.onProgress(setProgress);
    window.elSharqStartup.onError(showStartupError);
    document.getElementById("retryButton").addEventListener("click", () => window.elSharqStartup.retry());
    document.getElementById("closeButton").addEventListener("click", () => window.elSharqStartup.quit());
    document.getElementById("windowCloseButton").addEventListener("click", () => window.elSharqStartup.quit());

    window.elSharqStartup.ready();
})();
