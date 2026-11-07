(() => {
    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    const money = (value) => Number(value || 0).toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    function open() {
        const printWindow = window.open("", "_blank", "width=940,height=820");
        if (!printWindow) throw new Error("تعذر فتح نافذة الطباعة؛ تحقق من إعدادات النوافذ المنبثقة.");
        return printWindow;
    }

    function print(printWindow, invoice, options = {}) {
        if (!printWindow || printWindow.closed) {
            throw new Error("نافذة الطباعة مغلقة؛ افتح الطباعة مرة أخرى.");
        }

        const isPurchase = invoice.type === "purchase";
        const title = isPurchase ? "فاتورة شراء" : invoice.type === "reservation" ? "فاتورة حجز" : invoice.type === "plumbing_order" ? "طلبية سباكة" : "فاتورة بيع";

        // بيانات الترويسة المؤسسية (قابلة للتعديل من الإعدادات مع الافتراضي الجديد المعتمد)
        const storeName = String(invoice.store_name || "الشرق").trim();
        const storeSubName = String(invoice.store_sub_name || "للسيراميك والأدوات الصحية").trim();
        const storeEnName = String(invoice.store_en_name || "EL-SHARQ CERAMICS & SANITARY WARE").trim();
        const storeSlogan = String(invoice.store_slogan || "اختيارك الصح لبيتك").trim();
        const storeOwnerName = String(invoice.store_owner_name || "").trim();
        const storeLogo = new URL("assets/el-sharq-logo.png", window.location.href).href;

        const storePhone1 = String(invoice.store_phone || "").trim();
        const storePhone2 = String(invoice.store_phone_2 || "").trim();
        const storeEmail = String(invoice.store_email || "").trim();
        const storeAddress1 = String(invoice.store_address || "دير البرشا - ملوي").trim();
        const storeAddress2 = String(invoice.store_address_2 || "").trim();

        const customerName = invoice.partyName || (invoice.type === "plumbing_order" ? "تاجر" : (invoice.customer_name || "عميل نقدي"));
        const customerPhone = String(invoice.customer_phone || "").trim();
        const customerAddress = String(invoice.customer_address || "").trim();
        const salePolicy = "• البضاعة المباعة لا تُرد ولا تُستبدل إلا في حالة وجود عيب مصنعي.\n• المرتجع والاستبدال بالكراتين كاملة وخلال 15 يوم من تاريخ الفاتورة.\n• لا يُقبل المرتجع أو الاستبدال بدون أصل الفاتورة.\n• المحل غير مسؤول عن أي كسر بعد استلام العميل للبضاعة.";

        const date = invoice.created_at
            ? new Date(invoice.created_at).toLocaleString("en-US")
            : new Date().toLocaleString("en-US");

        // جدول أصناف الفاتورة
        const itemRows = (invoice.items || []).map((item, index) => {
            const quantity = Number(item.displayQuantity ?? item.display_quantity ?? item.quantity ?? 0);
            const unit = item.displayUnit || item.display_unit || item.unit || item.product_unit || "قطعة";
            const unitPrice = Number(item.unit_cost ?? item.display_unit_price ?? item.unitPrice ?? item.unit_price ?? 0);
            const total = Number(item.total ?? item.total_amount ?? (quantity * unitPrice));
            return '<tr>' +
                '<td style="text-align:center; width:40px;">' + (index + 1) + '</td>' +
                '<td style="font-weight:600;">' + escapeHtml(item.product_name || item.name || "صنف") + '</td>' +
                '<td style="text-align:center;">' + money(quantity) + ' ' + escapeHtml(unit) + '</td>' +
                '<td style="text-align:center;">' + money(unitPrice) + '</td>' +
                '<td style="text-align:center; font-weight:700;">' + money(total) + '</td>' +
            '</tr>';
        }).join("");

        // أقسام الفواتير المجمعة إن وجدت
        const sections = Array.isArray(invoice.sections) ? invoice.sections : [];
        const sectionTables = sections.map(section => {
            const rows = (section.items || []).map((item, index) => '<tr>' +
                '<td style="text-align:center; width:40px;">' + (index + 1) + '</td>' +
                '<td style="font-weight:600;">' + escapeHtml(item.product_name || item.name) + '</td>' +
                '<td style="text-align:center;">' + money(item.display_quantity ?? item.quantity) + ' ' + escapeHtml(item.display_unit || item.unit || "قطعة") + '</td>' +
                '<td style="text-align:center;">' + money(item.display_unit_price ?? item.unit_price) + '</td>' +
                '<td style="text-align:center; font-weight:700;">' + money(item.total_amount ?? item.total) + '</td>' +
            '</tr>').join("");

            return '<div style="margin-top:18px;">' +
                '<div class="sub-header">' + escapeHtml(section.invoice_number) + ' — ' + escapeHtml(section.created_at ? new Date(section.created_at).toLocaleDateString("en-GB") : "") + '</div>' +
                '<table class="data-table">' +
                    '<thead><tr><th>#</th><th>وصف الصنف</th><th>الكمية</th><th>سعر الوحدة (ج.م)</th><th>الإجمالي (ج.م)</th></tr></thead>' +
                    '<tbody>' + rows + '</tbody>' +
                '</table>' +
            '</div>';
        }).join("");

        // أصناف أضيفت مباشرة إلى الفاتورة الأم بعد الدمج
        const parentAdditionItems = sections.length
            ? (invoice.items || []).filter(item => item.invoice_parent_addition)
            : [];
        const parentAdditionTable = parentAdditionItems.length
            ? '<div style="margin-top:18px;">' +
                '<div class="sub-header">أصناف مضافة على الفاتورة المجمعة</div>' +
                '<table class="data-table">' +
                    '<thead><tr><th>#</th><th>وصف الصنف</th><th>الكمية</th><th>سعر الوحدة (ج.م)</th><th>الإجمالي (ج.م)</th></tr></thead>' +
                    '<tbody>' + parentAdditionItems.map((item, index) => {
                        const quantity = Number(item.displayQuantity ?? item.display_quantity ?? item.quantity ?? 0);
                        const unit = item.displayUnit || item.display_unit || item.unit || item.product_unit || "قطعة";
                        const unitPrice = Number(item.unit_cost ?? item.display_unit_price ?? item.unitPrice ?? item.unit_price ?? 0);
                        const total = Number(item.total ?? item.total_amount ?? (quantity * unitPrice));
                        return '<tr>' +
                            '<td style="text-align:center; width:40px;">' + (index + 1) + '</td>' +
                            '<td style="font-weight:600;">' + escapeHtml(item.product_name || item.name || "صنف") + '</td>' +
                            '<td style="text-align:center;">' + money(quantity) + ' ' + escapeHtml(unit) + '</td>' +
                            '<td style="text-align:center;">' + money(unitPrice) + '</td>' +
                            '<td style="text-align:center; font-weight:700;">' + money(total) + '</td>' +
                        '</tr>';
                    }).join("") + '</tbody>' +
                '</table>' +
            '</div>'
            : "";
        // المرتجعات إن وجدت
        const returns = Array.isArray(invoice.returns) ? invoice.returns : [];
        const returnTotal = returns.reduce((sum, entry) => sum + Number(entry.total_amount || 0), 0);
        const totalRefundedCash = returns.reduce((sum, entry) => sum + Number(entry.cash_refund_amount || 0), 0);
        const originalPaid = Number(invoice.paid ?? invoice.paid_amount ?? 0);
        const netPaid = Math.max(0, Number(invoice.paid ?? invoice.paid_amount ?? 0) - returns.reduce((sum, entry) => sum + Number(entry.cash_refund_amount || 0), 0));

        let returnTableHtml = "";
        if (returns.length > 0) {
            const returnRows = [];
            let rIdx = 1;
            returns.forEach(entry => {
                (entry.items || []).forEach(item => {
                    const q = Number(item.display_quantity ?? item.quantity ?? 0);
                    const u = item.display_unit || item.unit || "قطعة";
                    const p = Number(item.unit_price || 0);
                    const t = Number(item.total_amount ?? (q * p));
                    returnRows.push('<tr>' +
                        '<td style="text-align:center; width:40px;">' + (rIdx++) + '</td>' +
                        '<td style="font-weight:600;">' + escapeHtml(item.product_name || item.name || "صنف") + ' <span style="color:#c2410c; font-size:11px;">(مرتجع)</span></td>' +
                        '<td style="text-align:center;">' + money(q) + ' ' + escapeHtml(u) + '</td>' +
                        '<td style="text-align:center;">' + money(p) + '</td>' +
                        '<td style="text-align:center; font-weight:700; color:#c2410c;">− ' + money(t) + '</td>' +
                    '</tr>');
                });
            });

            returnTableHtml = '<div style="margin-top:20px;">' +
                '<div class="sub-header return-header">الأصناف المرتجعة</div>' +
                '<table class="data-table return-table">' +
                    '<thead><tr><th>#</th><th>وصف الصنف المرتجع</th><th>الكمية</th><th>سعر الوحدة (ج.م)</th><th>الإجمالي (ج.م)</th></tr></thead>' +
                    '<tbody>' + returnRows.join("") + '</tbody>' +
                '</table>' +
            '</div>';
        }

        // الحسابات المالية
        const subtotal = Number(invoice.subtotal ?? invoice.total ?? 0);
        const discount = Number(invoice.discount ?? invoice.discount_amount ?? 0);
        const totalAfterDiscount = Number(invoice.total ?? (subtotal - discount));
        const previousInvoices = sections.length ? [] : (Array.isArray(invoice.previous_invoices) ? invoice.previous_invoices : []);
        const previousRemaining = previousInvoices.reduce((sum, item) => sum + Number(item.remaining_amount || 0), 0);
        
        // حسابات الصافي والرصيد الدائن والمرتجع
        const calculatedNet = totalAfterDiscount - returnTotal;
        const netAfterReturn = Math.max(0, calculatedNet);
        const balanceDifference = ((previousRemaining > 0 ? previousRemaining : 0) + calculatedNet) - netPaid;
        const finalRemaining = Math.max(0, balanceDifference);
        const creditBalance = balanceDifference < -0.000001 ? Math.abs(balanceDifference) : 0;
        
        printWindow.document.open();
        printWindow.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(title)} ${escapeHtml(invoice.invoice_number || "")}</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 20px; color: #1e293b; background: #f8fafc; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 13.5px; }
        .preview-toolbar { max-width: 880px; margin: 0 auto 12px; display: flex; gap: 10px; }
        .preview-toolbar button { padding: 9px 18px; border: 1px solid #cbd5e1; border-radius: 6px; color: #0f172a; background: #ffffff; font-weight: 600; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        .invoice-sheet { max-width: 880px; margin: auto; padding: 28px 34px; border-radius: 10px; background: #ffffff; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0,0,0,0.04); }

        /* ترويسة متوازنة: اسم الشرق في المنتصف، والوصف يسارًا، وبيانات التواصل يمينًا */
        .brand-header { display: grid; grid-template-columns: minmax(0, 1fr) 280px minmax(0, 1fr); direction: ltr; align-items: center; gap: 18px; padding-bottom: 18px; border-bottom: 2px solid #e2e8f0; }
        .brand-identity { grid-column: 2; grid-row: 1; width: 100%; min-width: 0; }
        .brand-logo { display: none; }
        .brand-text { width: 100%; direction: rtl; text-align: center; }
        .brand-text h1 { margin: 0; text-align: center; font-size: 38px; color: #111111; font-weight: 900; line-height: 1.12; letter-spacing: 0; }
        .brand-ornament { position: relative; width: 104px; height: 12px; margin: 9px auto 0; }
        .brand-ornament::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 2px; border-radius: 2px; background: linear-gradient(90deg, transparent, #777777 22%, #777777 78%, transparent); transform: translateY(-50%); }
        .brand-ornament::after { content: ""; position: absolute; left: 50%; top: 50%; width: 7px; height: 7px; background: #777777; border: 2px solid #ffffff; box-shadow: 0 0 0 1px #777777; transform: translate(-50%, -50%) rotate(45deg); }
        .brand-description { grid-column: 3; grid-row: 1; min-width: 0; direction: rtl; text-align: right; }
        .brand-description .sub-ar { margin: 0 0 4px; color: #222222; font-size: 13px; font-weight: 800; }
        .brand-description .sub-en { margin: 0; color: #333333; font-size: 9.5px; font-weight: 700; letter-spacing: 0.25px; line-height: 1.5; }
        .brand-description .slogan { margin: 5px 0 0; color: #444444; font-size: 11px; font-weight: 600; }
        .brand-contacts { grid-column: 1; grid-row: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 7px; font-size: 12px; color: #222222; }
        .contact-item { display: flex; align-items: center; gap: 9px; min-height: 17px; }
        .contact-icon { width: 15px; height: 15px; fill: #444444; flex-shrink: 0; }
        .contact-lines { line-height: 1.4; font-weight: 600; direction: ltr; text-align: left; }
        .brand-owner { margin: 5px 0 0; color: #333333; font-size: 11px; font-weight: 700; line-height: 1.4; text-align: right; direction: rtl; }
        .brand-motto { margin: 5px 0 0; color: #333333; font-size: 11px; font-weight: 700; line-height: 1.4; text-align: center; }
        .contact-address { direction: rtl; text-align: right; }
        @media (max-width: 640px) {
            .brand-header { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: start; }
            .brand-identity { grid-column: 1 / -1; grid-row: 1; width: min(100%, 280px); justify-self: center; }
            .brand-text h1 { font-size: 34px; }
            .brand-description { grid-column: 2; grid-row: 2; }
            .brand-contacts { grid-column: 1; grid-row: 2; align-items: flex-start; }
        }
        /* رقم الفاتورة والتاريخ */
        .invoice-title-bar { display: flex; justify-content: space-between; align-items: center; margin: 20px 0 16px; }
        .invoice-title-bar h2 { margin: 0; font-size: 21px; color: #111111; font-weight: 800; }
        .invoice-meta-date { text-align: left; font-size: 13px; color: #333333; }
        .invoice-meta-date strong { color: #111111; font-size: 14px; }

        /* بيانات العميل */
        .client-card { background: #f1f1f1; border: 1px solid #bdbdbd; border-radius: 8px; padding: 12px 18px; margin-bottom: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; }
        .client-card .row { display: flex; gap: 8px; align-items: center; }
        .client-card .label { color: #333333; font-size: 12.5px; min-width: 75px; }
        .client-card .value { font-weight: 700; color: #111111; }

        /* الجداول */
        .sub-header { font-size: 13.5px; font-weight: 700; color: #111111; margin-bottom: 8px; }
        .return-header { color: #111111; }
        .data-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
        .data-table th { background: #e6e6e6; color: #111111; padding: 9px 12px; font-size: 12.5px; font-weight: 700; text-align: center; border: 1px solid #bdbdbd; }
        .data-table th:nth-child(2) { text-align: right; }
        .data-table td { padding: 9px 12px; border: 1px solid #c7c7c7; font-size: 13px; color: #111111; }
        .data-table tbody tr:nth-child(even) { background: #f7f7f7; }

        .return-table th { background: #e6e6e6; color: #111111; border-color: #bdbdbd; }
        .return-table td { background: #ffffff; }

        /* الجزء السفلي: الملاحظات وصندوق الحسابات المالي */
        .bottom-section { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 22px; margin-top: 24px; align-items: start; }
        .notes-card { background: #ffffff; border: 1px dashed #bdbdbd; border-radius: 8px; padding: 14px 16px; font-size: 12px; color: #222222; line-height: 1.8; }
        .notes-card strong { color: #111111; font-size: 13px; display: block; margin-bottom: 6px; }

        .summary-card { border: 1px solid #bdbdbd; border-radius: 8px; overflow: hidden; background: #ffffff; box-shadow: none; }
        .summary-line { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; border-bottom: 1px solid #dedede; font-size: 13px; }
        .summary-line span { color: #333333; font-weight: 600; }
        .summary-line strong { font-weight: 700; color: #111111; }
        .summary-line.highlight { background: #f1f1f1; font-weight: 700; }
        .summary-line.return-line { color: #111111; }
        .summary-line.return-line strong { color: #111111; }
        .summary-line.net-line { background: #e8e8e8; color: #111111; font-weight: 800; border-top: 1px solid #bdbdbd; border-bottom: 1px solid #bdbdbd; }
        .summary-remaining-box { background: #e5e5e5; color: #111111; border-top: 1px solid #bdbdbd; display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; font-size: 16px; font-weight: 800; }
        .summary-remaining-box strong { font-size: 18px; color: #111111; }

        @media print {
            body { padding: 0; color: #111111; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .invoice-sheet { border: none; box-shadow: none; padding: 10mm 12mm; max-width: 100%; }
            .invoice-sheet, .invoice-sheet * { color: #111111 !important; }
            .data-table th, .return-table th { background: #e6e6e6 !important; border-color: #bdbdbd !important; }
            .client-card, .summary-line.highlight, .summary-line.net-line, .summary-remaining-box { background: #eeeeee !important; }
            .data-table tbody tr:nth-child(even) { background: #f7f7f7 !important; }
            .contact-icon { fill: #333333 !important; }
            .preview-toolbar { display: none; }
        }
    </style>
</head>
<body>
    ${options.autoPrint === false ? '<div class="preview-toolbar"><button type="button" data-preview-print>طباعة الفاتورة</button><button type="button" data-preview-close>إغلاق المعاينة</button></div>' : ''}
    <main class="invoice-sheet">
        <!-- الترويسة المعتمدة -->
        <header class="brand-header">
            <div class="brand-description">
                <div class="sub-ar">${escapeHtml(storeSubName)}</div>
                <div class="sub-en">${escapeHtml(storeEnName)}</div>
                ${storeOwnerName ? `<div class="brand-owner">إدارة المحل: ${escapeHtml(storeOwnerName)}</div>` : ""}
            </div>
            <div class="brand-identity">
                <div class="brand-text">
                    <h1>${escapeHtml(storeName)}</h1>
                    <div class="brand-ornament" aria-hidden="true"></div>
                    ${storeSlogan ? `<div class="brand-motto">${escapeHtml(storeSlogan)}</div>` : ""}
                </div>
            </div>
            <div class="brand-contacts">
                ${storePhone1 || storePhone2 ? `<div class="contact-item">
                    <svg class="contact-icon" viewBox="0 0 24 24"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24 11.72 11.72 0 003.68.59 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.72 11.72 0 00.59 3.68 1 1 0 01-.24 1.02l-2.23 2.09z"/></svg>
                    <div class="contact-lines">
                        ${storePhone1 ? `<div>${escapeHtml(storePhone1)}</div>` : ""}
                        ${storePhone2 ? `<div>${escapeHtml(storePhone2)}</div>` : ""}
                    </div>
                </div>` : ""}
                ${storeEmail ? `<div class="contact-item">
                    <svg class="contact-icon" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                    <div class="contact-lines">${escapeHtml(storeEmail)}</div>
                </div>` : ""}
                ${storeAddress1 || storeAddress2 ? `<div class="contact-item">
                    <svg class="contact-icon" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z"/></svg>
                    <div class="contact-lines contact-address">
                        ${storeAddress1 ? `<div>${escapeHtml(storeAddress1)}</div>` : ""}
                        ${storeAddress2 ? `<div>${escapeHtml(storeAddress2)}</div>` : ""}
                    </div>
                </div>` : ""}
            </div>
        </header>

        <!-- العنوان والتاريخ -->
        <section class="invoice-title-bar">
            <div>
                <h2>${escapeHtml(title)}</h2>
                <span style="font-size:13px; color:#64748b;">رقم الفاتورة: <strong style="color:#10365c; font-size:15px; direction:ltr; display:inline-block;">${escapeHtml(invoice.invoice_number || "-")}</strong></span>
            </div>
            <div class="invoice-meta-date">
                <div>التاريخ: <strong>${escapeHtml(date)}</strong></div>
            </div>
        </section>

        <!-- بيانات العميل -->
        <section class="client-card">
            <div class="row"><span class="label">اسم العميل:</span><span class="value">${escapeHtml(customerName)}</span></div>
            <div class="row"><span class="label">رقم الهاتف:</span><span class="value">${escapeHtml(customerPhone || "-")}</span></div>
            <div class="row"><span class="label">العنوان:</span><span class="value">${escapeHtml(customerAddress || "-")}</span></div>
            <div class="row"><span class="label">طريقة السداد:</span><span class="value">${invoice.sale_type === "cash" ? "نقداً" : (invoice.sale_type === "plumbing_order" ? "طلبية سباكة" : "آجل / حساب")}</span></div>
        </section>

        <!-- جدول الأصناف -->
        ${sections.length ? sectionTables + parentAdditionTable : `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>وصف الصنف</th>
                        <th>الكمية</th>
                        <th>سعر الوحدة (ج.م)</th>
                        <th>الإجمالي (ج.م)</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemRows || '<tr><td colspan="5" style="text-align:center;">لا توجد أصناف</td></tr>'}
                </tbody>
            </table>
        `}

        <!-- جدول المرتجعات إن وُجد -->
        ${returnTableHtml}

        <!-- الجزء السفلي: الملاحظات وصندوق الحسابات المالي -->
        <section class="bottom-section">
            <div class="notes-card">
                <strong>ملاحظات وشروط الفاتورة:</strong>
                <div style="white-space: pre-wrap;">${escapeHtml(salePolicy)}</div>
                ${invoice.notes ? `<div style="margin-top:8px; padding-top:6px; border-top:1px dashed #cbd5e1; font-weight:600;">${escapeHtml(invoice.notes)}</div>` : ""}
            </div>

            <div class="summary-card">
                <div class="summary-line"><span>إجمالي المبيعات</span><strong>${money(subtotal)} ج.م</strong></div>
                ${discount > 0 ? `
                    <div class="summary-line"><span>قيمة الخصم</span><strong>− ${money(discount)} ج.م</strong></div>
                    <div class="summary-line highlight"><span>الإجمالي بعد الخصم</span><strong>${money(totalAfterDiscount)} ج.م</strong></div>
                ` : ""}
                ${previousRemaining > 0 ? `
                    <div class="summary-line"><span>حساب سابق مستحق</span><strong>${money(previousRemaining)} ج.م</strong></div>
                ` : ""}
                <div class="summary-line"><span>المبلغ المسدد من العميل</span><strong>${money(Number(invoice.paid ?? invoice.paid_amount ?? 0))} ج.م</strong></div>
                ${returnTotal > 0 ? `
                    <div class="summary-line return-line" style="color:#c2410c; font-weight:700;">
                        <span>إجمالي المرتجعات (مستحق للعميل)</span>
                        <strong style="color:#c2410c;">− ${money(returnTotal)} ج.م</strong>
                    </div>
                ` : ""}
                ${returns.reduce((sum, entry) => sum + Number(entry.cash_refund_amount || 0), 0) > 0 ? `
                    <div class="summary-line" style="color:#0284c7; font-weight:700; background:rgba(2,132,199,0.08); padding:5px 8px; border-radius:4px;">
                        <span>المردود نقداً للعميل من الخزنة</span>
                        <strong style="color:#0284c7;">+ ${money(returns.reduce((sum, entry) => sum + Number(entry.cash_refund_amount || 0), 0))} ج.م</strong>
                    </div>
                ` : ""}
                <div class="summary-remaining-box">
                    <span>المتبقي المستحق</span>
                    <strong>${creditBalance > 0 ? ('- ' + money(creditBalance)) : money(finalRemaining)} ج.م</strong>
                </div>
            </div>
        </section>
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


