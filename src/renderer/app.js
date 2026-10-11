const menuItems = document.querySelectorAll(".menu-item");

if (!window.elSharq) {
    window.elSharqStartup?.failed("تعذر الاتصال بقاعدة بيانات النظام");
    document.body.innerHTML = '<main style="padding:32px;font:16px Segoe UI,Tahoma,sans-serif;color:#fff;background:#091017">تعذر الاتصال بقاعدة بيانات النظام. أغلق التطبيق وافتحه مجددًا، وإذا استمرت المشكلة تواصل مع الدعم.</main>';
    throw new Error("قاعدة بيانات الشرق غير متاحة؛ تم إيقاف تشغيل الواجهة التجريبية.");
}

function requestDeletionPassword() {
    return new Promise((resolve) => {
        const dialog = document.createElement("dialog");
        dialog.style.cssText = "border:0;border-radius:12px;padding:24px;max-width:420px;width:calc(100% - 40px);background:#17212b;color:#f3f6f9;box-shadow:0 20px 60px #0009";
        const form = document.createElement("form");
        form.method = "dialog";
        form.innerHTML = `
            <h3 style="margin:0 0 8px">تأكيد الحذف</h3>
            <p style="margin:0 0 16px;color:#aebbc8">أدخل كلمة مرور الحذف للمتابعة.</p>
            <input type="password" autocomplete="current-password" required aria-label="كلمة مرور الحذف"
                style="box-sizing:border-box;width:100%;padding:12px;border-radius:8px;border:1px solid #405160;background:#0d151c;color:#fff">
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
                <button type="button" value="cancel">إلغاء</button>
                <button type="submit" value="confirm">متابعة الحذف</button>
            </div>
        `;
        dialog.append(form);
        document.body.append(dialog);
        const input = form.querySelector("input");
        form.querySelector('[type="button"]').addEventListener("click", () => dialog.close("cancel"));
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            dialog.close("confirm");
        });
        dialog.addEventListener("close", () => {
            const password = dialog.returnValue === "confirm" ? input.value : null;
            dialog.remove();
            resolve(password);
        }, { once: true });
        dialog.showModal();
        input.focus();
    });
}
window.requestDeletionPassword = requestDeletionPassword;
window.editProductFromStock = (id) => showAddProductModal(Number(id), null, "stock");

setupInterfaceMotion();
updateCurrentDate();
showDashboard();
document.getElementById("lowStockButton")?.addEventListener("click", openLowStockNotificationsModal);

async function openLowStockNotificationsModal() {
    const existingModal = document.querySelector(".low-stock-notification-modal");
    if (existingModal) existingModal.remove();

    let stock = [];
    try {
        stock = await window.elSharq.getStockOverview();
    } catch (e) {
        console.error("تعذر تحميل تنبيهات المخزون:", e);
    }

    const lowStock = Array.isArray(stock)
        ? stock.filter((product) => Number(product.total_quantity) <= Number(product.min_stock))
        : [];

    const modal = document.createElement("div");
    modal.className = "low-stock-notification-modal";
    modal.innerHTML = `
        <div class="low-stock-modal-overlay"></div>
        <div class="low-stock-modal-box" role="dialog" aria-modal="true" aria-label="تنبيهات المخزون">
            <div class="low-stock-modal-header">
                <div>
                    <span class="low-stock-modal-eyebrow">🔔 تنبيهات النظام</span>
                    <h2>منتجات تحت الحد الأدنى</h2>
                    <p class="low-stock-modal-sub">
                        ${lowStock.length
                            ? `يوجد ${lowStock.length} منتج يجب تجديد مخزونه قريبًا`
                            : "الحمد لله، لا توجد منتجات تحت الحد الأدنى حاليًا"}
                    </p>
                </div>
                <button class="low-stock-modal-close" type="button" aria-label="إغلاق">✕</button>
            </div>
            <div class="low-stock-modal-body">
                ${lowStock.length
                    ? `<div class="low-stock-table-wrap">
                         <table class="last-invoices-table products-table low-stock-table">
                            <thead>
                                <tr>
                                    <th>المنتج</th>
                                    <th>القسم</th>
                                    <th>المتاح حالياً</th>
                                    <th>الحد الأدنى</th>
                                    <th>الحالة</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${lowStock.map((product) => {
                                    const qty = Number(product.total_quantity || 0);
                                    const min = Number(product.min_stock || 0);
                                    const pct = min > 0 ? Math.round((qty / Math.max(min, 1)) * 100) : 0;
                                    const isCritical = qty <= Math.max(1, Math.floor(min * 0.5));
                                    const statusClass = isCritical ? "status inactive" : "status active";
                                    const statusText = isCritical ? "حرج — تحت النصف" : "منخفض";
                                    return `
                                        <tr>
                                            <td><strong>${escapeHtml(product.name)}</strong></td>
                                            <td>${escapeHtml(product.category_name || "—")}</td>
                                            <td><strong style="color:${isCritical ? 'var(--danger)' : 'var(--warning)'}">${formatMoney(qty)}</strong></td>
                                            <td>${formatMoney(min)}</td>
                                            <td><span class="${statusClass}">${statusText}</span></td>
                                        </tr>
                                    `;
                                }).join("")}
                            </tbody>
                         </table>
                       </div>`
                    : `<div class="low-stock-empty">
                         <div class="low-stock-empty-icon">✓</div>
                         <strong>المخزون في أمان</strong>
                         <span>كل المنتجات في مستوى مقبول، لا يوجد طلبات تجديد حاليًا</span>
                       </div>`
                }
            </div>
            <div class="low-stock-modal-footer">
                <button type="button" class="secondary-button low-stock-close-btn">إغلاق</button>
                ${lowStock.length
                    ? `<button type="button" class="primary-button low-stock-goto-btn">فتح صفحة المخزن للمراجعة</button>`
                    : ""}
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.querySelector(".low-stock-modal-overlay").addEventListener("click", () => modal.remove());
    modal.querySelector(".low-stock-modal-close").addEventListener("click", () => modal.remove());
    modal.querySelectorAll(".low-stock-close-btn").forEach((b) =>
        b.addEventListener("click", () => modal.remove())
    );
    const goBtn = modal.querySelector(".low-stock-goto-btn");
    if (goBtn) {
        goBtn.addEventListener("click", () => {
            modal.remove();
            const navStock = document.querySelector('[data-nav="stock"]');
            if (navStock) navStock.click();
        });
    }
    document.addEventListener("keydown", function escHandler(e) {
        if (e.key === "Escape") {
            modal.remove();
            document.removeEventListener("keydown", escHandler);
        }
    });
}

function updateCurrentDate() {
    const dateEl = document.getElementById("currentDate");
    if (!dateEl) return;
    const now = new Date();
    const arMonths = [
        "يناير",
        "فبراير",
        "مارس",
        "أبريل",
        "مايو",
        "يونيو",
        "يوليو",
        "أغسطس",
        "سبتمبر",
        "أكتوبر",
        "نوفمبر",
        "ديسمبر"
    ];
    dateEl.textContent = `${now.getDate()} ${arMonths[now.getMonth()]} ${now.getFullYear()}`;
}

function getLocalDateString(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

menuItems.forEach((item) => {
    item.addEventListener("click", async () => {
        const menuText =
            item.querySelector("span:last-child")?.textContent.trim() || "";
        const dataNav = item.getAttribute("data-nav") || "";

        menuItems.forEach((menu) => menu.classList.remove("active"));
        item.classList.add("active");

        const topTitle = document.querySelector(".topbar-title h2");
        const topDesc = document.querySelector(".topbar-title p");
        const topEyebrow = document.querySelector(".topbar-title .eyebrow");

        switch (dataNav || menuText) {
            case "dashboard":
            case "الرئيسية":
                if (topTitle) topTitle.textContent = "الرئيسية";
                if (topEyebrow) topEyebrow.textContent = "نظام إدارة";
                if (topDesc) topDesc.textContent = "مرحبًا بك في نظام إدارة الشرق";
                showDashboard();
                break;

            case "products":
            case "المنتجات":
                if (topTitle) topTitle.textContent = "المنتجات";
                if (topEyebrow) topEyebrow.textContent = "إدارة المخزون";
                if (topDesc) topDesc.textContent = "إدارة الأصناف والأسعار";
                await showProductsPage();
                break;

            case "sales":
            case "المبيعات":
                if (topTitle) topTitle.textContent = "المبيعات";
                if (topEyebrow) topEyebrow.textContent = "إدارة الفواتير";
                if (topDesc) topDesc.textContent = "إنشاء وإدارة فواتير البيع";
                await showSalesPage();
                break;

            case "plumbing-orders":
            case "طلبية السباكة":
            case "طلبات السباكة":
                if (topTitle) topTitle.textContent = "طلبات السباكة";
                if (topEyebrow) topEyebrow.textContent = "طلبيات التجار";
                if (topDesc) topDesc.textContent = "طلبات السباكة المخصصة للتجار";
                await showPlumbingOrderPage();
                break;

            case "purchases":
            case "المشتريات":
                if (topTitle) topTitle.textContent = "المشتريات";
                if (topEyebrow) topEyebrow.textContent = "فواتير الموردين";
                if (topDesc) topDesc.textContent = "إدارة فواتير الشراء والمشتريات";
                await window.elSharqPages.show("purchases");
                break;

            case "stock":
            case "المخزن":
                if (topTitle) topTitle.textContent = "المخزن";
                if (topEyebrow) topEyebrow.textContent = "إدارة المخزون";
                if (topDesc) topDesc.textContent = "إدارة المخزون والمعرض والمخزن";
                await window.elSharqPages.show("stock");
                break;

            case "customers":
            case "العملاء":
                if (topTitle) topTitle.textContent = "العملاء";
                if (topEyebrow) topEyebrow.textContent = "الحسابات";
                if (topDesc) topDesc.textContent = "إدارة العملاء وحساباتهم";
                await window.elSharqPages.show("customers");
                break;

            case "suppliers":
            case "الموردين":
                if (topTitle) topTitle.textContent = "الموردين";
                if (topEyebrow) topEyebrow.textContent = "الحسابات";
                if (topDesc) topDesc.textContent = "إدارة الموردين وحساباتهم";
                await window.elSharqPages.show("suppliers");
                break;

            case "cashier":
            case "الخزنة":
                if (topTitle) topTitle.textContent = "الخزنة";
                if (topEyebrow) topEyebrow.textContent = "الحسابات النقدية";
                if (topDesc) topDesc.textContent = "إدارة حركة الأموال والخزنة";
                await window.elSharqPages.show("cashier");
                break;

            case "reports":
            case "التقارير":
                if (topTitle) topTitle.textContent = "التقارير";
                if (topEyebrow) topEyebrow.textContent = "تقارير النظام";
                if (topDesc) topDesc.textContent = "تقارير المبيعات والمشتريات والأرباح";
                await window.elSharqPages.show("reports");
                break;

            case "settings":
            case "الإعدادات":
                if (topTitle) topTitle.textContent = "الإعدادات";
                if (topEyebrow) topEyebrow.textContent = "بيانات المنشأة";
                if (topDesc) topDesc.textContent = "بيانات المنشأة والنسخ الاحتياطي";
                await window.elSharqPages.show("settings");
                break;

            default:
                console.log("Unknown menu:", dataNav, menuText);
        }
    });
});

function getDashboard() {
    return document.querySelector(".dashboard") || document.querySelector("main .dashboard");
}

function setupInterfaceMotion() {
    const dashboard = getDashboard();
    if (dashboard) {
        let revealFrame = null;
        const reveal = () => {
            if (revealFrame) window.cancelAnimationFrame(revealFrame);
            dashboard.classList.remove("page-reveal");
            revealFrame = window.requestAnimationFrame(() => {
                dashboard.classList.add("page-reveal");
            });
        };
        new MutationObserver(reveal).observe(dashboard, { childList: true });
        reveal();
    }

    const finePointer = window.matchMedia?.("(pointer: fine)").matches;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!finePointer || reduceMotion) return;

    const halo = document.createElement("div");
    halo.className = "pointer-halo";
    halo.setAttribute("aria-hidden", "true");
    const dot = document.createElement("div");
    dot.className = "pointer-dot";
    dot.setAttribute("aria-hidden", "true");
    document.body.append(halo, dot);

    let targetX = -100;
    let targetY = -100;
    let currentX = -100;
    let currentY = -100;
    let pointerFrame = null;

    const followPointer = () => {
        currentX += (targetX - currentX) * 0.2;
        currentY += (targetY - currentY) * 0.2;
        halo.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%)`;
        pointerFrame = window.requestAnimationFrame(followPointer);
    };

    document.addEventListener("pointermove", (event) => {
        targetX = event.clientX;
        targetY = event.clientY;
        dot.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, -50%)`;
        halo.classList.add("is-visible");
        dot.classList.add("is-visible");
        halo.classList.toggle(
            "is-action",
            Boolean(event.target.closest("button, a, input, select, textarea, [role='button'], .menu-item"))
        );
        if (!pointerFrame) followPointer();
    }, { passive: true });

    window.addEventListener("blur", () => {
        halo.classList.remove("is-visible");
        dot.classList.remove("is-visible");
    });
    document.addEventListener("pointerdown", () => halo.classList.add("is-pressed"));
    document.addEventListener("pointerup", () => halo.classList.remove("is-pressed"));
}

async function showDashboard() {
    const dashboard = getDashboard();
    if (!dashboard) return;

    dashboard.innerHTML = `
        <div class="welcome-card">
            <div>
                <span class="small-label">لوحة متابعة الشرق</span>
                <h3>نظرة واضحة على مبيعاتك اليومية</h3>
                <p>أرقام فعلية من فواتير البيع المسجلة، تتحدث عند فتح الرئيسية.</p>
            </div>
            <div class="welcome-icon" aria-hidden="true">ش</div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon sales">م</div>
                <div>
                    <span>مبيعات اليوم</span>
                    <strong id="dashboardSales">جارٍ التحميل...</strong>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon invoices">ف</div>
                <div>
                    <span>فواتير اليوم</span>
                    <strong id="dashboardInvoices">جارٍ التحميل...</strong>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon profit">ر</div>
                <div>
                    <span>ربح اليوم</span>
                    <strong id="dashboardProfit">جارٍ التحميل...</strong>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon cash">خ</div>
                <div>
                    <span>رصيد الخزنة</span>
                    <strong id="dashboardCash">جارٍ التحميل...</strong>
                </div>
            </div>
        </div>

        <section class="sales-analytics-panel" aria-labelledby="salesAnalyticsTitle">
            <div class="sales-analytics-heading">
                <div>
                    <span class="analytics-eyebrow">تحليل المبيعات</span>
                    <h3 id="salesAnalyticsTitle">حركة آخر 7 أيام</h3>
                    <p>الإجمالي اليومي للفواتير المكتملة من قاعدة بيانات الشرق</p>
                </div>
                <div class="sales-trend" id="salesTrend" aria-live="polite">
                    <span class="trend-label">مقارنة بأمس</span>
                    <strong id="salesTrendValue">جارٍ التحميل...</strong>
                </div>
            </div>
            <div class="sales-chart-summary">
                <span>إجمالي مبيعات الأسبوع</span>
                <strong id="salesChartWeek">جارٍ التحميل...</strong>
            </div>
            <div class="sales-chart" id="salesTrendChart" role="img" aria-label="رسم المبيعات لآخر سبعة أيام">
                <div class="chart-loading" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
            </div>
            <div class="sales-chart-days" id="salesChartDays"></div>
        </section>

        <div class="section-header">
            <div>
                <h3>العمليات السريعة</h3>
                <span>اختصارات للعمليات اليومية</span>
            </div>
        </div>

        <div class="quick-grid">
            <button class="quick-card" id="quickNewSale">
                <div>＋</div>
                <strong>فاتورة بيع</strong>
                <span>إنشاء فاتورة جديدة</span>
            </button>
            <button class="quick-card" id="quickNewPlumbing">
                <div>🔧</div>
                <strong>طلبية سباكة</strong>
                <span>طلبية تاجر جديدة</span>
            </button>
            <button class="quick-card" id="quickAddProduct">
                <div>▣</div>
                <strong>إضافة منتج</strong>
                <span>إضافة صنف للمخزون</span>
            </button>
            <button class="quick-card" id="quickStockTransfer">
                <div>↔</div>
                <strong>تحويل مخزون</strong>
                <span>المعرض ↔ المخزن</span>
            </button>
        </div>

        <div class="bottom-grid">
            <div class="panel">
                <div class="panel-header">
                    <div>
                        <h3>أحدث فواتير البيع</h3>
                        <span>آخر الفواتير المسجلة في النظام</span>
                    </div>
                    <button id="dashboardAllSales" type="button">فتح المبيعات</button>
                </div>
                <div class="empty-state">
                    <div>▤</div>
                    <strong>جارٍ تحميل الفواتير</strong>
                    <span>سيتم عرض أحدث الفواتير المسجلة هنا</span>
                </div>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <div>
                        <h3>تنبيهات المخزون</h3>
                        <span>الأصناف التي تحتاج متابعة</span>
                    </div>
                </div>
                <div class="empty-state">
                    <div>✓</div>
                    <strong>لا توجد تنبيهات</strong>
                    <span>المخزون يعمل بشكل طبيعي</span>
                </div>
            </div>
        </div>
    `;

    document.getElementById("quickNewSale")?.addEventListener("click", () => {
        const sales = document.querySelector('[data-nav="sales"]');
        sales?.click();
    });
    document.getElementById("quickNewPlumbing")?.addEventListener("click", () => {
        const po = document.querySelector('[data-nav="plumbing-orders"]');
        po?.click();
    });
    document.getElementById("quickAddProduct")?.addEventListener("click", async () => {
        await showAddProductModal();
    });
    document.getElementById("quickStockTransfer")?.addEventListener("click", () => {
        document.querySelector('[data-nav="stock"]')?.click();
    });
    document.getElementById("dashboardAllSales")?.addEventListener("click", () => {
        document.querySelector('[data-nav="sales"]')?.click();
    });

    try {
        const dates = Array.from({ length: 7 }, (_, index) => {
            const date = new Date();
            date.setHours(12, 0, 0, 0);
            date.setDate(date.getDate() - (6 - index));
            return date;
        });
        const dailyReportsPromise = Promise.all(
            dates.map((date) => {
                const day = getLocalDateString(date);
                return window.elSharq.getReportSummary({ from: day, to: day });
            })
        );
        const [dailyReports, cashAccounts, sales, stock] = await Promise.all([
            dailyReportsPromise,
            window.elSharq.getCashSummary(),
            window.elSharq.getSales("all"),
            window.elSharq.getStockOverview()
        ]);
        const todaySummary = dailyReports[dailyReports.length - 1].sales;
        const previousSummary = dailyReports[dailyReports.length - 2].sales;
        const todaySales = Number(todaySummary.total || 0);
        const previousSales = Number(previousSummary.total || 0);
        const todayProfit = Number(todaySummary.profit || 0);
        const todayInvoiceCount = Number(todaySummary.count || 0);
        const dailySales = dailyReports.map((report, index) => ({
            date: dates[index],
            total: Number(report.sales.total || 0),
            count: Number(report.sales.count || 0)
        }));
        const weekSales = dailySales.reduce((total, day) => total + day.total, 0);

        document.getElementById("dashboardSales").textContent = `${formatMoney(todaySales)} ج.م`;
        document.getElementById("dashboardInvoices").textContent = todayInvoiceCount.toLocaleString("ar-EG");
        document.getElementById("dashboardProfit").textContent = `${formatMoney(todayProfit)} ج.م`;
        document.getElementById("dashboardCash").textContent = `${formatMoney(cashAccounts.reduce((sum, account) => sum + Number(account.balance || 0), 0))} ج.م`;
        document.getElementById("salesChartWeek").textContent = `${formatMoney(weekSales)} ج.م`;

        const salesTrend = document.getElementById("salesTrend");
        const salesTrendValue = document.getElementById("salesTrendValue");
        if (previousSales > 0) {
            const change = ((todaySales - previousSales) / previousSales) * 100;
            const direction = change > 0 ? "up" : change < 0 ? "down" : "steady";
            salesTrend.classList.add(direction);
            salesTrendValue.textContent = change === 0
                ? "ثابتة عن أمس"
                : `${change > 0 ? "زيادة" : "انخفاض"} ${Math.abs(change).toLocaleString("ar-EG", { maximumFractionDigits: 1 })}% عن أمس`;
        } else if (todaySales > 0) {
            salesTrend.classList.add("up");
            salesTrendValue.textContent = "مبيعات جديدة اليوم";
        } else {
            salesTrend.classList.add("steady");
            salesTrendValue.textContent = "لا توجد مبيعات أمس أو اليوم";
        }

        const chartWidth = 720;
        const chartHeight = 210;
        const chartLeft = 30;
        const chartRight = chartWidth - 30;
        const chartTop = 20;
        const chartBottom = chartHeight - 22;
        const maxSales = Math.max(...dailySales.map((day) => day.total), 1);
        const points = dailySales.map((day, index) => ({
            ...day,
            x: chartLeft + (index * (chartRight - chartLeft)) / (dailySales.length - 1),
            y: chartBottom - (day.total / maxSales) * (chartBottom - chartTop)
        }));
        const linePath = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
        const areaPath = `${linePath} L ${chartRight} ${chartBottom} L ${chartLeft} ${chartBottom} Z`;
        document.getElementById("salesTrendChart").innerHTML = `
            <svg viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                    <linearGradient id="salesAreaGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0" stop-color="#54e3bd" stop-opacity=".3"/>
                        <stop offset="1" stop-color="#54e3bd" stop-opacity=".015"/>
                    </linearGradient>
                </defs>
                <path class="chart-gridline" d="M ${chartLeft} ${chartTop} H ${chartRight} M ${chartLeft} ${(chartTop + chartBottom) / 2} H ${chartRight} M ${chartLeft} ${chartBottom} H ${chartRight}"/>
                <path class="chart-area" d="${areaPath}"/>
                <path class="chart-line" d="${linePath}"/>
                ${points.map((point) => `
                    <circle class="chart-point" cx="${point.x}" cy="${point.y}" r="4">
                        <title>${point.date.toLocaleDateString("ar-EG", { weekday: "long" })}: ${formatMoney(point.total)} ج.م، ${point.count} فاتورة</title>
                    </circle>
                `).join("")}
            </svg>
        `;
        document.getElementById("salesChartDays").innerHTML = dailySales.map((day) => `
            <div class="sales-chart-day" title="${formatMoney(day.total)} ج.م - ${day.count} فاتورة">
                <span>${day.date.toLocaleDateString("ar-EG", { weekday: "short" })}</span>
                <strong>${formatMoney(day.total)}</strong>
            </div>
        `).join("");

        const latest = sales.slice(0, 5);
        const salesPanel = document.querySelector(".bottom-grid .panel:first-child .empty-state");
        if (salesPanel) {
            salesPanel.outerHTML = latest.length
                ? `<div class="last-invoices-table-wrapper"><table class="last-invoices-table"><thead><tr><th>الفاتورة</th><th>العميل</th><th>الإجمالي</th><th>التاريخ</th></tr></thead><tbody>${latest.map((sale) => `<tr><td>${escapeHtml(sale.invoice_number || sale.id)}</td><td>${escapeHtml(sale.customer_name || "عميل نقدي")}</td><td>${formatMoney(sale.total)} ج.م</td><td>${sale.created_at ? new Date(sale.created_at).toLocaleDateString("ar-EG") : "-"}</td></tr>`).join("")}</tbody></table></div>`
                : `<div class="empty-state"><div>▤</div><strong>لا توجد مبيعات حتى الآن</strong><span>ستظهر آخر الفواتير هنا</span></div>`;
        }

        const totalStockValue = Number(dailyReports[dailyReports.length - 1].stockValue || 0);
        const stockHeader = document.querySelector(".bottom-grid .panel:last-child .panel-header span");
        if (stockHeader) stockHeader.textContent = `قيمة المخزون: ${formatMoney(totalStockValue)} ج.م`;
        const lowStock = stock.filter((product) => Number(product.total_quantity) <= Number(product.min_stock));
        const stockPanel = document.querySelector(".bottom-grid .panel:last-child .empty-state");
        if (stockPanel) {
            stockPanel.outerHTML = lowStock.length
                ? `<div class="last-invoices-table-wrapper"><table class="last-invoices-table"><thead><tr><th>المنتج</th><th>المتاح</th><th>الحد الأدنى</th></tr></thead><tbody>${lowStock.slice(0, 8).map((product) => `<tr><td>${escapeHtml(product.name)}</td><td>${formatMoney(product.total_quantity)} ${escapeHtml(product.unit || "قطعة")}</td><td>${formatMoney(product.min_stock)} ${escapeHtml(product.unit || "قطعة")}</td></tr>`).join("")}</tbody></table></div>`
                : `<div class="empty-state"><div>✓</div><strong>لا توجد تنبيهات</strong><span>المخزون يعمل بشكل طبيعي</span></div>`;
        }
        window.elSharqStartup?.mainReady();
    } catch (error) {
        console.error("Dashboard data loading error:", error);
        window.elSharqStartup?.failed(error?.message || "تعذر تحميل بيانات لوحة التحكم");
        const dashboard = document.querySelector(".dashboard");
        if (dashboard) {
            const notice = document.createElement("div");
            notice.className = "product-form-message error";
            notice.textContent = `تعذر تحميل بيانات لوحة التحكم: ${error?.message || "خطأ غير معروف"}`;
            dashboard.prepend(notice);
        }
    }
}

async function showProductsPage() {
    const dashboard = getDashboard();
    if (!dashboard) return;

    let products = [];
    let productSets = [];
    try {
        [products, productSets] = await Promise.all([
            window.elSharq.getProducts(),
            window.elSharq.getProductSets()
        ]);
    } catch (error) {
        console.error("Products loading error:", error);
        dashboard.innerHTML = `<div class="page-header"><h2>المنتجات</h2></div><div class="product-form-message error">تعذر تحميل المنتجات: ${escapeHtml(error?.message || "خطأ غير معروف")}</div>`;
        return;
    }
    const activeProducts = products.filter((product) => Number(product.active) === 1);
    const inactiveProducts = products.filter((product) => Number(product.active) !== 1);

    dashboard.innerHTML = `
        <div class="page-header">
            <div>
                <h2>المنتجات</h2>
                <p>إدارة الأصناف والأسعار والبيانات الأساسية</p>
            </div>
            <button class="primary-button" id="addProductButton" type="button">
                + إضافة منتج
            </button>
        </div>

        <div class="products-toolbar">
            <div class="search-box">
                <span>⌕</span>
                <input type="search" id="productSearch" placeholder="ابحث بكلمة أو أكثر: الاسم، الكود، الباركود...">
            </div>
            <div class="product-count">
                الأصناف النشطة:
                <strong>${activeProducts.length + productSets.filter((set) => Number(set.is_active) === 1).length}</strong>
            </div>
            <label class="product-archive-toggle">
                <input type="checkbox" id="showInactiveProducts">
                إظهار الأصناف الموقوفة (${inactiveProducts.length})
            </label>
        </div>

        <div class="products-panel">
            <div class="products-table-wrapper">
                <table class="products-table product-catalog-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>المنتج</th>
                            <th>الكود / الباركود</th>
                            <th>القسم</th>
                            <th>الوحدة</th>
                            <th>تفاصيل</th>
                            <th>سعر الشراء</th>
                            <th>سعر البيع</th>
                            <th>الحالة</th>
                            <th>إجراءات</th>
                        </tr>
                    </thead>
                    <tbody id="productsTableBody">
                        ${
                            products.length === 0
                                ? `
                                <tr>
                                    <td colspan="10">
                                        <div class="table-empty">
                                            <div>▣</div>
                                            <strong>لا توجد منتجات مسجلة</strong>
                                            <span>أضف منتجًا جديدًا للبدء</span>
                                        </div>
                                    </td>
                                </tr>
                                `
                                : products
                                      .map((product) => {
                                          const details = renderProductDetails(product);
                                          const isActive = Number(product.active) === 1;
                                          return `
                                            <tr data-product-active="${isActive ? "1" : "0"}" ${isActive ? "" : 'hidden data-inactive-product="1"'}>
                                                <td>${product.id}</td>
                                                <td class="product-name-cell"><strong>${escapeHtml(product.name)}</strong></td>
                                                <td class="product-code-cell">
                                                    <strong>${escapeHtml(product.internal_code || "-")}</strong>
                                                    ${product.barcode ? `<span>${escapeHtml(product.barcode)}</span>` : ""}
                                                </td>
                                                <td><span class="product-category-chip">${escapeHtml(product.category_name || "-")}</span></td>
                                                <td>${escapeHtml(product.unit || "-")}</td>
                                                <td>${details || "<span style='color:#657181'>-</span>"}</td>
                                                <td>${formatMoney(product.purchase_price)} ج.م</td>
                                                <td>${formatMoney(product.sale_price)} ج.م</td>
                                                <td><span class="status ${isActive ? "active" : "inactive"}">${isActive ? "نشط" : "موقوف"}</span></td>
                                                <td class="product-actions-cell">
                                                    <div class="action-buttons">
                                                        <button class="edit-btn" type="button" data-product-id="${product.id}" aria-label="تعديل المنتج" title="تعديل المنتج">تعديل</button>
                                                        <button class="delete-btn" type="button" data-delete-product-id="${product.id}">حذف</button>
                                                    </div>
                                                </td>
                                            </tr>
                                          `;
                                      })
                                      .join("")
                        }
                    </tbody>
                </table>
            </div>
        </div>
        <div class="products-panel">
            <h3>الأطقم المركبة</h3>
            <div class="products-table-wrapper">
                <table class="products-table">
                    <thead><tr><th>الطقم</th><th>الكود</th><th>القسم</th><th>المكونات</th><th>سعر البيع</th><th>الحالة</th><th>إجراءات</th></tr></thead>
                    <tbody>
                        ${productSets.map((set) => `
                            <tr>
                                <td><strong>${escapeHtml(set.name)}</strong></td>
                                <td>${escapeHtml(set.set_code || "-")}</td>
                                <td>${escapeHtml(set.category_name || "-")}</td>
                                <td>${(set.items || []).map((piece) => `${escapeHtml(piece.product_name)} × ${piece.quantity}`).join("<br>") || "-"}</td>
                                <td>${formatMoney(set.sale_price)} ج.م</td>
                                <td>${Number(set.is_active) ? '<span class="status active">نشط</span>' : '<span class="status inactive">غير نشط</span>'}</td>
                                <td><div class="action-buttons">
                                    <button class="edit-btn" type="button" data-set-edit-id="${set.id}">تعديل</button>
                                    <button class="edit-btn" type="button" data-set-active-id="${set.id}" data-active="${Number(set.is_active) ? 1 : 0}">${Number(set.is_active) ? "إيقاف" : "تفعيل"}</button>
                                </div></td>
                            </tr>
                        `).join("") || '<tr><td colspan="7">لا توجد أطقم مركبة</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    const searchInput = document.getElementById("productSearch");
    const showInactiveInput = document.getElementById("showInactiveProducts");
    const filterProductRows = () => {
        const search = searchInput?.value || "";
        const showInactive = showInactiveInput.checked;
        const rows = document.querySelectorAll(".products-panel tbody tr");
        rows.forEach((row) => {
            const matchesSearch = window.elSharqSearch.matches(search, row.textContent);
            const isInactive = row.dataset.inactiveProduct === "1";
            row.hidden = !matchesSearch || (isInactive && !showInactive);
        });
    };
    searchInput?.addEventListener("input", filterProductRows);
    showInactiveInput?.addEventListener("change", filterProductRows);

    document
        .getElementById("addProductButton")
        ?.addEventListener("click", async () => {
            await showAddProductModal();
        });

    document.querySelectorAll(".edit-btn[data-product-id]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = Number(btn.getAttribute("data-product-id"));
            await showAddProductModal(id);
        });
    });
    document.querySelectorAll("[data-delete-product-id]").forEach((button) => {
        button.addEventListener("click", async () => {
            const product = products.find((item) => Number(item.id) === Number(button.dataset.deleteProductId));
            if (!product) return;
            const showroomQuantity = Number(product.showroom_quantity || 0);
            const warehouseQuantity = Number(product.warehouse_quantity || 0);
            const hasStock = showroomQuantity > 0 || warehouseQuantity > 0;
            const stockWarning = hasStock
                ? `\n\nتنبيه: يوجد ${showroomQuantity} ${product.unit || "قطعة"} في المعرض و${warehouseQuantity} ${product.unit || "قطعة"} في المخزن. سيتم حذف الأرصدة مع المنتج إذا لم تكن له حركات أو فواتير سابقة.`
                : "";
            if (!window.confirm(`هل تريد حذف "${product.name}"؟${stockWarning}\n\nإذا كان المنتج مرتبطًا بفواتير أو حركات مخزون سابقة، سيتم إيقافه بدلًا من حذف سجلاته.`)) return;
            const password = await requestDeletionPassword();
            if (password === null) return;
            try {
                const result = await window.elSharq.deleteProduct(product.id, password);
                window.alert(result.archived
                    ? "المنتج مرتبط بفواتير أو حركات مخزون سابقة، لذلك تم إيقافه وإخفاؤه من القوائم مع الاحتفاظ بسجلاته."
                    : "تم حذف الصنف نهائيًا.");
                await showProductsPage();
            } catch (error) {
                console.error("Product deletion error:", error);
                window.alert(error?.message || "تعذر حذف الصنف");
            }
        });
    });
    document.querySelectorAll("[data-set-edit-id]").forEach((button) => {
        button.addEventListener("click", async () => {
            await showAddProductModal(null, Number(button.dataset.setEditId));
        });
    });
    document.querySelectorAll("[data-set-active-id]").forEach((button) => {
        button.addEventListener("click", async () => {
            try {
                await window.elSharq.setProductSetActive(
                    Number(button.dataset.setActiveId),
                    button.dataset.active !== "1"
                );
                await showProductsPage();
            } catch (error) {
                console.error("Product set status update error:", error);
                alert(error?.message || "تعذر تحديث حالة الطقم");
            }
        });
    });
}

function renderProductDetails(product) {
    const cat = product.category_name;
    if (cat === "سيراميك") {
        const l = Number(product.tile_length_cm || 0);
        const w = Number(product.tile_width_cm || 0);
        const t = Number(product.tiles_per_carton || 0);
        if (!l && !w && !t) return "";
        let out = "";
        if (l && w) out += `${l}×${w} سم`;
        if (t) out += (out ? " | " : "") + `${t} بلاطة/كرتون`;
        if (l && w && t) {
            const area = ((l * w * t) / 10000).toFixed(2);
            out += ` | ${area} م²`;
        }
        return out;
    }
    if (cat === "سباكة") {
        const d = Number(product.company_discount_percent || 0);
        return d ? `خصم الشركة: ${d}%` : "";
    }
    if (cat === "أدوات صحية" || cat === "خلاطات") {
        return product.is_set ? "طقم" : "قطعة فردية";
    }
    return "";
}

async function showAddProductModal(optionalProductId, optionalSetId, returnToPage = "products") {
    let categories = [];
    let sanitaryProducts = [];
    let editProduct = null;
    const isSetEditMode = !!optionalSetId;
    const isEditMode = !!optionalProductId || isSetEditMode;

    try {
        categories = await window.elSharq.getCategories();
        sanitaryProducts =
            (await window.elSharq.getSanitaryProducts?.()) ||
            (await window.elSharq.getProducts());
        if (isSetEditMode) {
            const sets = await window.elSharq.getProductSets();
            const set = sets.find((item) => Number(item.id) === Number(optionalSetId));
            if (!set) throw new Error("الطقم غير موجود");
            editProduct = {
                ...set,
                internal_code: set.set_code,
                unit: "طقم",
                is_set: 1,
                active: set.is_active
            };
        } else if (optionalProductId) {
            editProduct = await window.elSharq.getProductById(optionalProductId);
        }
    } catch (error) {
        console.error("Categories loading error:", error);
        alert(`حدث خطأ أثناء تحميل البيانات: ${error?.message || "خطأ غير معروف"}`);
        return;
    }

    const oldModal = document.getElementById("addProductModal");
    if (oldModal) oldModal.remove();

    const modal = document.createElement("div");
    modal.id = "addProductModal";
    modal.className = "product-modal";

    modal.innerHTML = `
        <div class="product-modal-overlay"></div>
        <div class="product-modal-box">
            <div class="product-modal-header">
                <div>
                    <span>${isEditMode ? "تعديل بيانات صنف" : "إضافة صنف جديد"}</span>
                    <h2>${isEditMode ? "تعديل المنتج" : "إضافة منتج"}</h2>
                </div>
                <button type="button" class="product-modal-close" id="closeProductModal">×</button>
            </div>
            <form id="addProductForm">
                <div class="product-form-grid">
                    <div class="form-field">
                        <label>اسم المنتج</label>
                        <input type="text" id="productName" placeholder="مثال: خلاط حوض" required
                            value="${escapeAttr(editProduct?.name || "")}">
                    </div>
                    <div class="form-field">
                        <label>كود المنتج</label>
                        <input type="text" id="productCode" placeholder="مثال: RD-001" required
                            value="${escapeAttr(editProduct?.internal_code || "")}">
                        <small class="product-code-hint">يُضاف RD تلقائيًا لأكواد منتجات ريدكس.</small>
                    </div>
                    <div class="form-field">
                        <label>الباركود (اختياري)</label>
                        <input type="text" id="productBarcode" placeholder="امسح أو اكتب الباركود"
                            value="${escapeAttr(editProduct?.barcode || "")}">
                    </div>
                    <div class="form-field">
                        <label>القسم</label>
                        <select id="productCategory" required>
                            <option value="">اختر القسم</option>
                            ${categories
                                .map(
                                    (c) => `
                                <option value="${c.id}" ${
                                        editProduct && Number(editProduct.category_id) === Number(c.id)
                                            ? "selected"
                                            : ""
                                    }>${escapeHtml(c.name)}</option>
                            `
                                )
                                .join("")}
                        </select>
                    </div>
                    <div class="form-field">
                        <label>الوحدة</label>
                        <select id="productUnit">
                            <option value="قطعة" ${
                                editProduct?.unit === "قطعة" ? "selected" : ""
                            }>قطعة</option>
                            <option value="كرتونة" ${
                                editProduct?.unit === "كرتونة" ? "selected" : ""
                            }>كرتونة</option>
                            <option value="متر" ${
                                editProduct?.unit === "متر" ? "selected" : ""
                            }>متر</option>
                            <option value="طقم" ${
                                editProduct?.unit === "طقم" ? "selected" : ""
                            }>طقم</option>
                        </select>
                    </div>
                    <div class="form-field" id="purchasePriceFieldWrap">
                        <label>سعر الشراء</label>
                        <div id="purchasePriceInput">
                            <input type="number" id="purchasePrice" min="0" step="0.01" placeholder="0.00" required
                                value="${formatMoney(editProduct?.purchase_price || 0)}">
                        </div>
                    </div>
                    <div class="form-field">
                        <label>سعر البيع</label>
                        <input type="number" id="salePrice" min="0" step="0.01" placeholder="0.00" required
                            value="${formatMoney(editProduct?.sale_price || 0)}">
                    </div>
                    <div class="form-field">
                        <label>الحد الأدنى للمخزون</label>
                        <input type="number" id="minStock" min="0" step="0.01"
                            value="${editProduct?.min_stock ?? 0}">
                    </div>
                </div>

                <div id="specialtyArea"></div>
                <div id="plumbingPipeUnitNotice" class="product-form-message" hidden>
                    تُباع المواسير بالمتر فقط؛ السعر والرصيد الافتتاحي والحد الأدنى محسوبة بالمتر.
                </div>

                ${isEditMode && !isSetEditMode ? `
                    <label class="product-active-toggle">
                        <input type="checkbox" id="productActive" ${Number(editProduct?.active) === 1 ? "checked" : ""}>
                        <span>الصنف نشط ومتاح للبيع</span>
                    </label>
                ` : ""}

                <div class="stock-section">
                    <div class="stock-section-title">
                        <strong>${isEditMode ? "أرصدة المعرض والمخزن" : "الرصيد الافتتاحي"}</strong>
                        <span>${isEditMode ? "أدخل الرصيد الفعلي؛ سيُسجل أي فرق كتسوية مخزون" : "أدخل الكمية الموجودة حاليًا في كل موقع"}</span>
                    </div>
                    <div class="stock-grid">
                        <div class="stock-box">
                            <label>🏪 المعرض</label>
                            <input type="number" id="showroomQuantity" min="0" step="0.01"
                                value="${editProduct?.showroom_quantity ?? 0}">
                            <span id="stockUnitShowroom">${editProduct?.unit || "قطعة"}</span>
                        </div>
                        <div class="stock-box">
                            <label>📦 المخزن</label>
                            <input type="number" id="warehouseQuantity" min="0" step="0.01"
                                value="${editProduct?.warehouse_quantity ?? 0}">
                            <span id="stockUnitWarehouse">${editProduct?.unit || "قطعة"}</span>
                        </div>
                    </div>
                </div>

                <div id="productFormMessage" class="product-form-message"></div>

                <div class="product-modal-footer">
                    <button type="button" class="secondary-button" id="cancelProductButton">
                        إلغاء
                    </button>
                    <button type="submit" class="primary-button" id="saveProductButton">
                        ${isEditMode ? "حفظ التعديلات" : "إضافة منتج"}
                    </button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();

    document.getElementById("closeProductModal")?.addEventListener("click", closeModal);
    document.getElementById("cancelProductButton")?.addEventListener("click", closeModal);
    modal.querySelector(".product-modal-overlay")?.addEventListener("click", closeModal);

    const productUnit = document.getElementById("productUnit");
    const updateStockUnit = () => {
        const u = productUnit.value || "قطعة";
        const showroom = document.getElementById("stockUnitShowroom");
        const warehouse = document.getElementById("stockUnitWarehouse");
        if (showroom) showroom.textContent = u;
        if (warehouse) warehouse.textContent = u;
    };
    productUnit?.addEventListener("change", updateStockUnit);
    updateStockUnit();

    let setPieces = [];
    let isPurchasePriceUnlocked = Boolean(
        editProduct?.category_name === "سباكة" &&
        (Number(editProduct.purchase_price_manual) === 1 || Math.abs(
            Number(editProduct.purchase_price) -
            Number(editProduct.sale_price) * (1 - Number(editProduct.company_discount_percent || 0) / 100)
        ) > 0.01)
    );

    const specialtyArea = document.getElementById("specialtyArea");
    const categoryEl = document.getElementById("productCategory");
    const salePriceEl = document.getElementById("salePrice");
    const productUnitEl = document.getElementById("productUnit");
    const productNameEl = document.getElementById("productName");

    const syncPlumbingPipeUnit = (categoryName) => {
        const isPipe = categoryName === "سباكة" &&
            /^مواسير(?:\s|$)/u.test(productNameEl?.value.trim() || "");
        if (productUnitEl) {
            if (!isPipe && productUnitEl.disabled) productUnitEl.value = "قطعة";
            productUnitEl.disabled = isPipe;
            if (isPipe) productUnitEl.value = "متر";
        }
        ["minStock", "showroomQuantity", "warehouseQuantity"].forEach((id) => {
            const input = document.getElementById(id);
            if (input) input.step = isPipe ? "0.01" : "1";
        });
        const minStockLabel = document.getElementById("minStock")?.closest(".form-field")?.querySelector("label");
        if (minStockLabel) {
            minStockLabel.textContent = isPipe
                ? "الحد الأدنى للمخزون (متر)"
                : "الحد الأدنى للمخزون";
        }
        const unitNotice = document.getElementById("plumbingPipeUnitNotice");
        if (unitNotice) unitNotice.hidden = !isPipe;
        ["stockUnitShowroom", "stockUnitWarehouse"].forEach((id) => {
            const label = document.getElementById(id);
            if (label) label.textContent = isPipe ? "متر" : (productUnitEl?.value || "قطعة");
        });
    };

    const calcCeramicPrices = (inputPrice, inputUnit, l, w, t) => {
        const tileArea = l && w ? (l * w) / 10000 : 0;
        const cartonArea = tileArea * t;
        let cartonPrice = 0, tilePrice = 0, meterPrice = 0;
        if (inputUnit === "carton") {
            cartonPrice = inputPrice;
            tilePrice = t > 0 ? inputPrice / t : 0;
            meterPrice = cartonArea > 0 ? inputPrice / cartonArea : 0;
        } else if (inputUnit === "tile") {
            tilePrice = inputPrice;
            cartonPrice = inputPrice * t;
            meterPrice = tileArea > 0 ? inputPrice / tileArea : 0;
        } else if (inputUnit === "meter") {
            meterPrice = inputPrice;
            cartonPrice = meterPrice * cartonArea;
            tilePrice = meterPrice * tileArea;
        }
        return { tileArea, cartonArea, cartonPrice, tilePrice, meterPrice };
    };

    const getCeramicPriceUnitFromSelect = () => {
        const u = productUnitEl?.value || "كرتونة";
        if (u === "بلاطة") return "tile";
        if (u === "متر") return "meter";
        return "carton";
    };

    const renderSpecialty = () => {
        const catId = Number(categoryEl.value);
        const cat = categories.find((c) => Number(c.id) === catId)?.name || "";
        syncPlumbingPipeUnit(cat);

        if (cat === "سيراميك") {
            if (productUnitEl) {
                productUnitEl.innerHTML = `
                    <option value="كرتونة" ${(productUnitEl.value || editProduct?.unit || "كرتونة") === "كرتونة" ? "selected" : ""}>كرتونة</option>
                    <option value="بلاطة" ${(productUnitEl.value || editProduct?.unit || "") === "بلاطة" ? "selected" : ""}>بلاطة</option>
                    <option value="متر" ${(productUnitEl.value || editProduct?.unit || "") === "متر" ? "selected" : ""}>متر</option>
                `;
            }
            const l = Number(
                document.getElementById("tileLength")?.value ||
                    editProduct?.tile_length_cm ||
                    0
            );
            const w = Number(
                document.getElementById("tileWidth")?.value ||
                    editProduct?.tile_width_cm ||
                    0
            );
            const t = Number(
                document.getElementById("tilesPerCarton")?.value ||
                    editProduct?.tiles_per_carton ||
                    0
            );
            const priceUnit = getCeramicPriceUnitFromSelect();
            const inputPrice = Number(salePriceEl.value || 0);

            const { tileArea, cartonArea, cartonPrice, tilePrice, meterPrice } =
                calcCeramicPrices(inputPrice, priceUnit, l, w, t);

            specialtyArea.innerHTML = `
                <div class="specialty-card">
                    <div class="specialty-card-header">
                        <div class="specialty-card-badge">🏺</div>
                        <div>
                            <strong>تفاصيل السيراميك</strong>
                            <span>المقاسات والبلاطات بالكرتونة</span>
                        </div>
                    </div>
                    <div class="specialty-form-grid">
                        <div class="form-field">
                            <label>طول البلاطة سم</label>
                            <input type="number" id="tileLength" min="0" step="0.01"
                                value="${l || ""}" placeholder="مثال: 60">
                        </div>
                        <div class="form-field">
                            <label>عرض البلاطة سم</label>
                            <input type="number" id="tileWidth" min="0" step="0.01"
                                value="${w || ""}" placeholder="مثال: 60">
                        </div>
                        <div class="form-field">
                            <label>عدد البلاطات بالكرتونة</label>
                            <input type="number" id="tilesPerCarton" min="0" step="1"
                                value="${t || ""}" placeholder="مثال: 4">
                        </div>
                    </div>
                    <div class="live-summary">
                        <div class="live-summary-title">ملخص السيراميك - يحدث تلقائيًا</div>
                        <div class="live-summary-grid">
                            <div class="live-summary-item">
                                <label>مساحة البلاطة</label>
                                <strong>${tileArea.toFixed(4)} م²</strong>
                            </div>
                            <div class="live-summary-item">
                                <label>مساحة الكرتونة</label>
                                <strong>${cartonArea.toFixed(2)} م²</strong>
                            </div>
                            <div class="live-summary-item">
                                <label>سعر البلاطة</label>
                                <strong>${formatMoney(tilePrice)} ج.م</strong>
                            </div>
                            <div class="live-summary-item">
                                <label>سعر المتر</label>
                                <strong>${formatMoney(meterPrice)} ج.م</strong>
                            </div>
                            <div class="live-summary-item">
                                <label>سعر الكرتونة كاملة</label>
                                <strong>${formatMoney(cartonPrice)} ج.م</strong>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            ["tileLength", "tileWidth", "tilesPerCarton"].forEach((id) => {
                document.getElementById(id)?.addEventListener("input", () => {
                    renderSpecialty();
                });
            });
        } else if (cat === "سباكة") {
            const salePriceValue = Number(salePriceEl?.value);
            const salePrice = Number.isFinite(salePriceValue) ? salePriceValue : 0;
            const discountInput = document.getElementById("companyDiscount");
            const discountValue = discountInput
                ? Number(discountInput.value)
                : Number(editProduct?.company_discount_percent || 0);
            const clampedDiscount = Math.max(
                0,
                Math.min(100, Number.isFinite(discountValue) ? discountValue : 0)
            );
            const purchaseAuto = salePrice * (1 - clampedDiscount / 100);

            const purchaseWrap = document.getElementById("purchasePriceFieldWrap");
            if (purchaseWrap) {
                const actualInput = document.getElementById("purchasePriceInput");
                if (actualInput) {
                    const currentPurchaseValue = Number(document.getElementById("purchasePrice")?.value);
                    const finPP = isPurchasePriceUnlocked
                        ? Number.isFinite(currentPurchaseValue)
                            ? currentPurchaseValue
                            : Number(editProduct?.purchase_price || purchaseAuto)
                        : purchaseAuto;
                    const finPPStr = formatMoney(finPP);
                    const inpDisabled = isPurchasePriceUnlocked ? "" : "disabled";
                    const lockBtnCls = isPurchasePriceUnlocked ? "unlocked" : "";
                    const lockBtnTxt = isPurchasePriceUnlocked ? "✏️ تعديل يدوي" : "🔒 محسوب";
                    actualInput.innerHTML =
                        '<div class="lock-toggle-group">' +
                        '<input type="number" id="purchasePrice" min="0" step="0.01" placeholder="0.00" ' +
                        inpDisabled +
                        ' value="' +
                        finPPStr +
                        '" required>' +
                        '<button type="button" class="lock-toggle-btn ' +
                        lockBtnCls +
                        '" id="togglePurchaseLock">' +
                        lockBtnTxt +
                        "</button>" +
                        "</div>";
                    document
                        .getElementById("togglePurchaseLock")
                        ?.addEventListener("click", () => {
                            isPurchasePriceUnlocked = !isPurchasePriceUnlocked;
                            renderSpecialty();
                        });
                }
            }

            specialtyArea.innerHTML = `
                <div class="specialty-card">
                    <div class="specialty-card-header">
                        <div class="specialty-card-badge">🏢</div>
                        <div>
                            <strong>خصم الشركة</strong>
                            <span>خصم السباكة المطبق على سعر البيع</span>
                        </div>
                    </div>
                    <div class="specialty-form-grid">
                        <div class="form-field">
                            <label>نسبة خصم الشركة %</label>
                            <input type="number" id="companyDiscount" min="0" max="100" step="0.01"
                                value="${clampedDiscount}" required placeholder="مثال: 25">
                        </div>
                    </div>
                    <div class="live-summary plumbing">
                        <div class="live-summary-title">ملخص السعر - يحدث فوراً</div>
                        <div class="live-summary-grid plumbing-price-summary">
                            <div class="live-summary-item">
                                <label>سعر البيع</label>
                                <strong>${formatMoney(salePrice)} ج.م</strong>
                            </div>
                            <div class="live-summary-item">
                                <label>سعر الشراء ${isPurchasePriceUnlocked ? "(يدوي)" : `بعد خصم ${clampedDiscount.toFixed(2)}%`}</label>
                                <strong>${formatMoney(
                                    isPurchasePriceUnlocked
                                        ? Number(document.getElementById("purchasePrice")?.value || 0)
                                        : purchaseAuto
                                )} ج.م</strong>
                            </div>
                            <div class="live-summary-item">
                                <label>الربح</label>
                                <strong>${formatMoney(
                                    salePrice -
                                        (isPurchasePriceUnlocked
                                            ? Number(document.getElementById("purchasePrice")?.value || 0)
                                            : purchaseAuto)
                                )} ج.م</strong>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const updatePurchaseSummary = () => {
                const purchaseValue = Number(document.getElementById("purchasePrice")?.value);
                const purchasePrice = Number.isFinite(purchaseValue) ? purchaseValue : 0;
                const summaryValues = specialtyArea.querySelectorAll(
                    ".plumbing-price-summary .live-summary-item strong"
                );
                if (summaryValues.length === 3) {
                    summaryValues[1].textContent = `${formatMoney(purchasePrice)} ج.م`;
                    summaryValues[2].textContent = `${formatMoney(salePrice - purchasePrice)} ج.م`;
                }
            };

            document.getElementById("purchasePrice")?.addEventListener("input", updatePurchaseSummary);
            document
                .getElementById("companyDiscount")
                ?.addEventListener("input", () => {
                    let v = Number(document.getElementById("companyDiscount").value || 0);
                    if (v < 0) v = 0;
                    if (v > 100) v = 100;
                    document.getElementById("companyDiscount").value = v;
                    renderSpecialty();
                });
        } else if (cat === "أدوات صحية" || cat === "خلاطات") {
            const initialType = isSetEditMode ? "set" : "single";

            if (initialType === "set" && setPieces.length === 0) {
                if (editProduct?.items && editProduct.items.length) {
                    setPieces = editProduct.items.map((i) => ({ ...i }));
                } else {
                    setPieces = [{ product_id: "", quantity: 1 }];
                }
            }

            const renderSetPieces = () => {
                const wrapper = document.getElementById("setPiecesWrapper");
                if (!wrapper) return;
                wrapper.innerHTML = setPieces
                    .map(
                        (piece, idx) => `
                        <div class="set-piece-row">
                            <select class="set-piece-product" data-idx="${idx}">
                                <option value="">اختر قطعة</option>
                                ${sanitaryProducts
                                    .map(
                                        (p) => `
                                    <option value="${p.id}"
                                        data-price="${p.sale_price}"
                                        ${
                                            Number(piece.product_id) === Number(p.id)
                                                ? "selected"
                                                : ""
                                        }
                                    >${escapeHtml(p.name)} - ${escapeHtml(
                                            p.internal_code || ""
                                        )}</option>
                                `
                                    )
                                    .join("")}
                            </select>
                            <input type="number" min="1" step="1" class="set-piece-qty" data-idx="${idx}"
                                value="${piece.quantity || 1}">
                            <button type="button" class="set-piece-remove" data-idx="${idx}"
                                ${setPieces.length === 1 ? "disabled style='opacity:.4;cursor:not-allowed'" : ""}>
                                ✕
                            </button>
                        </div>
                    `
                    )
                    .join("");

                wrapper.querySelectorAll(".set-piece-product").forEach((sel) => {
                    sel.addEventListener("change", (e) => {
                        const idx = Number(e.target.dataset.idx);
                        setPieces[idx].product_id = Number(e.target.value) || "";
                        updateSetTotal();
                    });
                });
                wrapper.querySelectorAll(".set-piece-qty").forEach((inp) => {
                    inp.addEventListener("input", (e) => {
                        const idx = Number(e.target.dataset.idx);
                        setPieces[idx].quantity = Math.max(1, Number(e.target.value) || 1);
                        updateSetTotal();
                    });
                });
                wrapper.querySelectorAll(".set-piece-remove").forEach((btn) => {
                    if (btn.disabled) return;
                    btn.addEventListener("click", (e) => {
                        const idx = Number(e.target.dataset.idx);
                        setPieces.splice(idx, 1);
                        if (setPieces.length === 0)
                            setPieces = [{ product_id: "", quantity: 1 }];
                        renderSetPieces();
                        updateSetTotal();
                    });
                });
                updateSetTotal();
            };

            const updateSetTotal = () => {
                let total = 0;
                setPieces.forEach((piece) => {
                    if (!piece.product_id) return;
                    const p = sanitaryProducts.find(
                        (x) => Number(x.id) === Number(piece.product_id)
                    );
                    if (p) total += Number(p.sale_price || 0) * Number(piece.quantity || 1);
                });
                const saleInput = document.getElementById("salePrice");
                const currentVal = Number(saleInput.value || 0);
                if (!currentVal || !isEditMode) {
                    saleInput.value = formatMoney(total);
                }
                const totalEl = document.getElementById("setPriceTotalValue");
                if (totalEl) totalEl.textContent = `${formatMoney(total)} ج.م`;
            };

            specialtyArea.innerHTML = `
                <div class="set-picker-section">
                    <div class="set-type-radio">
                        <label>
                            <input type="radio" name="setType" value="single" ${
                                initialType === "single" ? "checked" : ""
                            }>
                            منتج فردي
                        </label>
                        <label>
                            <input type="radio" name="setType" value="set" ${
                                initialType === "set" ? "checked" : ""
                            }>
                            طقم مكون
                        </label>
                    </div>
                    <div id="setPiecesArea" style="${
                        initialType === "set" ? "" : "display:none"
                    }">
                        <div id="setPiecesWrapper"></div>
                        <button type="button" class="set-piece-add" id="addSetPieceBtn">
                            + إضافة قطعة
                        </button>
                        <div class="set-price-total">
                            <span>إجمالي سعر القطع (كمرجع):</span>
                            <strong id="setPriceTotalValue">0.00 ج.م</strong>
                        </div>
                    </div>
                </div>
            `;

            document.querySelectorAll('input[name="setType"]').forEach((r) => {
                r.addEventListener("change", () => {
                    const area = document.getElementById("setPiecesArea");
                    const t = document.querySelector('input[name="setType"]:checked').value;
                    const isComposite = t === "set";
                    const purchaseField = document.getElementById("purchasePriceFieldWrap");
                    const minimumField = document.getElementById("minStock")?.closest(".form-field");
                    const stockSection = document.querySelector(".stock-section");
                    if (purchaseField) purchaseField.style.display = isComposite ? "none" : "";
                    if (minimumField) minimumField.style.display = isComposite ? "none" : "";
                    if (stockSection) stockSection.style.display = isComposite ? "none" : "";
                    if (t === "set") {
                        area.style.display = "";
                        if (setPieces.length === 0)
                            setPieces = [{ product_id: "", quantity: 1 }];
                        renderSetPieces();
                    } else {
                        area.style.display = "none";
                    }
                });
            });
            if (isSetEditMode) {
                const singleOption = document.querySelector('input[name="setType"][value="single"]');
                if (singleOption) singleOption.disabled = true;
            }
            document.querySelector('input[name="setType"]:checked')?.dispatchEvent(new Event("change"));

            document.getElementById("addSetPieceBtn")?.addEventListener("click", () => {
                setPieces.push({ product_id: "", quantity: 1 });
                renderSetPieces();
            });

            if (initialType === "set") renderSetPieces();
        } else {
            specialtyArea.innerHTML = "";
            const purchaseWrap = document.getElementById("purchasePriceFieldWrap");
            const actualInput = document.getElementById("purchasePriceInput");
            if (purchaseWrap && actualInput) {
                actualInput.innerHTML = `
                    <input type="number" id="purchasePrice" min="0" step="0.01" placeholder="0.00" required
                        value="${formatMoney(
                            Number(
                                document.getElementById("purchasePrice")?.value ||
                                    editProduct?.purchase_price ||
                                    0
                            )
                        )}">
                `;
            }
            isPurchasePriceUnlocked = false;
        }
    };

    categoryEl?.addEventListener("change", renderSpecialty);
    productNameEl?.addEventListener("input", renderSpecialty);
    salePriceEl?.addEventListener("input", renderSpecialty);
    productUnitEl?.addEventListener("change", () => {
        const catId = Number(categoryEl.value);
        const catName = categories.find((c) => Number(c.id) === catId)?.name || "";
        if (catName === "سيراميك") renderSpecialty();
    });
    renderSpecialty();

    if (isEditMode && editProduct) {
        const catId = Number(editProduct.category_id);
        const catName = categories.find((c) => Number(c.id) === catId)?.name || "";
        if (catName === "سيراميك") {
            const l = Number(editProduct.tile_length_cm || 0);
            const w = Number(editProduct.tile_width_cm || 0);
            const t = Number(editProduct.tiles_per_carton || 0);
            const { tilePrice, meterPrice, cartonPrice } = calcCeramicPrices(
                Number(editProduct.sale_price || 0), "carton", l, w, t
            );
            const u = editProduct.unit || "كرتونة";
            if (u === "بلاطة") {
                salePriceEl.value = formatMoney(tilePrice);
            } else if (u === "متر") {
                salePriceEl.value = formatMoney(meterPrice);
            } else {
                salePriceEl.value = formatMoney(cartonPrice);
            }
            setTimeout(renderSpecialty, 0);
        }
    }

    const form = document.getElementById("addProductForm");
    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const message = document.getElementById("productFormMessage");

        const name = document.getElementById("productName").value.trim();
        const internalCode = document.getElementById("productCode").value.trim();
        const categoryId = Number(document.getElementById("productCategory").value);
        const unit = document.getElementById("productUnit").value;
        let purchasePrice = Number(document.getElementById("purchasePrice")?.value || 0);
        const salePrice = Number(document.getElementById("salePrice").value || 0);
        const minStock = Number(document.getElementById("minStock").value || 0);
        const showroomQuantity = Number(
            document.getElementById("showroomQuantity").value || 0
        );
        const warehouseQuantity = Number(
            document.getElementById("warehouseQuantity").value || 0
        );

        if (!name) {
            message.textContent = "اسم المنتج مطلوب";
            message.className = "product-form-message error";
            return;
        }
        if (!internalCode) {
            message.textContent = "كود المنتج مطلوب";
            message.className = "product-form-message error";
            return;
        }
        if (!categoryId) {
            message.textContent = "القسم مطلوب";
            message.className = "product-form-message error";
            return;
        }
        if (purchasePrice < 0 || salePrice < 0 || minStock < 0 || showroomQuantity < 0 || warehouseQuantity < 0) {
            message.textContent = "لا يسمح بالقيم السالبة";
            message.className = "product-form-message error";
            return;
        }

        const cat = categories.find((c) => Number(c.id) === categoryId)?.name || "";

        const payload = {
            name,
            internal_code: internalCode,
            barcode: document.getElementById("productBarcode")?.value.trim() || null,
            category_id: categoryId,
            unit,
            purchase_price: purchasePrice,
            sale_price: salePrice,
            min_stock: minStock,
            showroom_quantity: showroomQuantity,
            warehouse_quantity: warehouseQuantity,
            active: document.getElementById("productActive")
                ? Number(document.getElementById("productActive").checked)
                : (editProduct?.active ?? 1)
        };

        if (cat === "سيراميك") {
            const lVal = Number(
                document.getElementById("tileLength")?.value || 0
            );
            const wVal = Number(
                document.getElementById("tileWidth")?.value || 0
            );
            const tVal = Number(
                document.getElementById("tilesPerCarton")?.value || 0
            );
            payload.tile_length_cm = lVal;
            payload.tile_width_cm = wVal;
            payload.tiles_per_carton = tVal;
            const priceUnit = unit === "بلاطة" ? "tile" : (unit === "متر" ? "meter" : "carton");
            const { cartonPrice } = calcCeramicPrices(
                salePrice, priceUnit, lVal, wVal, tVal
            );
            payload.sale_price = cartonPrice;
        }

        if (cat === "سباكة") {
            let d = Number(document.getElementById("companyDiscount")?.value || 0);
            d = Math.max(0, Math.min(100, d));
            payload.company_discount_percent = d;
            payload.purchase_price_manual = isPurchasePriceUnlocked ? true : false;
        }

        if (cat === "أدوات صحية" || cat === "خلاطات") {
            const t = document.querySelector('input[name="setType"]:checked')?.value;
            if (t === "set") {
                payload.unit = "طقم";
                payload.is_set = 1;
            } else {
                payload.is_set = 0;
            }
        }

        try {
            let result;
            const selectedSetType = document.querySelector('input[name="setType"]:checked')?.value;
            if (selectedSetType === "set") {
                const items = setPieces.map((piece) => ({
                    product_id: Number(piece.product_id),
                    quantity: Number(piece.quantity)
                }));
                if (items.some((item) => !item.product_id || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
                    throw new Error("اختر مكونات الطقم وحدد كمياتها");
                }
                if (optionalProductId && !isSetEditMode) {
                    throw new Error("لا يمكن تحويل منتج موجود إلى طقم مركب من هذه الشاشة");
                }
                const setPayload = {
                    name,
                    set_code: internalCode,
                    category_id: categoryId,
                    sale_price: salePrice,
                    items
                };
                result = isSetEditMode
                    ? await window.elSharq.updateProductSet(optionalSetId, setPayload)
                    : await window.elSharq.addProductSet(setPayload);
            } else if (isEditMode) {
                result = await window.elSharq.updateProduct(optionalProductId, payload);
            } else {
                result = await window.elSharq.addProduct(payload);
            }
            if (!result?.success) throw new Error("فشل الحفظ");

            message.textContent = isEditMode ? "تم تعديل البيانات بنجاح ✓" : "تم حفظ البيانات بنجاح ✓";
            message.className = "product-form-message success";

            setTimeout(async () => {
                modal.remove();
                if (returnToPage === "stock") {
                    await window.elSharqPages.show("stock");
                } else {
                    await showProductsPage();
                }
            }, 600);
        } catch (error) {
            console.error("Save product error:", error);
            message.textContent = error.message || "حدث خطأ أثناء الحفظ";
            message.className = "product-form-message error";
        }
    });
}

async function renderLastInvoicesPanel(targetId, filter, pageContext, onEdit) {
    const panel = document.getElementById(targetId);
    if (!panel) return;
    let sales = [];
    try {
        sales = (await window.elSharq.getSales(filter)) || [];
    } catch (error) {
        console.error("Invoices loading error:", error);
        panel.innerHTML = `<div class="product-form-message error">تعذر تحميل الفواتير: ${escapeHtml(error?.message || "خطأ غير معروف")}</div>`;
        return;
    }

    panel.innerHTML = `
        <div class="last-invoices-panel-header">
            <div>
                <h3>${filter === "plumbing_order" ? "آخر طلبيات السباكة" : "آخر فواتير المبيعات"}</h3>
                <span>أحدث ${sales.length} فاتورة</span>
            </div>
        </div>
        <div class="last-invoices-table-wrapper">
            <table class="last-invoices-table">
                <thead>
                    <tr>
                        <th>رقم الفاتورة</th>
                        <th>التاريخ</th>
                        <th>${filter === "plumbing_order" ? "التاجر" : "العميل"}</th>
                        <th>الإجمالي</th>
                        <th>المدفوع</th>
                        <th>المتبقي</th>
                        <th>إجراءات</th>
                    </tr>
                </thead>
                <tbody>
                    ${
                        sales.length === 0
                            ? `
                            <tr>
                                <td colspan="7">
                                    <div class="table-empty" style="min-height:160px;">
                                        <div>📭</div>
                                        <strong>لا توجد فواتير حتى الآن</strong>
                                        <span>أضف فاتورة جديدة لتظهر هنا</span>
                                    </div>
                                </td>
                            </tr>
                            `
                            : sales
                                  .map((s) => {
                                      const dateStr = s.created_at
                                          ? new Date(s.created_at).toLocaleDateString("ar-EG")
                                          : "-";
                                      const rem = Number(s.remaining || 0);
                                      return `
                                        <tr>
                                            <td>
                                                <span class="invoice-link" data-sale-id="${s.id}">
                                                    ${escapeHtml(s.invoice_number || s.id)}
                                                </span>
                                            </td>
                                            <td>${dateStr}</td>
                                            <td>${escapeHtml(
                                                filter === "plumbing_order"
                                                    ? s.customer_name || "-"
                                                    : s.customer_name || "عميل نقدي"
                                            )}</td>
                                            <td><strong>${formatMoney(s.total)} ج.م</strong></td>
                                            <td>${formatMoney(s.paid)} ج.م</td>
                                            <td>
                                                <span class="${
                                                    rem > 0.01
                                                        ? "remaining-danger"
                                                        : "remaining-safe"
                                                }">
                                                    ${formatMoney(rem)} ج.م
                                                </span>
                                            </td>
                                            <td>
                                                <div class="action-buttons">
                                                    <button type="button" class="view-btn" data-view-id="${s.id}">
                                                        🖨 طباعة
                                                    </button>
                                                    <button type="button" class="edit-btn" data-edit-id="${s.id}">
                                                        ✏️ تعديل
                                                    </button>
                                                    <button type="button" class="delete-btn" data-delete-sale-id="${s.id}">
                                                        حذف
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                      `;
                                  })
                                  .join("")
                    }
                </tbody>
            </table>
        </div>
    `;

    panel.querySelectorAll('[data-edit-id]').forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = Number(btn.getAttribute("data-edit-id"));
            onEdit?.(id);
        });
    });

    panel.querySelectorAll("[data-delete-sale-id]").forEach((button) => {
        button.addEventListener("click", async () => {
            const sale = sales.find((item) => Number(item.id) === Number(button.dataset.deleteSaleId));
            if (!sale || !window.confirm(`سيتم حذف الفاتورة ${sale.invoice_number || sale.id}، وإرجاع أصنافها للمخزون وحذف أثر تحصيلها من الحسابات والخزنة. هل تريد المتابعة؟`)) return;
            const password = await requestDeletionPassword();
            if (password === null) return;
            try {
                await window.elSharq.deleteSale(sale.id, password);
                window.alert("تم حذف الفاتورة وإرجاع أثرها على المخزون والحسابات.");
                await renderLastInvoicesPanel(targetId, filter, pageContext, onEdit);
            } catch (error) {
                console.error("Invoice deletion error:", error);
                window.alert(error?.message || "تعذر حذف الفاتورة");
            }
        });
    });

    panel.querySelectorAll('[data-view-id]').forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = Number(btn.getAttribute("data-view-id"));
            let printWindow;
            try {
                printWindow = window.elSharqInvoicePrint.open();
                const sale = await window.elSharq.getSaleById(id);
                window.elSharqInvoicePrint.print(printWindow, {
                    ...sale,
                    type: sale.sale_type === "plumbing_order" ? "plumbing_order" : "sale",
                    partyName: sale.customer_name || "عميل نقدي",
                    discount: Number(sale.plumbing_discount_amount || 0) + Number(sale.general_discount_amount || 0),
                    items: sale.items.map((item) => {
                        const displayQuantity = getCeramicDisplayQty(item);
                        return {
                            ...item,
                            displayQuantity: displayQuantity.qty,
                            displayUnit: displayQuantity.unit,
                            unitPrice: item.unitPrice || item.unit_price
                        };
                    })
                });
            } catch (e) {
                if (printWindow && !printWindow.closed) printWindow.close();
                alert(e.message || "تعذرت طباعة الفاتورة");
            }
        });
    });

    panel.querySelectorAll(".invoice-link[data-sale-id]").forEach((el) => {
        el.addEventListener("click", async () => {
            const id = Number(el.getAttribute("data-sale-id"));
            onEdit?.(id);
        });
    });
}

async function showSalesPage() {
    const dashboard = getDashboard();
    if (!dashboard) return;

    let products = [];
    let productSets = [];
    try {
        products = await window.elSharq.getProducts();
        productSets = ((await window.elSharq.getProductSets?.()) || []).filter((set) =>
            Number(set.is_active) === 1 &&
            Array.isArray(set.items) &&
            set.items.length > 0 &&
            set.items.every((piece) =>
                products.some((product) =>
                    Number(product.id) === Number(piece.product_id) &&
                    Number(product.active) === 1
                )
            )
        );
    } catch (error) {
        console.error("Sales products loading error:", error);
        dashboard.innerHTML = `<div class="page-header"><h2>المبيعات</h2></div><div class="product-form-message error">تعذر تحميل بيانات البيع: ${escapeHtml(error?.message || "خطأ غير معروف")}</div>`;
        return;
    }

    let editingSaleId = null;

    dashboard.innerHTML = `
        <div class="page-header">
            <div>
                <h2>المبيعات</h2>
                <p>إنشاء وإدارة فواتير البيع</p>
            </div>
            <button class="primary-button" id="newSaleButton" type="button">
                + فاتورة بيع جديدة
            </button>
        </div>

        <div id="lastInvoicesPanel" class="last-invoices-panel"></div>

        <div class="sales-summary-grid">
            <div class="stat-card">
                <div class="stat-icon sales">ف</div>
                <div>
                    <span>فواتير اليوم</span>
                    <strong id="statSalesCount">0</strong>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon cash">ك</div>
                <div>
                    <span>مبيعات اليوم</span>
                    <strong>0.00 ج.م</strong>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon profit">ر</div>
                <div>
                    <span>مجمل الربح اليوم</span>
                    <strong>0.00 ج.م</strong>
                </div>
            </div>
        </div>

        <div class="sales-panel">
            <div class="sales-panel-header">
                <div>
                    <h3 id="saleFormTitle">فاتورة بيع جديدة</h3>
                    <span>أضف المنتجات وحدد الكميات والأسعار</span>
                </div>
                <div class="invoice-number">
                    رقم الفاتورة:
                    <strong id="saleInvoiceNumberDisplay">تلقائي</strong>
                </div>
            </div>

            <div class="sale-info-grid">
                <div class="form-field">
                    <label>العميل</label>
                    <input type="text" id="saleCustomer" placeholder="اسم العميل - اختياري">
                </div>
                <div class="form-field">
                    <label>مكان البيع</label>
                    <select id="saleLocation">
                        <option value="المعرض">المعرض</option>
                        <option value="المخزن">المخزن</option>
                    </select>
                </div>
            </div>

            <div class="sale-add-product extended" id="saleAddProductRow">
                <div class="form-field" style="position:relative">
                    <label>🔎 البحث بالمنتج (اكتب اسم أو كود)</label>
                    <input type="search" id="saleProductSearch" placeholder="اكتب كلمات البحث بالاسم أو الكود أو الباركود...">
                    <div id="saleProductDropdown" class="autocomplete-dropdown" style="display:none"></div>
                </div>
                <div class="form-field" style="display:none">
                    <label>المنتج</label>
                    <select id="saleProduct">
                        <option value="">اختر المنتج</option>
                        ${productSets
                            .map(
                                (s) => `
                            <option value="set-${s.id}"
                                data-price="${s.sale_price}"
                                data-unit="طقم"
                                data-category="${escapeAttr(s.category_name || "")}"
                                data-internal-code="${escapeAttr(s.set_code || "")}"
                                data-is-set="1">
                                [طقم] ${s.category_name ? escapeHtml(s.category_name) + " " : ""}${escapeHtml(s.name)}
                            </option>
                        `
                            )
                            .join("")}
                        ${products
                            .filter((product) => Number(product.active) === 1)
                            .map(
                                (product) => `
                            <option value="${product.id}"
                                data-price="${product.sale_price}"
                                data-unit="${escapeAttr(product.unit || "قطعة")}"
                                data-category="${escapeAttr(product.category_name || "")}"
                                data-internal-code="${escapeAttr(product.internal_code || "")}"
                                data-barcode="${escapeAttr(product.barcode || "")}"
                                data-tile-length="${product.tile_length_cm || ""}"
                                data-tile-width="${product.tile_width_cm || ""}"
                                data-tiles-carton="${product.tiles_per_carton || ""}"
                                data-is-set="0">
                                ${product.category_name ? escapeHtml(product.category_name) + " " : ""}${escapeHtml(product.name)}
                                ${product.barcode ? ` — ${escapeHtml(product.barcode)}` : ""}
                                ${
                                    product.category_name === "سيراميك" &&
                                    product.tile_length_cm &&
                                    product.tile_width_cm
                                        ? ` — ${product.tile_length_cm}×${product.tile_width_cm}`
                                        : ""
                                }
                                — ${escapeHtml(product.internal_code || "")}
                            </option>
                        `
                            )
                            .join("")}
                    </select>
                </div>
                <div id="ceramicUnitField" class="form-field" style="display:none">
                    <label>الكمية (أدخل بأي وحدة — الباقي يحسب تلقائيًا)</label>
                    <div class="ceramicQtyGrid" style="display:grid;grid-template-columns:repeat(3,minmax(140px,1fr));gap:16px;padding:8px 0;box-sizing:border-box;">
                        <div style="display:flex;flex-direction:column;gap:10px;">
                            <label>📦 كرتون</label>
                            <input type="number" id="saleQtyCarton" min="0" step="0.01" value="" placeholder="عدد الكراتين"
                                inputmode="decimal" pattern="[0-9.]*" autocomplete="off"
                                class="ceramicQtyInput ceramicQtyInput--carton"
                                style="width:100%;box-sizing:border-box;background:#181d27;color:#fff;">
                        </div>
                        <div style="display:flex;flex-direction:column;gap:10px;">
                            <label>🧱 بلاطة</label>
                            <input type="number" id="saleQtyTile" min="0" step="1" value="" placeholder="عدد البلاطات"
                                inputmode="numeric" pattern="[0-9]*" autocomplete="off"
                                class="ceramicQtyInput ceramicQtyInput--tile"
                                style="width:100%;box-sizing:border-box;background:#181d27;color:#fff;">
                        </div>
                        <div style="display:flex;flex-direction:column;gap:10px;">
                            <label>🏠 متر²</label>
                            <input type="number" id="saleQtyMeter" min="0" step="0.01" value="" placeholder="بالمتر المربع"
                                inputmode="decimal" pattern="[0-9.]*" autocomplete="off"
                                class="ceramicQtyInput ceramicQtyInput--meter"
                                style="width:100%;box-sizing:border-box;background:#181d27;color:#fff;">
                        </div>
                    </div>
                    <div style="display:none">
                        <label>وحدة البيع</label>
                        <select class="ceramic-unit-select" id="ceramicSaleUnit">
                            <option value="carton">بالكرتونة</option>
                            <option value="tile">بالبلاطة</option>
                            <option value="meter">بالمتر المربع</option>
                        </select>
                    </div>
                </div>
                <div class="form-field" id="regularQtyField">
                    <label id="saleQuantityLabel">الكمية</label>
                    <input type="number" id="saleQuantity" min="0.01" step="0.01" value="1">
                </div>
                <div class="form-field" id="salePriceField">
                    <label id="saleUnitPriceLabel">سعر البيع</label>
                    <input type="number" id="saleUnitPrice" min="0" step="0.01" value="0">
                </div>
                <div class="sale-add-button-wrap">
                    <button class="primary-button" id="addSaleItemButton" type="button">
                        + إضافة للصنف
                    </button>
                </div>
            </div>

            <div class="sale-items-wrapper">
                <table class="products-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>المنتج</th>
                            <th>الوحدة</th>
                            <th>الكمية</th>
                            <th>سعر الوحدة</th>
                            <th>الإجمالي</th>
                            <th>إجراء</th>
                        </tr>
                    </thead>
                    <tbody id="saleItemsBody">
                        <tr>
                            <td colspan="7">
                                <div class="table-empty">
                                    <div>🧾</div>
                                    <strong>لم تتم إضافة أصناف</strong>
                                    <span>اختر منتجًا من الأعلى لإضافته للفاتورة</span>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="sale-bottom-grid">
                <div class="sale-notes">
                    <div class="form-field">
                        <label>ملاحظات</label>
                        <textarea id="saleNotes" placeholder="ملاحظات الفاتورة..." rows="5"></textarea>
                    </div>
                </div>
                <div class="sale-totals">
                    <div class="total-row">
                        <span>الإجمالي</span>
                        <strong id="saleSubtotal">0.00 ج.م</strong>
                    </div>
                    <div class="total-row plumbing-discount">
                        <span>خصم السباكة %</span>
                        <input type="number" id="plumbingDiscount" min="0" max="100" step="0.01" value="0">
                    </div>
                    <div class="total-row">
                        <span>قيمة خصم السباكة</span>
                        <strong id="plumbingDiscountAmount">0.00 ج.م</strong>
                    </div>
                    <div class="total-row grand-total">
                        <span>الإجمالي النهائي</span>
                        <strong id="saleGrandTotal">0.00 ج.م</strong>
                    </div>
                    <div class="payment-section">
                        <div class="form-field">
                            <label>المدفوع</label>
                            <input type="number" id="salePaid" min="0" step="0.01" value="0">
                        </div>
                        <div class="remaining-box">
                            <span>المتبقي</span>
                            <strong id="saleRemaining">0.00 ج.م</strong>
                        </div>
                    </div>
                    <button class="primary-button sale-save-button" id="saveSaleButton" type="button">
                        حفظ الفاتورة
                    </button>
                </div>
            </div>
        </div>
    `;

    let saleItems = [];
    let lastCeramicQtySource = "carton";
    let syncingQty = false;
    const inferredCeramicRatios = new Map();

    const saleProduct = document.getElementById("saleProduct");
    const saleUnitPrice = document.getElementById("saleUnitPrice");
    const ceramicUnitField = document.getElementById("ceramicUnitField");
    const ceramicSaleUnit = document.getElementById("ceramicSaleUnit");
    const regularQtyField = document.getElementById("regularQtyField");
    const saleQuantityLabel = document.getElementById("saleQuantityLabel");
    const saleUnitPriceLabel = document.getElementById("saleUnitPriceLabel");
    const saleSearchInput = document.getElementById("saleProductSearch");
    const saleDropdown = document.getElementById("saleProductDropdown");

    const getCeramicData = () => {
        const sel = saleProduct.options[saleProduct.selectedIndex];
        if (!sel) return null;
        const pid = sel.value;
        const saved = inferredCeramicRatios.get(pid) || {};
        const tilesCartonRaw = Number(sel.dataset.tilesCarton || 0);
        return {
            pid,
            price: Number(sel.dataset.price || 0),
            tilesCarton: tilesCartonRaw > 0 ? tilesCartonRaw : (Number(saved.tilesCarton || 0)),
            length: Number(sel.dataset.tileLength || 0),
            width: Number(sel.dataset.tileWidth || 0),
            category: sel.dataset.category || "",
            value: sel.value,
            inferred: tilesCartonRaw <= 0 && !!saved.tilesCarton
        };
    };

    const saveInferredTileRatio = (tilesCarton) => {
        const d = getCeramicData();
        if (!d || !d.pid) return;
        if (!tilesCarton || !Number.isFinite(tilesCarton) || tilesCarton <= 0) return;
        const rounded = Number.isInteger(tilesCarton) ? tilesCarton : Math.round(tilesCarton * 100) / 100;
        inferredCeramicRatios.set(d.pid, { tilesCarton: rounded });
    };

    const syncCeramicPrices = () => {
        const d = getCeramicData();
        if (!d) {
            saleUnitPrice.value = "0";
            return;
        }
        const isCeramic = d.category === "سيراميك" && !d.value.startsWith("set-");
        const tileArea = d.length && d.width ? (d.length * d.width) / 10000 : 0;
        const cartonArea = tileArea * (d.tilesCarton || 0);

        let finalPrice = d.price;
        if (isCeramic) {
            if (lastCeramicQtySource === "tile" && (d.tilesCarton || 0) > 0) {
                finalPrice = d.price / d.tilesCarton;
            } else if (lastCeramicQtySource === "meter" && cartonArea > 0) {
                finalPrice = d.price / cartonArea;
            } else {
                finalPrice = d.price;
            }
        }
        saleUnitPrice.value = formatMoney(finalPrice);
    };

    const syncCeramicQtyFrom = (source) => {
        if (syncingQty) return;
        syncingQty = true;
        try {
            lastCeramicQtySource = source;
            const d = getCeramicData();
            const tileArea = d && d.length && d.width ? (d.length * d.width) / 10000 : 0;
            const cartonArea = tileArea * (d?.tilesCarton || 0);

            const cartonEl = document.getElementById("saleQtyCarton");
            const tileEl = document.getElementById("saleQtyTile");
            const meterEl = document.getElementById("saleQtyMeter");

            let cartonV = Math.max(0, Number(cartonEl?.value || 0));
            let tileV = Math.max(0, Number(tileEl?.value || 0));
            let meterV = Math.max(0, Number(meterEl?.value || 0));

            let effectiveTiles = d?.tilesCarton || 0;
            if (!effectiveTiles || effectiveTiles <= 0) {
                if (cartonV > 0 && tileV > 0) {
                    effectiveTiles = tileV / cartonV;
                    saveInferredTileRatio(effectiveTiles);
                } else if (tileV > 0 && meterV > 0 && tileArea > 0) {
                    const impliedCartonsMeter = meterV / (tileV * tileArea);
                    if (impliedCartonsMeter > 0) {
                    }
                }
            }
            if ((d?.tilesCarton || 0) <= 0 && effectiveTiles <= 0) {
                if (cartonV > 0 && tileV > 0) {
                    effectiveTiles = tileV / cartonV;
                    saveInferredTileRatio(effectiveTiles);
                }
            }
            const effectiveCartonArea = tileArea * (effectiveTiles || 0);

            if (source === "carton") {
                if (effectiveTiles > 0) {
                    tileV = cartonV * effectiveTiles;
                    if (tileEl) tileEl.value = tileV === 0 ? "" : (Number.isInteger(tileV) ? String(tileV) : tileV.toFixed(2));
                }
                if (effectiveCartonArea > 0) {
                    meterV = cartonV * effectiveCartonArea;
                } else if (tileArea > 0 && effectiveTiles > 0) {
                    meterV = cartonV * effectiveTiles * tileArea;
                } else if (tileV > 0 && tileArea > 0) {
                    meterV = tileV * tileArea;
                }
                if (meterEl) meterEl.value = meterV === 0 ? "" : meterV.toFixed(2);
            } else if (source === "tile") {
                if (effectiveTiles > 0) {
                    cartonV = tileV / effectiveTiles;
                    if (cartonEl) cartonEl.value = cartonV === 0 ? "" : cartonV.toFixed(2);
                } else if (cartonV > 0) {
                    effectiveTiles = tileV / cartonV;
                    saveInferredTileRatio(effectiveTiles);
                }
                if (tileArea > 0) {
                    meterV = tileV * tileArea;
                    if (meterEl) meterEl.value = meterV === 0 ? "" : meterV.toFixed(2);
                }
            } else if (source === "meter") {
                if (effectiveCartonArea > 0) {
                    cartonV = meterV / effectiveCartonArea;
                } else if (tileArea > 0 && effectiveTiles > 0) {
                    cartonV = meterV / (tileArea * effectiveTiles);
                }
                if (cartonEl) {
                    if (cartonV > 0 || (meterEl && Number(meterEl.value || 0) > 0)) {
                        cartonEl.value = cartonV === 0 ? "" : cartonV.toFixed(2);
                    }
                }
                if (tileArea > 0) {
                    tileV = meterV / tileArea;
                    if (tileEl) tileEl.value = tileV === 0 ? "" : (Number.isInteger(tileV) ? String(tileV) : tileV.toFixed(2));
                }
                if (!effectiveTiles || effectiveTiles <= 0) {
                    if (tileV > 0 && cartonV > 0) {
                        effectiveTiles = tileV / cartonV;
                        saveInferredTileRatio(effectiveTiles);
                    }
                }
            }
            syncCeramicPrices();
        } catch (err) {
            console.error("syncCeramicQtyFrom error:", err);
        } finally {
            syncingQty = false;
        }
    };

    const updateProductControls = () => {
        const sel = saleProduct.options[saleProduct.selectedIndex];
        if (!sel || !sel.value) {
            ceramicUnitField.style.display = "none";
            regularQtyField.style.display = "";
            saleQuantityLabel.textContent = "الكمية";
            saleUnitPriceLabel.textContent = "سعر البيع";
            saleUnitPrice.value = "0";
            return;
        }
        const category = sel.dataset.category || "";
        const isCeramic = category === "سيراميك" && !sel.value.startsWith("set-");
        if (isCeramic) {
            ceramicUnitField.style.display = "";
            regularQtyField.style.display = "none";
            lastCeramicQtySource = "carton";
            const cartonEl = document.getElementById("saleQtyCarton");
            const tileEl = document.getElementById("saleQtyTile");
            const meterEl = document.getElementById("saleQtyMeter");
            if (cartonEl) { cartonEl.value = ""; }
            if (tileEl) { tileEl.value = ""; }
            if (meterEl) { meterEl.value = ""; }
            syncCeramicPrices();
            setTimeout(() => cartonEl?.focus(), 30);
        } else {
            ceramicUnitField.style.display = "none";
            regularQtyField.style.display = "";
            const unit = sel.dataset.unit || "قطعة";
            saleQuantityLabel.textContent = unit === "متر" ? "الكمية (متر)" : `الكمية (${unit})`;
            saleUnitPriceLabel.textContent = unit === "متر" ? "سعر البيع للمتر" : `سعر البيع للوحدة (${unit})`;
            document.getElementById("saleQuantity").value = "1";
            syncCeramicPrices();
        }
    };

    // Setup Autocomplete لصفحة المبيعات
    (function setupSaleAutocomplete() {
        const options = Array.from(saleProduct.options);
        const searchable = options
            .filter((opt) => opt.value)
            .map((opt, _i) => ({
                value: opt.value,
                label: opt.textContent.trim(),
                dataset: Object.assign({}, opt.dataset)
            }));

        const filterResults = (q) => {
            if (!window.elSharqSearch.normalize(q)) return searchable.slice(0, 30);
            return searchable.filter((item) => window.elSharqSearch.matches(
                q,
                item.label,
                item.dataset?.category,
                item.dataset?.internalCode,
                item.dataset?.barcode
            )).slice(0, 50);
        };

        const renderDropdown = (items) => {
            if (!items || items.length === 0) {
                saleDropdown.innerHTML = `
                    <div class="autocomplete-empty">
                        <strong>لا يوجد نتائج مطابقة للبحث</strong>
                        <span>جرب كلمة أخرى</span>
                    </div>`;
                saleDropdown.style.display = "";
                return;
            }
            saleDropdown.innerHTML = items.map((it, idx) => {
                const isSet = it.dataset?.isSet === "1" || it.value.startsWith("set-");
                const price = Number(it.dataset?.price || 0);
                const cat = it.dataset?.category || "";
                let priceHtml = "";
                if (cat === "سيراميك" && !isSet) {
                    const tilesCarton = Number(it.dataset?.tilesCarton || 0);
                    const length = Number(it.dataset?.tileLength || 0);
                    const width = Number(it.dataset?.tileWidth || 0);
                    const tileArea = length && width ? (length * width) / 10000 : 0;
                    const cartonArea = tileArea * tilesCarton;
                    const tileP = tilesCarton > 0 ? price / tilesCarton : 0;
                    const meterP = cartonArea > 0 ? price / cartonArea : 0;
                    priceHtml = `
                        <div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end;">
                            <span class="autocomplete-price" style="color:#f59e0b;">📦 ${formatMoney(price)} كرتونة</span>
                            <span style="font-size:11px;color:#94a3b8;">
                                <span style="color:var(--accent)">🧱 ${formatMoney(tileP)} بلاطة</span>
                                <span style="margin:0 4px;">·</span>
                                <span style="color:var(--success)">🏠 ${formatMoney(meterP)} م²</span>
                            </span>
                        </div>`;
                } else {
                    const priceUnit = it.dataset?.unit === "متر" ? " ج.م/متر" : " ج.م";
                    priceHtml = `<span class="autocomplete-price">${formatMoney(price)}${priceUnit}</span>`;
                }
                return `
                    <div class="autocomplete-item" data-value="${escapeAttr(it.value)}" tabindex="${idx}">
                        <div class="autocomplete-item-main">
                            ${isSet ? '<span class="product-set-badge">[طقم]</span>' : ""}
                            <strong>${escapeHtml(it.label)}</strong>
                        </div>
                        <div class="autocomplete-item-meta">
                            <span class="autocomplete-cat">${escapeHtml(cat || "—")}</span>
                            ${priceHtml}
                        </div>
                    </div>`;
            }).join("");
            saleDropdown.style.display = "";

            saleDropdown.querySelectorAll(".autocomplete-item").forEach((el) => {
                el.addEventListener("click", () => {
                    const v = el.getAttribute("data-value");
                    saleProduct.value = v;
                    saleSearchInput.value = searchable.find((x) => x.value === v)?.label || "";
                    saleDropdown.style.display = "none";
                    updateProductControls();
                });
            });
        };

        saleSearchInput.addEventListener("focus", () => renderDropdown(filterResults(saleSearchInput.value)));
        saleSearchInput.addEventListener("input", () => renderDropdown(filterResults(saleSearchInput.value)));
        document.addEventListener("click", (e) => {
            if (!saleSearchInput.contains(e.target) && !saleDropdown.contains(e.target)) {
                saleDropdown.style.display = "none";
            }
        });
    })();

    (function attachPermanentCeramicQtyListeners() {
        const cleanAndSync = (source) => {
            if (syncingQty) return;
            const ids = { carton: "saleQtyCarton", tile: "saleQtyTile", meter: "saleQtyMeter" };
            const el = document.getElementById(ids[source]);
            if (!el) return;
            let raw = el.value;
            if (typeof raw !== "string") raw = String(raw || "");
            if (source === "tile") {
                raw = raw.replace(/[^0-9]/g, "");
            } else {
                const firstDot = raw.indexOf(".");
                const intsPart = firstDot === -1 ? raw : raw.slice(0, firstDot);
                const decsPart = firstDot === -1 ? null : raw.slice(firstDot + 1);
                const ints = intsPart.replace(/[^0-9]/g, "");
                const decs = decsPart === null ? null : decsPart.replace(/[^0-9]/g, "");
                if (decs === null) {
                    raw = ints;
                } else {
                    raw = ints ? (ints + "." + decs) : (decs ? "0." + decs : "");
                }
            }
            if (raw !== el.value) {
                syncingQty = true;
                try { el.value = raw; } finally { syncingQty = false; }
            }
            syncCeramicQtyFrom(source);
        };
        document.getElementById("saleQtyCarton")?.addEventListener("input", () => cleanAndSync("carton"));
        document.getElementById("saleQtyTile")?.addEventListener("input", () => cleanAndSync("tile"));
        document.getElementById("saleQtyMeter")?.addEventListener("input", () => cleanAndSync("meter"));
    })();

    saleProduct?.addEventListener("change", updateProductControls);
    ceramicSaleUnit?.addEventListener("change", updateProductControls);

    setTimeout(updateProductControls, 0);

    const renderSaleItems = () => {
        const body = document.getElementById("saleItemsBody");
        if (!body) return;

        if (saleItems.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="table-empty">
                            <div>🧾</div>
                            <strong>لم تتم إضافة أصناف</strong>
                            <span>اختر منتجًا من الأعلى لإضافته للفاتورة</span>
                        </div>
                    </td>
                </tr>
            `;
            updateSaleTotals();
            return;
        }

        body.innerHTML = saleItems
            .map((item, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>
                        ${item.isSet ? `<span class="product-set-badge">[طقم]</span>` : ""}
                        <strong>${escapeHtml(item.name)}</strong>
                    </td>
                    <td>${escapeHtml(item.unit)}</td>
                    <td>${
                        item.displayQty !== undefined
                            ? (Number.isInteger(item.displayQty) ? item.displayQty : item.displayQty.toFixed(2))
                            : (Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(2))
                    }</td>
                    <td>${formatMoney(item.unitPrice)} ج.م</td>
                    <td>${formatMoney(item.total)} ج.م</td>
                    <td>
                        <button type="button" class="delete-sale-item" data-index="${index}">
                            حذف
                        </button>
                    </td>
                </tr>
            `)
            .join("");

        body.querySelectorAll(".delete-sale-item").forEach((button) => {
            button.addEventListener("click", () => {
                const index = Number(button.dataset.index);
                saleItems.splice(index, 1);
                renderSaleItems();
            });
        });

        updateSaleTotals();
    };

    document.getElementById("addSaleItemButton")?.addEventListener("click", () => {
        const rawValue = saleProduct.value;
        if (!rawValue) {
            alert("اختر المنتج أولًا.");
            return;
        }
        const selected = saleProduct.options[saleProduct.selectedIndex];
        const category = selected.dataset.category || "";
        const isSet = selected.dataset.isSet === "1";
        const isCeramic = category === "سيراميك" && !isSet && !rawValue.startsWith("set-");
        const cData = getCeramicData();
        const tilesCarton = isCeramic ? (cData?.tilesCarton || Number(selected.dataset.tilesCarton || 0)) : Number(selected.dataset.tilesCarton || 0);
        const length = Number(selected.dataset.tileLength || 0);
        const width = Number(selected.dataset.tileWidth || 0);
        const tileArea = length && width ? (length * width) / 10000 : 0;
        const cartonArea = tileArea * tilesCarton;

        const cartonQtyRaw = Number(document.getElementById("saleQtyCarton")?.value || 0);
        const tileQtyRaw = Number(document.getElementById("saleQtyTile")?.value || 0);
        const meterQtyRaw = Number(document.getElementById("saleQtyMeter")?.value || 0);

        let ceramicSource = null;
        if (isCeramic) {
            if (cartonQtyRaw > 0 && tileQtyRaw > 0 && (!tilesCarton || tilesCarton <= 0)) {
                const inferred = tileQtyRaw / cartonQtyRaw;
                saveInferredTileRatio(inferred);
            }
            const _afterC = getCeramicData();
            const effTiles = _afterC?.tilesCarton || 0;
            const effCartonArea = tileArea * effTiles;
            if (cartonQtyRaw > 0 && !tileQtyRaw && effTiles > 0 && !meterQtyRaw) {
                const t = cartonQtyRaw * effTiles;
                document.getElementById("saleQtyTile").value = Number.isInteger(t) ? String(t) : t.toFixed(2);
                if (effCartonArea > 0) {
                    const m = cartonQtyRaw * effCartonArea;
                    document.getElementById("saleQtyMeter").value = m.toFixed(2);
                } else if (tileArea > 0) {
                    const m = t * tileArea;
                    document.getElementById("saleQtyMeter").value = m.toFixed(2);
                }
            } else if (tileQtyRaw > 0 && !cartonQtyRaw && effTiles > 0 && !meterQtyRaw) {
                const c = tileQtyRaw / effTiles;
                document.getElementById("saleQtyCarton").value = c.toFixed(2);
                if (tileArea > 0) {
                    const m = tileQtyRaw * tileArea;
                    document.getElementById("saleQtyMeter").value = m.toFixed(2);
                }
            } else if (meterQtyRaw > 0 && !cartonQtyRaw && !tileQtyRaw && tileArea > 0) {
                const t = meterQtyRaw / tileArea;
                document.getElementById("saleQtyTile").value = Number.isInteger(t) ? String(t) : t.toFixed(2);
                if (effTiles > 0) {
                    const c = meterQtyRaw / (tileArea * effTiles);
                    document.getElementById("saleQtyCarton").value = c.toFixed(2);
                }
            }
            const cartonEl = document.getElementById("saleQtyCarton");
            const tileEl = document.getElementById("saleQtyTile");
            const meterEl = document.getElementById("saleQtyMeter");
            const cq = Number(cartonEl?.value || 0);
            const tq = Number(tileEl?.value || 0);
            const mq = Number(meterEl?.value || 0);
            const filled = [];
            if (cq > 0) filled.push({ s: "carton", q: cq });
            if (tq > 0) filled.push({ s: "tile", q: tq });
            if (mq > 0) filled.push({ s: "meter", q: mq });
            if (filled.length === 0) {
                alert("أدخل كمية صحيحة في أي خانة (كرتون / بلاط / متر).");
                return;
            }
            if (filled.length === 1) {
                ceramicSource = filled[0].s;
                lastCeramicQtySource = ceramicSource;
                syncCeramicQtyFrom(ceramicSource);
            } else {
                ceramicSource = lastCeramicQtySource;
                if (!filled.find(f => f.s === ceramicSource)) ceramicSource = filled[0].s;
            }
            const fresh = getCeramicData();
            if (cq > 0 && tq > 0 && !(fresh?.tilesCarton > 0)) {
                saveInferredTileRatio(tq / cq);
            }
        }

        let userQty;
        let _cq = Number(document.getElementById("saleQtyCarton")?.value || 0);
        let _tq = Number(document.getElementById("saleQtyTile")?.value || 0);
        let _mq = Number(document.getElementById("saleQtyMeter")?.value || 0);
        if (isCeramic) {
            if (ceramicSource === "tile") userQty = _tq;
            else if (ceramicSource === "meter") userQty = _mq;
            else userQty = _cq;
        } else {
            userQty = Number(document.getElementById("saleQuantity").value || 0);
        }
        const unitPrice = Number(saleUnitPrice.value || 0);

        if (!userQty || userQty <= 0) {
            alert("أدخل كمية صحيحة (بأي خانة للسيراميك).");
            return;
        }
        if (unitPrice < 0 || Number.isNaN(unitPrice)) {
            alert("أدخل سعر بيع صحيح.");
            return;
        }

        const liveCeramicData = getCeramicData();
        const liveTilesCarton = liveCeramicData?.tilesCarton || tilesCarton;
        if (isCeramic) {
            const source = ceramicSource || lastCeramicQtySource;
            const hasTileData = (liveTilesCarton > 0) && (length > 0) && (width > 0);
            if ((source === "tile" || _tq > 0) && !liveTilesCarton) {
                alert("⚠️ هذا المنتج ما فيه بيانات 'عدد البلاطات بالكرتونة'.\nمن فضلك عدل بيانات المنتج أولًا أو اكتب الكمية في كرتون + بلاط يدوي مرة عشان السيستم يتعلم النسبة.");
                return;
            }
            if ((source === "meter" || _mq > 0) && (!length || !width)) {
                alert("⚠️ هذا المنتج ما فيه بيانات مقاسات البلاطة (الطول+العرض).\nمن فضلك عدل بيانات المنتج أولًا.");
                return;
            }
        }

        let cartonQty = userQty;
        let displayQty;
        let displayUnit;
        let displayUnitPrice;
        let stockQty;

        if (isCeramic) {
            const source = ceramicSource || lastCeramicQtySource;
            const cartonP = Number(selected.dataset.price || 0);
            const tileP = liveTilesCarton > 0 ? Math.round((cartonP / liveTilesCarton) * 100) / 100 : 0;
            const liveCartonArea = tileArea * liveTilesCarton;
            const meterP = liveCartonArea > 0 ? Math.round((cartonP / liveCartonArea) * 100) / 100 : 0;
            let finalSource = source;
            if (finalSource === "carton" && _cq === 0 && _tq > 0) finalSource = "tile";
            if (finalSource === "carton" && _cq === 0 && _mq > 0) finalSource = "meter";
            lastCeramicQtySource = finalSource;
            if (finalSource === "tile") {
                displayUnit = "بلاطة";
                displayQty = _tq > 0 ? Math.round(_tq) : Math.round(_cq * (liveTilesCarton || 1)) || Math.round(_mq / ((tileArea || 0.01)));
                displayUnitPrice = Math.round(tileP * 100) / 100;
                stockQty = liveTilesCarton > 0 ? displayQty / liveTilesCarton : 0;
            } else if (finalSource === "meter") {
                displayUnit = "متر";
                displayQty = _mq > 0
                    ? Math.round(_mq * 100) / 100
                    : (_tq > 0 && tileArea > 0
                        ? Math.round(_tq * tileArea * 100) / 100
                        : (liveCartonArea > 0 ? Math.round(_cq * liveCartonArea * 100) / 100 : _mq));
                displayUnitPrice = Math.round(meterP * 100) / 100;
                stockQty = liveCartonArea > 0 ? displayQty / liveCartonArea : 0;
            } else {
                displayUnit = "كرتونة";
                displayQty = _cq > 0
                    ? Math.round(_cq * 100) / 100
                    : (_tq > 0 && liveTilesCarton > 0
                        ? Math.round((_tq / liveTilesCarton) * 100) / 100
                        : (liveCartonArea > 0 ? Math.round((_mq / liveCartonArea) * 100) / 100 : _cq));
                displayUnitPrice = Math.round(cartonP * 100) / 100;
                stockQty = displayQty;
            }
        } else {
            displayUnit = selected.dataset.unit || "قطعة";
            displayQty = userQty;
            displayUnitPrice = unitPrice;
            stockQty = userQty;
        }

        const lineTotal = Math.round(displayQty * displayUnitPrice * 100) / 100;

        if (isSet && rawValue.startsWith("set-")) {
            const setId = Number(rawValue.replace("set-", ""));
            const set = productSets.find((s) => Number(s.id) === setId);
            if (set && Array.isArray(set.items)) {
                set.items.forEach((piece) => {
                    if (!piece.product_id) return;
                    const pr = products.find(
                        (p) => Number(p.id) === Number(piece.product_id)
                    );
                    if (!pr) return;
                    const pieceQty = stockQty * Number(piece.quantity || 1);
                    const pricePer =
                        set.sale_price > 0 && set.items.length
                            ? Math.round((lineTotal / set.items.reduce((s, it) => s + Number(it.quantity || 1), 0)) *
                              Number(piece.quantity || 1) * 100) / 100
                            : Math.round(Number(pr.sale_price || 0) * Number(piece.quantity || 1) * 100) / 100;

                    const existing = saleItems.find(
                        (it) => Number(it.productId) === Number(pr.id)
                    );
                    if (existing) {
                        existing.quantity += pieceQty;
                        existing.total = Math.round(existing.quantity * existing.unitPrice * 100) / 100;
                    } else {
                        saleItems.push({
                            productId: Number(pr.id),
                            name: pr.category_name ? `${pr.category_name} ${pr.name}` : pr.name,
                            unit: pr.unit || "قطعة",
                            quantity: pieceQty,
                            unitPrice: Math.round((pricePer / pieceQty) * 100) / 100,
                            total: pricePer,
                            isSet: false,
                            ceramicUnitNote: ""
                        });
                    }
                });
            }
        } else {
            const productId = Number(rawValue);
            const existing = saleItems.find(
                (it) =>
                    Number(it.productId) === productId &&
                    (it.ceramicDisplayUnit || "") === displayUnit &&
                    !it.isSet
            );
            if (existing) {
                existing.displayQty = displayUnit === "بلاطة"
                    ? Math.round(Number(existing.displayQty || 0) + displayQty)
                    : Math.round((Number(existing.displayQty || 0) + displayQty) * 100) / 100;
                existing.stockQty = Number(existing.stockQty || 0) + stockQty;
                existing.quantity = existing.displayQty;
                existing.unitPrice = displayUnitPrice;
                existing.total = Math.round(existing.displayQty * displayUnitPrice * 100) / 100;
            } else {
                saleItems.push({
                    productId,
                    name: selected.textContent.trim().split("—")[0].trim(),
                    unit: displayUnit,
                    quantity: displayQty,
                    unitPrice: displayUnitPrice,
                    total: lineTotal,
                    isSet: false,
                    ceramicDisplayUnit: displayUnit,
                    displayQty,
                    stockQty
                });
            }
        }

        saleProduct.value = "";
        document.getElementById("saleQuantity").value = "1";
        const qCarton = document.getElementById("saleQtyCarton");
        const qTile = document.getElementById("saleQtyTile");
        const qMeter = document.getElementById("saleQtyMeter");
        if (qCarton) qCarton.value = "";
        if (qTile) qTile.value = "";
        if (qMeter) qMeter.value = "";
        saleSearchInput.value = "";
        saleUnitPrice.value = "0";
        ceramicUnitField.style.display = "none";
        regularQtyField.style.display = "";
        lastCeramicQtySource = "carton";
        renderSaleItems();
    });

    document.getElementById("plumbingDiscount")?.addEventListener("input", updateSaleTotals);
    document.getElementById("salePaid")?.addEventListener("input", updateSaleTotals);

    function updateSaleTotals() {
        const subtotal = saleItems.reduce((sum, item) => sum + item.total, 0);
        const plumbingItems = saleItems.filter((item) => {
            const p = products.find(
                (pr) => Number(pr.id) === Number(item.productId)
            );
            return p && p.category_name === "سباكة";
        });
        const plumbingSubtotal = plumbingItems.reduce((s, i) => s + i.total, 0);
        let discountPercent = Number(
            document.getElementById("plumbingDiscount")?.value || 0
        );
        if (discountPercent < 0) discountPercent = 0;
        if (discountPercent > 100) discountPercent = 100;
        const discountAmount = (plumbingSubtotal * discountPercent) / 100;
        const grandTotal = subtotal - discountAmount;
        const paid = Number(document.getElementById("salePaid")?.value || 0);
        const remaining = Math.max(grandTotal - paid, 0);

        document.getElementById("saleSubtotal").textContent = `${formatMoney(subtotal)} ج.م`;
        document.getElementById("plumbingDiscountAmount").textContent = `${formatMoney(
            discountAmount
        )} ج.م`;
        document.getElementById("saleGrandTotal").textContent = `${formatMoney(grandTotal)} ج.م`;
        document.getElementById("saleRemaining").textContent = `${formatMoney(remaining)} ج.م`;
    }

    async function loadSaleIntoForm(id) {
        try {
            const sale = await window.elSharq.getSaleById(id);
            editingSaleId = sale.id;
            document.getElementById("saleFormTitle").textContent = `تعديل فاتورة بيع رقم ${
                sale.invoice_number || sale.id
            }`;
            document.getElementById("saleInvoiceNumberDisplay").textContent =
                sale.invoice_number || sale.id;
            document.getElementById("saveSaleButton").textContent = "حفظ التعديلات";
            document.getElementById("saleCustomer").value = sale.customer_name || "";
            document.getElementById("saleLocation").value = sale.location || "المعرض";
            document.getElementById("saleNotes").value = sale.notes || "";
            document.getElementById("plumbingDiscount").value =
                sale.plumbing_discount_percent || 0;
            document.getElementById("salePaid").value = sale.paid || 0;
            saleItems = (sale.items || []).map((i) => {
                const productUnit = i.unit || "قطعة";
                const q = Number(i.quantity);
                const up = Number(i.unitPrice || i.unit_price);
                const isCeramicLike = productUnit === "كرتونة" || productUnit === "بلاطة" || productUnit === "متر";
                const disp = isCeramicLike ? getCeramicDisplayQty(i) : null;
                const displayUnit = disp ? disp.unit : productUnit;
                const displayQty = disp ? disp.qty : (Number.isInteger(q) ? q : Math.round(q * 100) / 100);
                return {
                    productId: Number(i.productId || i.product_id),
                    name: i.name,
                    unit: displayUnit,
                    quantity: displayQty,
                    unitPrice: Math.round(up * 100) / 100,
                    total: Math.round(Number(i.total || 0) * 100) / 100,
                    isSet: false,
                    ceramicDisplayUnit: isCeramicLike ? displayUnit : "",
                    ceramicUnitNote: "",
                    displayQty: displayQty,
                    stockQty: q
                };
            });
            renderSaleItems();
            document.querySelector(".sales-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (e) {
            console.error(e);
            alert(e.message || "خطأ في تحميل الفاتورة");
        }
    }

    function resetSaleForm() {
        editingSaleId = null;
        saleItems = [];
        document.getElementById("saleFormTitle").textContent = "فاتورة بيع جديدة";
        document.getElementById("saleInvoiceNumberDisplay").textContent = "تلقائي";
        document.getElementById("saveSaleButton").textContent = "حفظ الفاتورة";
        document.getElementById("saleCustomer").value = "";
        document.getElementById("saleLocation").value = "المعرض";
        document.getElementById("saleNotes").value = "";
        document.getElementById("plumbingDiscount").value = "0";
        document.getElementById("salePaid").value = "0";
        renderSaleItems();
    }

    document.getElementById("newSaleButton")?.addEventListener("click", resetSaleForm);

    document.getElementById("saveSaleButton")?.addEventListener("click", async () => {
        if (saleItems.length === 0) {
            alert("يجب إضافة صنف واحد على الأقل للفاتورة");
            return;
        }
        const customerName = document.getElementById("saleCustomer")?.value.trim() || "";
        const location = document.getElementById("saleLocation")?.value || "المعرض";
        const notes = document.getElementById("saleNotes")?.value.trim() || "";
        let plumbingDiscount = Number(document.getElementById("plumbingDiscount")?.value || 0);
        const paid = Number(document.getElementById("salePaid")?.value || 0);
        if (plumbingDiscount < 0) plumbingDiscount = 0;
        if (plumbingDiscount > 100) plumbingDiscount = 100;
        if (paid < 0 || Number.isNaN(paid)) {
            alert("أدخل مبلغ مدفوع صحيح.");
            return;
        }

        const saveButton = document.getElementById("saveSaleButton");
        const isNewSale = !editingSaleId;
        let printWindow;
        if (isNewSale) {
            try {
                printWindow = window.elSharqInvoicePrint.open();
            } catch (error) {
                alert(error?.message || "تعذر فتح نافذة الطباعة");
                return;
            }
        }
        let invoiceSaved = false;
        try {
            saveButton.disabled = true;
            saveButton.textContent = editingSaleId ? "جاري حفظ التعديلات..." : "جاري حفظ الفاتورة...";

            const payload = {
                customer_name: customerName,
                location,
                items: saleItems.map((item) => {
                    const stockQ = Number(item.stockQty ?? item.quantity ?? 0);
                    let baseUnitPrice = Number(item.unitPrice);
                    if (item.ceramicDisplayUnit && item.stockQty !== undefined && item.displayQty > 0) {
                        baseUnitPrice = item.total / stockQ;
                    }
                    return {
                        product_id: Number(item.productId),
                        quantity: stockQ,
                        unit_price: baseUnitPrice
                    };
                }),
                plumbing_discount_percent: plumbingDiscount,
                paid,
                notes
            };

            let result;
            if (editingSaleId) {
                result = await window.elSharq.updateSale(editingSaleId, payload);
            } else {
                result = await window.elSharq.createSale(payload);
            }
            if (!result?.success) throw new Error("فشل الحفظ");
            invoiceSaved = true;

            if (isNewSale) {
                try {
                    const sale = await window.elSharq.getSaleById(result.saleId);
                    const displaySale = {
                        ...sale,
                        type: sale.sale_type === "plumbing_order" ? "plumbing_order" : "sale",
                        partyName: sale.customer_name || "عميل نقدي",
                        discount: Number(sale.plumbing_discount_amount || 0) + Number(sale.general_discount_amount || 0),
                        items: sale.items.map((item) => {
                            const displayQuantity = getCeramicDisplayQty(item);
                            return {
                                ...item,
                                displayQuantity: displayQuantity.qty,
                                displayUnit: displayQuantity.unit,
                                unitPrice: item.unitPrice || item.unit_price
                            };
                        })
                    };
                    window.elSharqInvoicePrint.print(printWindow, displaySale);
                } catch (printError) {
                    if (printWindow && !printWindow.closed) printWindow.close();
                    alert(`تم حفظ الفاتورة ${result.invoiceNumber}، لكن تعذرت طباعتها: ${printError?.message || "خطأ غير معروف"}`);
                }
            } else {
                alert(
                    `تم تعديل الفاتورة بنجاح\nرقم الفاتورة: ${result.invoiceNumber}\nالإجمالي: ${formatMoney(result.total)} ج.م`
                );
            }

            resetSaleForm();
            await renderLastInvoicesPanel(
                "lastInvoicesPanel",
                "normal",
                "sales",
                loadSaleIntoForm
            );
        } catch (error) {
            console.error("Save sale error:", error);
            if (!invoiceSaved && printWindow && !printWindow.closed) printWindow.close();
            alert(invoiceSaved
                ? `تم حفظ الفاتورة بنجاح، لكن تعذر تحديث الصفحة: ${error?.message || "خطأ غير معروف"}`
                : error?.message || "حدث خطأ أثناء حفظ الفاتورة");
        } finally {
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.textContent = editingSaleId ? "حفظ التعديلات" : "حفظ الفاتورة";
            }
        }
    });

    renderSaleItems();
    await renderLastInvoicesPanel("lastInvoicesPanel", "normal", "sales", loadSaleIntoForm);
    try {
        const today = getLocalDateString();
        const report = await window.elSharq.getReportSummary({ from: today, to: today });
        const cards = dashboard.querySelectorAll(".sales-summary-grid .stat-card strong");
        if (cards[0]) cards[0].textContent = String(report.sales.count);
        if (cards[1]) cards[1].textContent = `${formatMoney(report.sales.total)} ج.م`;
        if (cards[2]) cards[2].textContent = `${formatMoney(report.sales.profit)} ج.م`;
    } catch (error) {
        console.error("Sales summary loading error:", error);
        dashboard.insertAdjacentHTML("afterbegin", `<div class="product-form-message error">تعذر تحميل ملخص المبيعات: ${escapeHtml(error?.message || "خطأ غير معروف")}</div>`);
    }
}

async function showPlumbingOrderPage() {
    const dashboard = getDashboard();
    if (!dashboard) return;

    let products = [];
    let plumbingProducts = [];
    try {
        products = await window.elSharq.getProducts();
        plumbingProducts = products.filter((p) => Number(p.active) === 1 && p.category_name === "سباكة");
    } catch (error) {
        console.error("Plumbing products error:", error);
        dashboard.innerHTML = `<div class="page-header"><h2>طلبات السباكة</h2></div><div class="product-form-message error">تعذر تحميل منتجات السباكة: ${escapeHtml(error?.message || "خطأ غير معروف")}</div>`;
        return;
    }

    let editingSaleId = null;

    dashboard.innerHTML = `
        <div class="plumbing-order-page">
            <div class="page-header">
                <div>
                    <span class="eyebrow-header">🔧 طلبات السباكة</span>
                    <h2>طلبات السباكة</h2>
                    <p>سجّل طلبات التجار واحسب الخصم الخاص بمنتجات السباكة بسهولة.</p>
                </div>
                <button class="primary-button" id="newPlumbingOrderBtn" type="button">
                    + طلبية سباكة جديدة
                </button>
            </div>

            <div id="lastPlumbingOrdersPanel" class="last-invoices-panel"></div>

            <div class="sales-panel">
                <div class="sales-panel-header">
                    <div>
                        <h3 id="plumbingFormTitle">طلبية سباكة للتجار</h3>
                        <span>حدد المنتجات وخصم التاجر والمدفوع</span>
                    </div>
                    <div class="invoice-number">
                        رقم الطلبية:
                        <strong id="plumbingOrderNumberDisplay">تلقائي</strong>
                    </div>
                </div>

                <div class="trader-discount-card">
                    <div class="trader-discount-header">
                        <strong>🏷️ بطاقة خصم التاجر %</strong>
                        <div class="form-field">
                            <label>نسبة الخصم</label>
                            <input type="number" id="traderDiscount" min="0" max="100" step="0.01" value="0"
                                placeholder="مثال: 15">
                        </div>
                    </div>
                </div>

                <div class="sale-info-grid">
                    <div class="form-field">
                        <label>اسم التاجر <span style="color:#ff7a7a">*</span></label>
                        <input type="text" id="plumbingTraderName" placeholder="اسم التاجر - مطلوب">
                    </div>
                    <div class="form-field">
                        <label>مكان البيع</label>
                        <select id="plumbingLocation">
                            <option value="المعرض">المعرض</option>
                            <option value="المخزن">المخزن</option>
                        </select>
                    </div>
                </div>

                <div class="sale-add-product">
                    <div class="form-field" style="position:relative">
                        <label>🔎 البحث بالمنتج (منتجات السباكة فقط - بالاسم أو الكود)</label>
                        <input type="search" id="plumbingProductSearch" placeholder="ابحث بالاسم أو الكود أو أكثر من كلمة...">
                        <div id="plumbingProductDropdown" class="autocomplete-dropdown" style="display:none"></div>
                    </div>
                    <div class="form-field" style="display:none">
                        <label>المنتج (سباكة فقط)</label>
                        <select id="plumbingProduct">
                            <option value="">اختر المنتج</option>
                            ${plumbingProducts
                                .map(
                                    (p) => `
                                <option value="${p.id}"
                                    data-price="${p.sale_price}"
                                    data-unit="${escapeAttr(p.unit || "قطعة")}"
                                    data-category="${escapeAttr(p.category_name || "سباكة")}"
                                    data-internal-code="${escapeAttr(p.internal_code || "")}"
                                    data-barcode="${escapeAttr(p.barcode || "")}">
                                    ${p.category_name ? escapeHtml(p.category_name) + " " : ""}${escapeHtml(p.name)} — ${escapeHtml(p.internal_code || "")}
                                </option>
                            `
                                )
                                .join("")}
                        </select>
                    </div>
                    <div class="form-field">
                        <label id="plumbingQuantityLabel">الكمية</label>
                        <input type="number" id="plumbingQuantity" min="1" step="1" value="1">
                    </div>
                    <div class="form-field">
                        <label id="plumbingUnitPriceLabel">سعر البيع</label>
                        <input type="number" id="plumbingUnitPrice" min="0" step="0.01" value="0">
                    </div>
                    <div class="sale-add-button-wrap">
                        <button class="primary-button" id="addPlumbingItemBtn" type="button">
                            + إضافة للصنف
                        </button>
                    </div>
                </div>

                <div class="sale-items-wrapper">
                    <table class="products-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>المنتج</th>
                                <th>الوحدة</th>
                                <th>الكمية</th>
                                <th>سعر الوحدة</th>
                                <th>الإجمالي</th>
                                <th>إجراء</th>
                            </tr>
                        </thead>
                        <tbody id="plumbingItemsBody">
                            <tr>
                                <td colspan="7">
                                    <div class="table-empty">
                                        <div>🔧</div>
                                        <strong>لم تتم إضافة أصناف</strong>
                                        <span>اختر منتج سباكة من الأعلى</span>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="sale-bottom-grid">
                    <div class="sale-notes">
                        <div class="form-field">
                            <label>ملاحظات</label>
                            <textarea id="plumbingNotes" placeholder="ملاحظات الطلبية..." rows="5"></textarea>
                        </div>
                    </div>
                    <div class="sale-totals">
                        <div class="trader-summary-row">
                            <span>المجموع الفرعي</span>
                            <strong id="plumbingSubtotal">0.00 ج.م</strong>
                        </div>
                        <div class="trader-summary-row discount-value">
                            <span>قيمة خصم التاجر</span>
                            <strong id="plumbingTraderDiscountAmount">0.00 ج.م</strong>
                        </div>
                        <div class="trader-summary-row trader-grand-total">
                            <span>الإجمالي النهائي</span>
                            <strong id="plumbingGrandTotal">0.00 ج.م</strong>
                        </div>
                        <div class="payment-section">
                            <div class="form-field">
                                <label>المدفوع</label>
                                <input type="number" id="plumbingPaid" min="0" step="0.01" value="0">
                            </div>
                            <div class="remaining-box">
                                <span>المتبقي</span>
                                <strong id="plumbingRemaining">0.00 ج.م</strong>
                            </div>
                        </div>
                        <button class="primary-button sale-save-button" id="savePlumbingOrderBtn" type="button">
                            حفظ طلبية السباكة
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    let plumbingItems = [];

    const pProduct = document.getElementById("plumbingProduct");
    const pUnitPrice = document.getElementById("plumbingUnitPrice");
    const pSearchInput = document.getElementById("plumbingProductSearch");
    const pDropdown = document.getElementById("plumbingProductDropdown");
    const pQuantity = document.getElementById("plumbingQuantity");

    const updatePlumbingProduct = () => {
        const sel = pProduct.options[pProduct.selectedIndex];
        pUnitPrice.value = formatMoney(Number(sel?.dataset.price || 0));
        const isMeter = sel?.dataset.unit === "متر";
        pQuantity.min = isMeter ? "0.01" : "1";
        pQuantity.step = isMeter ? "0.01" : "1";
        document.getElementById("plumbingQuantityLabel").textContent =
            isMeter ? "الكمية بالمتر" : "الكمية";
        document.getElementById("plumbingUnitPriceLabel").textContent =
            isMeter ? "سعر البيع للمتر" : "سعر البيع";
    };
    pProduct?.addEventListener("change", updatePlumbingProduct);

    // إعداد البحث التلقائي لطلبية السباكة
    (function setupPlumbingAutocomplete() {
        const options = Array.from(pProduct.options);
        const searchable = options
            .filter((opt) => opt.value)
            .map((opt) => ({
                value: opt.value,
                label: opt.textContent.trim(),
                dataset: Object.assign({}, opt.dataset)
            }));

        const filterResults = (q) => {
            if (!window.elSharqSearch.normalize(q)) return searchable.slice(0, 30);
            return searchable.filter((item) => window.elSharqSearch.matches(
                q,
                item.label,
                item.dataset?.category,
                item.dataset?.internalCode,
                item.dataset?.barcode
            )).slice(0, 50);
        };

        const renderDropdown = (items) => {
            if (!items || items.length === 0) {
                pDropdown.innerHTML = `
                    <div class="autocomplete-empty">
                        <strong>لا يوجد نتائج في منتجات السباكة</strong>
                        <span>جرب كلمة أخرى</span>
                    </div>`;
                pDropdown.style.display = "";
                return;
            }
            pDropdown.innerHTML = items.map((it, idx) => {
                const price = Number(it.dataset?.price || 0);
                const purchase = Math.round(price * (1 - Number(it.dataset?.companyDiscountPercent || 0) / 100) * 100) / 100;
                return `
                    <div class="autocomplete-item" data-value="${escapeAttr(it.value)}" tabindex="${idx}">
                        <div class="autocomplete-item-main">
                            <strong>${escapeHtml(it.label)}</strong>
                        </div>
                        <div class="autocomplete-item-meta">
                            <span class="autocomplete-cat">سباكة</span>
                            <span class="autocomplete-price">ب ${formatMoney(price)}${it.dataset?.unit === "متر" ? " ج.م/متر" : " ج.م"} - تشتري ب ${formatMoney(purchase)}${it.dataset?.unit === "متر" ? " ج.م/متر" : " ج.م"}</span>
                        </div>
                    </div>`;
            }).join("");
            pDropdown.style.display = "";

            pDropdown.querySelectorAll(".autocomplete-item").forEach((el) => {
                el.addEventListener("click", () => {
                    const v = el.getAttribute("data-value");
                    pProduct.value = v;
                    pSearchInput.value = searchable.find((x) => x.value === v)?.label || "";
                    pDropdown.style.display = "none";
                    updatePlumbingProduct();
                });
            });
        };

        pSearchInput.addEventListener("focus", () => renderDropdown(filterResults(pSearchInput.value)));
        pSearchInput.addEventListener("input", () => renderDropdown(filterResults(pSearchInput.value)));
        document.addEventListener("click", (e) => {
            if (!pSearchInput.contains(e.target) && !pDropdown.contains(e.target)) {
                pDropdown.style.display = "none";
            }
        });
    })();

    const renderPlumbingItems = () => {
        const body = document.getElementById("plumbingItemsBody");
        if (!body) return;
        if (plumbingItems.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="table-empty">
                            <div>🔧</div>
                            <strong>لم تتم إضافة أصناف</strong>
                            <span>اختر منتج سباكة من الأعلى</span>
                        </div>
                    </td>
                </tr>
            `;
            updatePlumbingTotals();
            return;
        }
        body.innerHTML = plumbingItems
            .map(
                (item, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td><strong>${escapeHtml(item.name)}</strong></td>
                    <td>${escapeHtml(item.unit)}</td>
                    <td>${Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(2)}</td>
                    <td>${formatMoney(item.unitPrice)} ج.م</td>
                    <td>${formatMoney(item.total)} ج.م</td>
                    <td>
                        <button type="button" class="delete-sale-item" data-index="${index}">
                            حذف
                        </button>
                    </td>
                </tr>
                `
            )
            .join("");
        body.querySelectorAll(".delete-sale-item").forEach((btn) => {
            btn.addEventListener("click", () => {
                plumbingItems.splice(Number(btn.dataset.index), 1);
                renderPlumbingItems();
            });
        });
        updatePlumbingTotals();
    };

    document.getElementById("addPlumbingItemBtn")?.addEventListener("click", () => {
        const productId = Number(pProduct.value || 0);
        if (!productId) {
            alert("اختر المنتج أولًا.");
            return;
        }
        const selected = pProduct.options[pProduct.selectedIndex];
        const quantity = Number(pQuantity.value || 0);
        const unitPrice = Number(pUnitPrice.value || 0);

        if (!quantity || quantity <= 0) {
            alert("أدخل كمية صحيحة.");
            return;
        }
        if (unitPrice < 0 || Number.isNaN(unitPrice)) {
            alert("أدخل سعر بيع صحيح.");
            return;
        }

        const existing = plumbingItems.find((it) => Number(it.productId) === productId);
        if (existing) {
            existing.quantity += quantity;
            existing.total = existing.quantity * existing.unitPrice;
        } else {
            plumbingItems.push({
                productId,
                name: selected.textContent.trim().split("—")[0].trim(),
                unit: selected.dataset.unit || "قطعة",
                quantity,
                unitPrice,
                total: quantity * unitPrice
            });
        }

        pProduct.value = "";
        document.getElementById("plumbingQuantity").value = "1";
        updatePlumbingProduct();
        renderPlumbingItems();
    });

    document.getElementById("traderDiscount")?.addEventListener("input", updatePlumbingTotals);
    document.getElementById("plumbingPaid")?.addEventListener("input", updatePlumbingTotals);

    function updatePlumbingTotals() {
        const subtotal = plumbingItems.reduce((s, i) => s + i.total, 0);
        let discountPct = Number(document.getElementById("traderDiscount")?.value || 0);
        if (discountPct < 0) discountPct = 0;
        if (discountPct > 100) discountPct = 100;
        document.getElementById("traderDiscount").value = discountPct;
        const discountAmount = (subtotal * discountPct) / 100;
        const grandTotal = subtotal - discountAmount;
        const paid = Number(document.getElementById("plumbingPaid")?.value || 0);
        const remaining = Math.max(grandTotal - paid, 0);

        document.getElementById("plumbingSubtotal").textContent = `${formatMoney(subtotal)} ج.م`;
        document.getElementById("plumbingTraderDiscountAmount").textContent = `${formatMoney(
            discountAmount
        )} ج.م`;
        document.getElementById("plumbingGrandTotal").textContent = `${formatMoney(grandTotal)} ج.م`;
        document.getElementById("plumbingRemaining").textContent = `${formatMoney(remaining)} ج.م`;
    }

    async function loadPlumbingOrderIntoForm(id) {
        try {
            const sale = await window.elSharq.getSaleById(id);
            editingSaleId = sale.id;
            document.getElementById("plumbingFormTitle").textContent = `تعديل طلبية سباكة رقم ${
                sale.invoice_number || sale.id
            }`;
            document.getElementById("plumbingOrderNumberDisplay").textContent =
                sale.invoice_number || sale.id;
            document.getElementById("savePlumbingOrderBtn").textContent = "حفظ تعديلات الطلبية";
            document.getElementById("plumbingTraderName").value = sale.customer_name || "";
            document.getElementById("plumbingLocation").value = sale.location || "المعرض";
            document.getElementById("plumbingNotes").value = sale.notes || "";
            document.getElementById("traderDiscount").value = sale.trader_discount_percent || 0;
            document.getElementById("plumbingPaid").value = sale.paid || 0;
            plumbingItems = (sale.items || []).map((i) => {
                const q = Number(i.quantity || 0);
                const up = Number(i.unitPrice || i.unit_price || 0);
                const isCeramicLike = (i.unit || i.product_unit) === "كرتونة" || (i.unit || i.product_unit) === "بلاطة" || (i.unit || i.product_unit) === "متر";
                const disp = isCeramicLike ? getCeramicDisplayQty(i) : null;
                const displayUnit = disp ? disp.unit : (i.unit || "قطعة");
                const displayQty = disp ? disp.qty : (Number.isInteger(q) ? q : Math.round(q * 100) / 100);
                return {
                    productId: Number(i.productId || i.product_id),
                    name: i.name,
                    unit: displayUnit,
                    quantity: displayQty,
                    unitPrice: Math.round(up * 100) / 100,
                    total: Math.round(Number(i.total || 0) * 100) / 100
                };
            });
            renderPlumbingItems();
            document.querySelector(".plumbing-order-page .sales-panel")?.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        } catch (e) {
            alert(e.message || "خطأ في تحميل الطلبية");
        }
    }

    function resetPlumbingForm() {
        editingSaleId = null;
        plumbingItems = [];
        document.getElementById("plumbingFormTitle").textContent = "طلبية سباكة للتجار";
        document.getElementById("plumbingOrderNumberDisplay").textContent = "تلقائي";
        document.getElementById("savePlumbingOrderBtn").textContent = "حفظ طلبية السباكة";
        document.getElementById("plumbingTraderName").value = "";
        document.getElementById("plumbingLocation").value = "المعرض";
        document.getElementById("plumbingNotes").value = "";
        document.getElementById("traderDiscount").value = "0";
        document.getElementById("plumbingPaid").value = "0";
        renderPlumbingItems();
    }

    document.getElementById("newPlumbingOrderBtn")?.addEventListener("click", resetPlumbingForm);

    document.getElementById("savePlumbingOrderBtn")?.addEventListener("click", async () => {
        if (plumbingItems.length === 0) {
            alert("يجب إضافة صنف واحد على الأقل للطلبية");
            return;
        }
        const traderName = document.getElementById("plumbingTraderName")?.value.trim() || "";
        if (!traderName) {
            alert("اسم التاجر مطلوب.");
            document.getElementById("plumbingTraderName")?.classList.add("input-error");
            setTimeout(() => {
                document.getElementById("plumbingTraderName")?.classList.remove("input-error");
            }, 2500);
            return;
        }
        const location = document.getElementById("plumbingLocation")?.value || "المعرض";
        const notes = document.getElementById("plumbingNotes")?.value.trim() || "";
        let traderDiscount = Number(document.getElementById("traderDiscount")?.value || 0);
        if (traderDiscount < 0) traderDiscount = 0;
        if (traderDiscount > 100) traderDiscount = 100;
        const paid = Number(document.getElementById("plumbingPaid")?.value || 0);
        if (paid < 0 || Number.isNaN(paid)) {
            alert("أدخل مبلغ مدفوع صحيح.");
            return;
        }

        const saveButton = document.getElementById("savePlumbingOrderBtn");
        const isNewOrder = !editingSaleId;
        let printWindow;
        if (isNewOrder) {
            try {
                printWindow = window.elSharqInvoicePrint.open();
            } catch (error) {
                alert(error?.message || "تعذر فتح نافذة الطباعة");
                return;
            }
        }
        let orderSaved = false;
        try {
            saveButton.disabled = true;
            saveButton.textContent = editingSaleId
                ? "جاري حفظ التعديلات..."
                : "جاري حفظ الطلبية...";

            const payload = {
                customer_name: traderName,
                location,
                items: plumbingItems.map((item) => ({
                    product_id: Number(item.productId),
                    quantity: Number(item.quantity),
                    unit_price: Number(item.unitPrice)
                })),
                trader_discount_percent: traderDiscount,
                paid,
                notes
            };

            let result;
            if (editingSaleId) {
                payload.sale_type = "plumbing_order";
                result = await window.elSharq.updateSale(editingSaleId, payload);
            } else {
                result = await window.elSharq.createPlumbingOrder(payload);
            }
            if (!result?.success) throw new Error("فشل الحفظ");
            orderSaved = true;

            if (isNewOrder) {
                try {
                    const sale = await window.elSharq.getSaleById(result.saleId);
                    window.elSharqInvoicePrint.print(printWindow, {
                        ...sale,
                        type: "plumbing_order",
                        partyName: sale.customer_name || "تاجر",
                        items: sale.items
                    });
                } catch (printError) {
                    if (printWindow && !printWindow.closed) printWindow.close();
                    alert(`تم حفظ الطلبية ${result.invoiceNumber}، لكن تعذرت طباعتها: ${printError?.message || "خطأ غير معروف"}`);
                }
            } else {
                alert(`تم تعديل الطلبية بنجاح\nرقم الطلبية: ${result.invoiceNumber}`);
            }
            resetPlumbingForm();
            await renderLastInvoicesPanel(
                "lastPlumbingOrdersPanel",
                "plumbing_order",
                "plumbing",
                loadPlumbingOrderIntoForm
            );
        } catch (error) {
            console.error("Save plumbing error:", error);
            if (!orderSaved && printWindow && !printWindow.closed) printWindow.close();
            alert(orderSaved
                ? `تم حفظ الطلبية بنجاح، لكن تعذر تحديث الصفحة: ${error?.message || "خطأ غير معروف"}`
                : error?.message || "حدث خطأ أثناء حفظ طلبية السباكة");
        } finally {
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.textContent = editingSaleId
                    ? "حفظ تعديلات الطلبية"
                    : "حفظ طلبية السباكة";
            }
        }
    });

    renderPlumbingItems();
    await renderLastInvoicesPanel(
        "lastPlumbingOrdersPanel",
        "plumbing_order",
        "plumbing",
        loadPlumbingOrderIntoForm
    );
}

function getCeramicDisplayQty(item) {
    const qty = Number(item.quantity || 0);
    const unit = item.unit || item.product_unit || "قطعة";
    const isCeramic = item.category_name === "سيراميك";
    const tilesPerCarton = Number(item.tiles_per_carton || 0);
    const len = Number(item.tile_length_cm || 0);
    const wid = Number(item.tile_width_cm || 0);
    const tileArea = len && wid ? (len * wid) / 10000 : 0;
    const cartonArea = tilesPerCarton > 0 && tileArea > 0 ? tilesPerCarton * tileArea : 0;

    if (!isCeramic || unit !== "كرتونة") {
        return {
            qty: Number.isInteger(qty) ? qty : Math.round(qty * 100) / 100,
            unit: unit
        };
    }

    if (tilesPerCarton > 0) {
        const tiles = qty * tilesPerCarton;
        if (Math.abs(tiles - Math.round(tiles)) < 0.01) {
            return {
                qty: Math.round(tiles),
                unit: "بلاطة"
            };
        }
    }

    if (cartonArea > 0) {
        const meters = qty * cartonArea;
        const rounded = Math.round(meters * 100) / 100;
        if (Math.abs(rounded - meters) < 0.01) {
            return {
                qty: rounded,
                unit: "متر"
            };
        }
    }

    return {
        qty: Math.round(qty * 100) / 100,
        unit: "كرتونة"
    };
}

function formatMoney(value) {
    const number = Number(value || 0);
    return number.toFixed(2);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
    return escapeHtml(value);
}
