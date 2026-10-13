(() => {
    const escapeHtml = (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const money = (value) => Number(value || 0).toLocaleString("ar-EG", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    function open() {
        const printWindow = window.open("", "_blank", "width=900,height=720");
        if (!printWindow) throw new Error("تعذر فتح نافذة الطباعة؛ تحقق من إعدادات النوافذ المنبثقة.");
        return printWindow;
    }

    function print(printWindow, invoice, options = {}) {
        if (!printWindow || printWindow.closed) {
            throw new Error("نافذة الطباعة مغلقة؛ افتح الطباعة مرة أخرى.");
        }

        const isPurchase = invoice.type === "purchase";
        const title = isPurchase ? "فاتورة شراء" : invoice.type === "plumbing_order" ? "طلبية سباكة" : "فاتورة بيع";
        const date = invoice.created_at
            ? new Date(invoice.created_at).toLocaleString("ar-EG")
            : new Date().toLocaleString("ar-EG");
        const itemRows = (invoice.items || []).map((item, index) => {
            const quantity = Number(item.displayQuantity ?? item.quantity ?? 0);
            const unit = item.displayUnit || item.unit || item.product_unit || "قطعة";
            const unitPrice = Number(item.unit_cost ?? item.unitPrice ?? item.unit_price ?? 0);
            const total = Number(item.total ?? item.total_amount ?? quantity * unitPrice);
            if (isPurchase) {
                const listPrice = item.list_price == null ? null : Number(item.list_price);
                const discountPercent = item.plumbing_discount_percent == null ? null : Number(item.plumbing_discount_percent);
                return `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${escapeHtml(item.product_name || item.name || "صنف")}</td>
                        <td>${money(quantity)} ${escapeHtml(unit)}</td>
                        <td>${listPrice == null ? "—" : `${money(listPrice)} ج.م`}</td>
                        <td>${discountPercent == null ? "—" : `${money(discountPercent)}%`}</td>
                        <td>${money(unitPrice)} ج.م</td>
                        <td>${money(total)} ج.م</td>
                    </tr>
                `;
            }
            return `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(item.product_name || item.name || "صنف")}</td>
                    <td>${money(quantity)} ${escapeHtml(unit)}</td>
                    <td>${money(unitPrice)} ج.م</td>
                    <td>${money(total)} ج.م</td>
                </tr>
            `;
        }).join("");
        const returns = Array.isArray(invoice.returns) ? invoice.returns : [];
        const returnTotal = returns.reduce((sum, entry) => sum + Number(entry.total_amount || 0), 0);
        const netPaid = Math.max(0, Number(invoice.paid ?? invoice.paid_amount ?? 0) - returns.reduce((sum, entry) => sum + Number(entry.cash_refund_amount || 0), 0));
        const returnTables = returns.map((entry) => {
            const rows = (entry.items || []).map((item, index) => {
                const quantity = Number(item.display_quantity ?? item.quantity ?? 0);
                const unit = item.display_unit || item.unit || "قطعة";
                const unitPrice = Number(item.unit_price || 0);
                const lineTotal = Number(item.total_amount ?? quantity * unitPrice);
                return `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${escapeHtml(item.product_name || item.name || "صنف")}</td>
                        <td>${money(quantity)} ${escapeHtml(unit)}</td>
                        <td>${money(unitPrice)} ج.م</td>
                        <td>${money(lineTotal)} ج.م</td>
                    </tr>
                `;
            }).join("");
            const meta = `<div class="return-meta"><span><strong>${escapeHtml(entry.return_number || "مرتجع")}</strong> — ${escapeHtml(entry.created_at || "")}</span><strong>${money(Number(entry.total_amount || 0))} ج.م</strong></div>`;
            return `${meta}<table><thead><tr><th>#</th><th>الصنف المرتجع</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>`;
        }).join("");
        const returnTable = returns.length ? `
            <section class="return-block">
                <h3>تفاصيل المرتجعات</h3>
                ${returnTables}
            </section>
        ` : "";
        const subtotal = Number(invoice.subtotal ?? invoice.total ?? 0);
        const discount = Number(invoice.discount ?? invoice.discount_amount ?? 0);
        const total = Number(invoice.total ?? subtotal - discount);
        const paid = Number(invoice.paid ?? invoice.paid_amount ?? 0);
        const remaining = Number(invoice.remaining ?? invoice.remaining_amount ?? Math.max(total - returnTotal - netPaid, 0));
        const discountLabel = isPurchase && subtotal > 0
            ? `${money(discount)} ج.م (${new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(discount / subtotal * 100)}%)`
            : `${money(discount)} ج.م`;
        const discountRow = discount > 0
            ? `<div class="summary-row"><span>الخصم</span><strong>${discountLabel}</strong></div>`
            : "";
        const returnSummaryRow = returnTotal > 0
            ? `<div class="summary-row"><span>المرتجعات</span><strong>− ${money(returnTotal)} ج.م</strong></div>`
            : "";
        const paidLabel = "المدفوع";

        printWindow.document.open();
        printWindow.document.write(`<!doctype html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>${escapeHtml(title)} ${escapeHtml(invoice.invoice_number || "")}</title>
                <style>
                    * { box-sizing: border-box; }
                    body { margin: 0; padding: 28px; color: #252b34; background: #e5e7eb; font: 14px Tahoma, Arial, sans-serif; }
                    .preview-toolbar { max-width: 850px; margin: 0 auto 12px; display: flex; gap: 8px; }
                    .preview-toolbar button { padding: 9px 14px; border: 1px solid #b8c0ca; border-radius: 7px; color: #303741; background: #f1f2f4; font: inherit; cursor: pointer; }
                    .invoice { max-width: 850px; margin: auto; padding: 28px; border: 1px solid #d1d5dc; border-radius: 12px; background: #f1f2f4; }
                    .brand { display: flex; align-items: center; gap: 14px; padding-bottom: 20px; border-bottom: 2px solid #7e8794; }
                    .brand-mark { display: grid; width: 48px; height: 48px; place-items: center; border-radius: 12px; color: #f1f2f4; background: #68717e; font-size: 25px; font-weight: 800; }
                    .brand h1 { margin: 0 0 5px; font-size: 22px; }
                    .brand p, .invoice-meta span { margin: 0; color: #68717e; }
                    .heading { display: flex; justify-content: space-between; align-items: start; gap: 20px; margin: 24px 0; }
                    .heading h2 { margin: 0 0 8px; font-size: 20px; }
                    .invoice-no { direction: ltr; text-align: left; font-size: 16px; font-weight: 700; }
                    .invoice-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; margin-bottom: 22px; }
                    .invoice-meta div { display: flex; gap: 8px; }
                    table { width: 100%; border-collapse: collapse; }
                    th { background: #d9dde3; color: #303741; }
                    th, td { padding: 11px 10px; border: 1px solid #d1d5dc; text-align: right; }
                    .return-block { margin-top: 24px; }
                    .return-block h3 { margin: 0 0 10px; font-size: 16px; }
                    .return-meta { display: flex; justify-content: space-between; align-items: center; gap: 8px 16px; flex-wrap: wrap; margin: 0 0 8px; padding: 9px 10px; border: 1px solid #d1d5dc; border-radius: 6px; background: #e8eaee; }
                    .summary { width: min(360px, 100%); margin: 20px 0 0 auto; }
                    .summary-row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #d9dde3; }
                    .summary-row.total { margin-top: 4px; color: #424a56; font-size: 17px; font-weight: 700; }
                    .notes { margin-top: 26px; padding: 12px; border-radius: 8px; background: #e4e6ea; white-space: pre-wrap; }
                    footer { margin-top: 42px; padding-top: 12px; border-top: 1px solid #d1d5dc; color: #707987; text-align: center; font-size: 11px; }
                    @page { size: auto; margin: 12mm; }
                    @media print { body { padding: 0; background: #f1f2f4; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .invoice { max-width: none; border: 0; border-radius: 0; } .preview-toolbar { display: none; } }
                </style>
            </head>
            <body>
                ${options.autoPrint === false ? '<div class="preview-toolbar"><button type="button" data-preview-print>طباعة الفاتورة</button><button type="button" data-preview-close>إغلاق المعاينة</button></div>' : ''}
                <main class="invoice">
                    <header class="brand">
                        <div class="brand-mark">ش</div>
                        <div><h1>الشرق</h1><p>نظام إدارة المحل</p></div>
                    </header>
                    <section class="heading">
                        <div><h2>${escapeHtml(title)}</h2><div class="invoice-meta"><div><span>التاريخ:</span><strong>${escapeHtml(date)}</strong></div><div><span>${isPurchase ? "المورد:" : invoice.type === "plumbing_order" ? "التاجر:" : "العميل:"}</span><strong>${escapeHtml(invoice.partyName || (isPurchase ? "مورد نقدي" : "عميل نقدي"))}</strong></div><div><span>الموقع:</span><strong>${escapeHtml(invoice.locationName || "-")}</strong></div></div></div>
                        <div class="invoice-no">${escapeHtml(invoice.invoice_number || "-")}</div>
                    </section>
                    <table>
                        <thead><tr>${isPurchase ? "<th>#</th><th>الصنف</th><th>الكمية</th><th>السعر القطاعي / الليستة</th><th>الخصم</th><th>الشراء بالجملة</th><th>الإجمالي</th>" : "<th>#</th><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th>"}</tr></thead>
                        <tbody>${itemRows || `<tr><td colspan="${isPurchase ? 7 : 5}">لا توجد أصناف</td></tr>`}</tbody>
                    </table>
                    ${returnTable}
                    <section class="summary">
                        <div class="summary-row"><span>${isPurchase && discount === 0 ? "إجمالي المشتريات بعد خصم المورد" : "الإجمالي قبل الخصم"}</span><strong>${money(subtotal)} ج.م</strong></div>
                        ${discountRow}
                        <div class="summary-row total"><span>الإجمالي النهائي</span><strong>${money(total)} ج.م</strong></div>
                        ${returnSummaryRow}
                        <div class="summary-row"><span>${paidLabel}</span><strong>${money(netPaid)} ج.م</strong></div>
                        <div class="summary-row"><span>المتبقي</span><strong>${money(remaining)} ج.م</strong></div>
                    </section>
                    ${invoice.notes ? `<div class="notes"><strong>ملاحظات:</strong> ${escapeHtml(invoice.notes)}</div>` : ""}
                    <footer>الشرق | نظام إدارة المحل — شكرًا لتعاملكم معنا</footer>
                </main>
            </body>
            </html>`);
        printWindow.document.close();
        printWindow.focus();
        if (options.autoPrint === false) {
            printWindow.document.querySelector("[data-preview-print]")?.addEventListener("click", () => printWindow.print());
            printWindow.document.querySelector("[data-preview-close]")?.addEventListener("click", () => printWindow.close());
        } else {
            setTimeout(() => {
                if (!printWindow.closed) printWindow.print();
            }, 350);
        }
    }

    window.elSharqInvoicePrint = Object.freeze({ open, print });
})();
