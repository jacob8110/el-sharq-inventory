(() => {
    const escape = (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const money = (value) => Number(value || 0).toFixed(2);
    const localDate = () => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    };
    const dateText = (value) => value
        ? new Date(value).toLocaleString("ar-EG")
        : "-";

    function content(title, description, body) {
        const dashboard = document.querySelector(".dashboard");
        if (!dashboard) throw new Error("تعذر تحميل مساحة الصفحة");
        dashboard.innerHTML = `
            <div class="page-header">
                <div><h2>${escape(title)}</h2><p>${escape(description)}</p></div>
            </div>
            ${body}
        `;
        return dashboard;
    }

    function status(target, message, isError = false) {
        const node = typeof target === "string" ? document.getElementById(target) : target;
        if (!node) return;
        node.textContent = message;
        node.className = isError ? "product-form-message error" : "product-form-message success";
    }

    function fail(target, error) {
        console.error("Module operation failed:", error);
        status(target, error?.message || "حدث خطأ أثناء تنفيذ العملية", true);
    }

    function productPicker(inputId, dropdownId, selectId, products) {
        return `
            <div class="form-field product-picker-field">
                <label for="${inputId}">الصنف</label>
                <input type="search" id="${inputId}" autocomplete="off" placeholder="ابحث بالاسم أو الكود أو الباركود...">
                <div class="product-picker-dropdown" id="${dropdownId}" hidden></div>
                <select id="${selectId}" class="product-picker-native" tabindex="-1" aria-hidden="true">
                    <option value="">اختر الصنف</option>
                    ${products.map((product) => `<option value="${product.id}" data-unit="${escape(product.unit || "قطعة")}">${escape(product.name)}</option>`).join("")}
                </select>
            </div>
        `;
    }

    function setupProductPicker(page, { inputId, dropdownId, selectId, products, getCandidates = () => products }) {
        const input = page.querySelector(`#${inputId}`);
        const dropdown = page.querySelector(`#${dropdownId}`);
        const select = page.querySelector(`#${selectId}`);
        const render = () => {
            const query = input.value;
            const candidates = getCandidates();
            const matches = candidates.filter((product) => window.elSharqSearch.matches(
                query,
                product.name,
                product.internal_code,
                product.barcode,
                product.category_name
            )).slice(0, 40);
            if (!matches.length) {
                dropdown.innerHTML = `<div class="product-picker-empty">لا توجد أصناف مطابقة</div>`;
            } else {
                dropdown.innerHTML = matches.map((product) => `
                    <button type="button" class="product-picker-option" data-product-picker-id="${product.id}">
                        <span><strong>${escape(product.name)}</strong><small>${escape(product.category_name || "منتج")}</small></span>
                        <span class="product-picker-code">${escape(product.internal_code || "")}</span>
                    </button>
                `).join("");
            }
            dropdown.hidden = false;
        };
        input.addEventListener("focus", render);
        input.addEventListener("input", () => {
            select.value = "";
            render();
        });
        input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" || dropdown.hidden) return;
            const firstOption = dropdown.querySelector("[data-product-picker-id]");
            if (!firstOption) return;
            event.preventDefault();
            firstOption.click();
        });
        input.addEventListener("blur", () => {
            setTimeout(() => {
                dropdown.hidden = true;
            }, 120);
        });
        dropdown.addEventListener("mousedown", (event) => {
            if (event.target.closest("[data-product-picker-id]")) event.preventDefault();
        });
        dropdown.addEventListener("click", (event) => {
            const button = event.target.closest("[data-product-picker-id]");
            if (!button) return;
            const product = products.find((item) => Number(item.id) === Number(button.dataset.productPickerId));
            if (!product) throw new Error("الصنف المحدد غير موجود");
            select.value = String(product.id);
            input.value = `${product.name} — ${product.internal_code || ""}`;
            dropdown.hidden = true;
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        return {
            clear() {
                select.value = "";
                input.value = "";
                dropdown.hidden = true;
            },
            render,
            select
        };
    }

    async function purchases() {
        const [products, suppliers, locations, invoices] = await Promise.all([
            window.elSharq.getProducts(),
            window.elSharq.getSuppliers(),
            window.elSharq.getLocations(),
            window.elSharq.getPurchases()
        ]);
        const renderPurchaseRows = (purchaseRows) => purchaseRows.length
            ? purchaseRows.map((invoice) => `<tr data-purchase-row data-purchase-id="${invoice.id}" data-purchase-supplier="${invoice.supplier_id || ""}" data-purchase-invoice="${escape(invoice.invoice_number)}" data-purchase-search="${escape(`${invoice.invoice_number} ${invoice.supplier_name || "مورد غير مسجل"} ${invoice.notes || ""}`)}"><td>${escape(invoice.invoice_number)}</td><td>${dateText(invoice.created_at)}</td><td>${escape(invoice.supplier_name || "مورد غير مسجل")}</td><td>${money(invoice.total)} ج.م</td><td>${money(invoice.paid)} ج.م</td><td>${money(invoice.remaining)} ج.م</td><td><button class="view-btn" type="button" data-print-purchase-id="${invoice.id}">طباعة</button> <button class="delete-btn" type="button" data-delete-purchase-id="${invoice.id}">حذف</button></td></tr>`).join("")
            : '<tr><td colspan="7">لا توجد فواتير مطابقة</td></tr>';
        let visibleInvoices = invoices;
        const page = content("المشتريات", "تسجيل فواتير الشراء وتحديث المخزون وحساب المورد.", `
            <div class="sales-panel">
                <div class="sales-panel-header"><div><h3>فاتورة شراء جديدة</h3><span>تضاف الكميات للمخزون عند الحفظ</span></div></div>
                <form id="purchaseForm">
                    <div class="sale-info-grid">
                        <div class="form-field"><label for="purchaseSupplierName">المورد / الشركة</label><input id="purchaseSupplierName" type="text" list="purchaseSupplierOptions" autocomplete="off" placeholder="اكتب اسم المورد أو اختره"><datalist id="purchaseSupplierOptions">${suppliers.map((s) => `<option value="${escape(s.name)}"></option>`).join("")}</datalist></div>
                        <div class="form-field"><label for="purchaseLocation">مكان التخزين</label><select id="purchaseLocation">${locations.map((l) => `<option value="${l.id}">${escape(l.name)}</option>`).join("")}</select></div>
                    </div>
                    <div class="sale-add-product">
                        ${productPicker("purchaseProductSearch", "purchaseProductDropdown", "purchaseProduct", products.filter((p) => p.active))}
                        <div class="form-field"><label id="purchaseQtyLabel" for="purchaseQty">الكمية</label><input id="purchaseQty" type="number" min="0.01" step="0.01" required></div>
                        <div class="form-field"><label id="purchaseCostLabel" for="purchaseCost">تكلفة الوحدة قبل الخصم</label><input id="purchaseCost" type="number" min="0" step="0.01" required></div>
                        <button class="secondary-button" id="purchaseAddItem" type="button">إضافة الصنف</button>
                    </div>
                    <div class="last-invoices-table-wrapper"><table class="last-invoices-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th><th></th></tr></thead><tbody id="purchaseItems"><tr><td colspan="5">لم تتم إضافة أصناف</td></tr></tbody></table></div>
                    <div class="sale-info-grid">
                        <div class="form-field"><label for="purchaseDiscountType">طريقة الخصم</label><select id="purchaseDiscountType"><option value="amount">قيمة ثابتة</option><option value="percent">نسبة مئوية</option></select></div>
                        <div class="form-field"><label id="purchaseDiscountLabel" for="purchaseDiscount">قيمة الخصم</label><input id="purchaseDiscount" type="number" min="0" step="0.01" value="0"></div>
                        <div class="form-field"><label for="purchasePaid">المبلغ المدفوع</label><input id="purchasePaid" type="number" min="0" step="0.01" value="0"></div>
                        <div class="form-field"><label for="purchaseNotes">ملاحظات</label><input id="purchaseNotes" type="text"></div>
                    </div>
                    <p id="purchaseTotal">الإجمالي: 0.00 ج.م</p>
                    <p class="purchase-cost-note">يُوزّع خصم الفاتورة على الأصناف بنسبة قيمتها، وتُحدّث تكلفة المخزون الحالية إلى صافي آخر شراء. الفواتير السابقة لا تتغير.</p>
                    <div id="purchaseMessage" class="product-form-message"></div>
                    <button class="primary-button" type="submit">حفظ فاتورة الشراء</button>
                </form>
            </div>
            <div class="last-invoices-panel">
                <h3>فواتير الشراء</h3>
                <div class="products-toolbar">
                    <div class="search-box"><span>⌕</span><input id="purchaseHistorySearch" type="search" placeholder="ابحث برقم الفاتورة أو اسم المورد أو الملاحظات"></div>
                    <div class="form-field"><label for="purchaseHistorySupplier">فواتير مورد محدد</label><select id="purchaseHistorySupplier"><option value="">كل الموردين</option>${suppliers.map((s) => `<option value="${s.id}">${escape(s.name)}</option>`).join("")}</select></div>
                </div>
                <div id="purchaseHistoryMessage" class="product-form-message"></div>
                <div class="last-invoices-table-wrapper"><table class="last-invoices-table"><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>المورد</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>إجراءات</th></tr></thead><tbody id="purchaseHistoryRows">${renderPurchaseRows(invoices)}</tbody></table></div>
            </div>
        `);
        const items = [];
        const productSelect = page.querySelector("#purchaseProduct");
        const purchasePicker = setupProductPicker(page, {
            inputId: "purchaseProductSearch",
            dropdownId: "purchaseProductDropdown",
            selectId: "purchaseProduct",
            products: products.filter((p) => p.active)
        });
        const getPurchaseDiscount = (subtotal) => {
            const discountInput = Number(page.querySelector("#purchaseDiscount").value || 0);
            return page.querySelector("#purchaseDiscountType").value === "percent"
                ? subtotal * discountInput / 100
                : discountInput;
        };
        const drawItems = () => {
            const body = page.querySelector("#purchaseItems");
            const total = items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
            body.innerHTML = items.length ? items.map((item, index) => `<tr><td>${escape(item.name)}</td><td>${item.quantity} ${escape(item.unit)}</td><td>${money(item.unit_cost)}</td><td>${money(item.quantity * item.unit_cost)}</td><td><button type="button" data-remove="${index}">حذف</button></td></tr>`).join("") : '<tr><td colspan="5">لم تتم إضافة أصناف</td></tr>';
            const discount = getPurchaseDiscount(total);
            page.querySelector("#purchaseTotal").textContent = `قبل الخصم: ${money(total)} ج.م — الخصم: ${money(discount)} ج.م — الإجمالي النهائي: ${money(Math.max(0, total - discount))} ج.م`;
            body.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => {
                items.splice(Number(button.dataset.remove), 1);
                drawItems();
            }));
        };
        productSelect.addEventListener("change", () => {
            const selected = productSelect.selectedOptions[0];
            const product = products.find((item) => Number(item.id) === Number(productSelect.value));
            page.querySelector("#purchaseCost").value = product?.purchase_price || "";
            const isMeter = selected?.dataset.unit === "متر";
            page.querySelector("#purchaseQtyLabel").textContent = isMeter ? "الكمية بالمتر" : "الكمية";
            page.querySelector("#purchaseCostLabel").textContent = isMeter ? "تكلفة المتر قبل الخصم" : "تكلفة الوحدة قبل الخصم";
        });
        const discountType = page.querySelector("#purchaseDiscountType");
        const discountInput = page.querySelector("#purchaseDiscount");
        const syncDiscountType = () => {
            const isPercent = discountType.value === "percent";
            page.querySelector("#purchaseDiscountLabel").textContent = isPercent ? "نسبة الخصم %" : "قيمة الخصم";
            discountInput.max = isPercent ? "100" : "";
            drawItems();
        };
        discountType.addEventListener("change", syncDiscountType);
        discountInput.addEventListener("input", drawItems);
        let historyRequest = 0;
        let historySearchTimer;
        const refreshPurchaseHistory = async () => {
            const requestId = ++historyRequest;
            try {
                const rows = await window.elSharq.getPurchases({
                    query: page.querySelector("#purchaseHistorySearch").value,
                    supplierId: page.querySelector("#purchaseHistorySupplier").value
                });
                if (requestId !== historyRequest) return;
                visibleInvoices = rows;
                page.querySelector("#purchaseHistoryRows").innerHTML = renderPurchaseRows(rows);
                status("purchaseHistoryMessage", "");
            } catch (error) {
                fail("purchaseHistoryMessage", error);
            }
        };
        page.querySelector("#purchaseHistorySearch").addEventListener("input", () => {
            clearTimeout(historySearchTimer);
            historySearchTimer = setTimeout(refreshPurchaseHistory, 250);
        });
        page.querySelector("#purchaseHistorySupplier").addEventListener("change", refreshPurchaseHistory);
        page.querySelector("#purchaseAddItem").addEventListener("click", () => {
            const productId = Number(productSelect.value);
            const product = products.find((entry) => Number(entry.id) === productId);
            const quantity = Number(page.querySelector("#purchaseQty").value);
            const unitCost = Number(page.querySelector("#purchaseCost").value);
            if (!product || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
                status("purchaseMessage", "اختر منتجًا وأدخل كمية وتكلفة صحيحتين", true);
                return;
            }
            items.push({ product_id: productId, name: product.name, quantity, unit: product.unit || "قطعة", unit_cost: unitCost });
            page.querySelector("#purchaseQty").value = "";
            purchasePicker.clear();
            page.querySelector("#purchaseCost").value = "";
            drawItems();
            status("purchaseMessage", "");
        });
        page.querySelector("#purchaseForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!items.length) return status("purchaseMessage", "أضف صنفًا واحدًا على الأقل", true);
            const button = event.currentTarget.querySelector('[type="submit"]');
            button.disabled = true;
            let printWindow;
            let purchaseSaved = false;
            try {
                printWindow = window.elSharqInvoicePrint.open();
                const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
                const discount = getPurchaseDiscount(subtotal);
                if (discount > subtotal) {
                    button.disabled = false;
                    if (printWindow && !printWindow.closed) printWindow.close();
                    return status("purchaseMessage", "الخصم أكبر من إجمالي الفاتورة", true);
                }
                const result = await window.elSharq.createPurchase({
                    supplier_name: page.querySelector("#purchaseSupplierName").value.trim(),
                    location_id: page.querySelector("#purchaseLocation").value,
                    discount_amount: discount,
                    paid_amount: Number(page.querySelector("#purchasePaid").value || 0),
                    notes: page.querySelector("#purchaseNotes").value,
                    items
                });
                purchaseSaved = true;
                status("purchaseMessage", `تم حفظ الفاتورة ${result.invoiceNumber}`);
                try {
                    window.elSharqInvoicePrint.print(printWindow, {
                        type: "purchase",
                        invoice_number: result.invoiceNumber,
                        created_at: new Date().toISOString(),
                        partyName: result.supplierName || "مورد نقدي",
                        locationName: locations.find((location) => String(location.id) === page.querySelector("#purchaseLocation").value)?.name || "-",
                        items: items.map((item) => ({ ...item, total: item.quantity * item.unit_cost })),
                        subtotal: result.subtotal,
                        discount: result.discount,
                        total: result.total,
                        paid: result.paid,
                        remaining: result.remaining,
                        notes: page.querySelector("#purchaseNotes").value
                    });
                } catch (printError) {
                    if (printWindow && !printWindow.closed) printWindow.close();
                    window.alert(`تم حفظ الفاتورة ${result.invoiceNumber}، لكن تعذرت الطباعة: ${printError?.message || "خطأ غير معروف"}`);
                }
                try {
                    await purchases();
                } catch (refreshError) {
                    console.error("Purchase page refresh after save failed:", refreshError);
                    window.alert(`تم حفظ الفاتورة ${result.invoiceNumber} بنجاح، لكن تعذر تحديث قائمة المشتريات.`);
                }
            } catch (error) {
                if (printWindow && !printWindow.closed) printWindow.close();
                if (purchaseSaved) {
                    console.error("Purchase follow-up failed:", error);
                    window.alert("تم حفظ الفاتورة بنجاح، لكن تعذر تحديث الصفحة.");
                } else {
                    fail("purchaseMessage", error);
                }
                button.disabled = false;
            }
        });
        page.querySelector("#purchaseHistoryRows").addEventListener("click", async (event) => {
            const printButton = event.target.closest("[data-print-purchase-id]");
            if (printButton) {
                let printWindow;
                try {
                    printWindow = window.elSharqInvoicePrint.open();
                    const invoice = await window.elSharq.getPurchaseById(Number(printButton.dataset.printPurchaseId));
                    window.elSharqInvoicePrint.print(printWindow, {
                        ...invoice,
                        type: "purchase",
                        partyName: invoice.supplier_name || "مورد نقدي",
                        items: invoice.items
                    });
                } catch (error) {
                    if (printWindow && !printWindow.closed) printWindow.close();
                    fail(null, error);
                    window.alert(error?.message || "تعذرت طباعة فاتورة الشراء");
                }
                return;
            }
            const deleteButton = event.target.closest("[data-delete-purchase-id]");
            if (deleteButton) {
                const invoice = visibleInvoices.find((item) => Number(item.id) === Number(deleteButton.dataset.deletePurchaseId));
                if (!invoice || !window.confirm(`سيتم حذف فاتورة الشراء ${invoice.invoice_number}، وخصم كمياتها من المخزون وإلغاء أثر سدادها من الحسابات والخزنة. لا يمكن الحذف إذا كان المخزون الحالي لا يكفي لعكس الكميات. هل تريد المتابعة؟`)) return;
                const password = await window.requestDeletionPassword?.();
                if (password === null || password === undefined) return;
                try {
                    await window.elSharq.deletePurchase(invoice.id, password);
                    window.alert("تم حذف فاتورة الشراء وعكس أثرها.");
                    await purchases();
                } catch (error) {
                    console.error("Purchase deletion error:", error);
                    window.alert(error?.message || "تعذر حذف فاتورة الشراء");
                }
            }
        });
    }

    async function stock() {
        const [products, locations, movements] = await Promise.all([
            window.elSharq.getStockOverview(),
            window.elSharq.getLocations(),
            window.elSharq.getStockMovements()
        ]);
        const stockLocations = [
            { name: "المعرض", quantityKey: "showroom_quantity", icon: "🏪" },
            { name: "المخزن", quantityKey: "warehouse_quantity", icon: "📦" }
        ];
        const activeProducts = products.filter((product) => Number(product.active ?? 1) === 1);
        const locationSections = stockLocations.map((location) => {
            const locationId = locations.find((item) => item.name === location.name)?.id;
            if (!locationId) throw new Error(`موقع التخزين ${location.name} غير موجود`);
            const stockedProducts = products.filter((product) => Number(product[location.quantityKey] || 0) > 0);
            return `
                <section class="products-panel stock-location-panel">
                    <div class="stock-location-heading">
                        <div class="stock-location-icon" aria-hidden="true">${location.icon}</div>
                        <div><h3>بضاعة ${location.name}</h3><span>${stockedProducts.length.toLocaleString("ar-EG")} صنف مسجل في ${location.name}</span></div>
                    </div>
                    <div class="products-table-wrapper">
                        <table class="products-table stock-location-table">
                            <thead><tr><th>المنتج</th><th>الكود</th><th>القسم</th><th>تعديل الكمية</th></tr></thead>
                            <tbody>
                                ${stockedProducts.map((product) => `
                                    <tr data-stock-searchable="${escape(`${product.name} ${product.internal_code} ${product.category_name}`)}">
                                        <td><strong>${escape(product.name)}</strong></td>
                                        <td><span class="stock-product-code">${escape(product.internal_code || "-")}</span></td>
                                        <td>${escape(product.category_name || "-")}</td>
                                        <td>
                                            <form class="stock-quantity-form" data-stock-quantity-form data-product-id="${product.id}" data-location-id="${locationId}" data-current-quantity="${Number(product[location.quantityKey] || 0)}">
                                                <input type="number" min="0" step="0.01" value="${Number(product[location.quantityKey] || 0)}" required aria-label="الكمية الجديدة لـ ${escape(product.name)}">
                                                <span>${escape(product.unit || "قطعة")}</span>
                                                <button class="edit-btn stock-edit-button" type="submit">حفظ</button>
                                            </form>
                                            <span class="stock-quantity-message" aria-live="polite"></span>
                                        </td>
                                    </tr>
                                `).join("") || `<tr><td colspan="4"><div class="table-empty"><strong>لا توجد بضاعة مسجلة في ${location.name}</strong><span>يمكنك إضافة رصيد من تسوية الجرد</span></div></td></tr>`}
                            </tbody>
                        </table>
                    </div>
                </section>
            `;
        }).join("");
        const page = content("المخزن", "الأرصدة حسب مكان التخزين، تسوية الجرد وتحويل البضاعة.", `
            <div class="sales-panel">
                <div class="sales-panel-header"><div><h3>تسوية الجرد</h3><span>أدخل الرصيد الفعلي في الموقع المختار</span></div></div>
                <form id="stockAdjustForm" class="sale-info-grid">
                    ${productPicker("adjustProductSearch", "adjustProductDropdown", "adjustProduct", activeProducts)}
                    <div class="form-field"><label>الموقع</label><select id="adjustLocation">${locations.map((l) => `<option value="${l.id}">${escape(l.name)}</option>`).join("")}</select></div>
                    <div class="form-field"><label id="adjustQuantityLabel">الرصيد الفعلي</label><input id="adjustQuantity" type="number" min="0" step="0.01" required></div>
                    <div class="form-field"><label>ملاحظات</label><input id="adjustNotes" type="text"></div>
                    <div id="adjustMessage" class="product-form-message"></div><button class="primary-button" type="submit">حفظ التسوية</button>
                </form>
            </div>
            <div class="sales-panel">
                <div class="sales-panel-header"><div><h3>تحويل بين المواقع</h3><span>يتم التحقق من الرصيد قبل التحويل</span></div></div>
                <form id="stockTransferForm" class="sale-info-grid">
                    ${productPicker("transferProductSearch", "transferProductDropdown", "transferProduct", activeProducts)}
                    <div class="form-field"><label>من</label><select id="transferFrom">${locations.map((l) => `<option value="${l.id}">${escape(l.name)}</option>`).join("")}</select></div>
                    <div class="form-field"><label>إلى</label><select id="transferTo">${locations.map((l) => `<option value="${l.id}" ${locations.length > 1 && l.id === locations[1].id ? "selected" : ""}>${escape(l.name)}</option>`).join("")}</select></div>
                    <div class="form-field"><label id="transferQuantityLabel">الكمية</label><input id="transferQuantity" type="number" min="0.01" step="0.01" required></div>
                    <div id="transferMessage" class="product-form-message"></div><button class="primary-button" type="submit">تنفيذ التحويل</button>
                </form>
            </div>
            <div class="products-toolbar stock-search-toolbar">
                <div class="search-box">
                    <span aria-hidden="true">⌕</span>
                    <input type="search" id="stockProductSearch" placeholder="ابحث في المعرض والمخزن بالاسم أو الكود أو أكثر من كلمة..." aria-label="البحث في منتجات المخزن">
                </div>
            </div>
            <div class="stock-location-grid">${locationSections}</div>
            <div class="last-invoices-panel"><h3>آخر حركات المخزون</h3><div class="last-invoices-table-wrapper"><table class="last-invoices-table"><thead><tr><th>التاريخ</th><th>المنتج</th><th>الموقع</th><th>نوع الحركة</th><th>الكمية</th><th>ملاحظة</th></tr></thead><tbody>${movements.map((m) => `<tr><td>${dateText(m.created_at)}</td><td>${escape(m.product_name)}</td><td>${escape(m.location_name)}</td><td>${({ purchase: "شراء", sale: "بيع", transfer: "تحويل", adjustment: "تسوية", return: "مرتجع" })[m.movement_type] || escape(m.movement_type)}</td><td>${money(m.quantity)} ${escape(m.unit || "قطعة")}</td><td>${escape(m.notes || "-")}</td></tr>`).join("") || '<tr><td colspan="6">لا توجد حركات مخزون</td></tr>'}</tbody></table></div></div>
        `);
        const stockSearch = page.querySelector("#stockProductSearch");
        stockSearch.addEventListener("input", () => {
            const query = stockSearch.value;
            page.querySelectorAll("[data-stock-searchable]").forEach((row) => {
                row.hidden = !window.elSharqSearch.matches(query, row.dataset.stockSearchable);
            });
        });
        setupProductPicker(page, {
            inputId: "adjustProductSearch",
            dropdownId: "adjustProductDropdown",
            selectId: "adjustProduct",
            products: activeProducts
        });
        const transferProductPicker = setupProductPicker(page, {
            inputId: "transferProductSearch",
            dropdownId: "transferProductDropdown",
            selectId: "transferProduct",
            products: activeProducts,
            getCandidates: () => {
                const fromLocation = locations.find((location) => String(location.id) === page.querySelector("#transferFrom").value);
                const quantityKey = fromLocation?.name === "المخزن" ? "warehouse_quantity" : "showroom_quantity";
                return activeProducts.filter((product) => Number(product[quantityKey] || 0) > 0);
            }
        });
        const updateStockUnitLabels = () => {
            const adjustUnit = page.querySelector("#adjustProduct").selectedOptions[0]?.dataset.unit || "قطعة";
            const transferUnit = page.querySelector("#transferProduct").selectedOptions[0]?.dataset.unit || "قطعة";
            page.querySelector("#adjustQuantityLabel").textContent =
                adjustUnit === "متر" ? "الرصيد الفعلي (متر)" : "الرصيد الفعلي";
            page.querySelector("#transferQuantityLabel").textContent =
                transferUnit === "متر" ? "الكمية بالمتر" : "الكمية";
        };
        page.querySelector("#transferFrom").addEventListener("change", () => {
            transferProductPicker.clear();
            updateStockUnitLabels();
        });
        page.querySelector("#adjustProduct").addEventListener("change", updateStockUnitLabels);
        page.querySelector("#transferProduct").addEventListener("change", updateStockUnitLabels);
        updateStockUnitLabels();
        page.querySelectorAll("[data-stock-quantity-form]").forEach((form) => {
            form.addEventListener("submit", async (event) => {
                event.preventDefault();
                const input = form.querySelector("input");
                const message = form.nextElementSibling;
                const quantity = Number(input.value);
                if (!input.value.trim() || !Number.isFinite(quantity) || quantity < 0) {
                    message.textContent = "أدخل كمية صحيحة غير سالبة";
                    message.className = "stock-quantity-message error";
                    return;
                }
                if (quantity === Number(form.dataset.currentQuantity)) {
                    message.textContent = "الكمية لم تتغير";
                    message.className = "stock-quantity-message success";
                    return;
                }
                const button = form.querySelector("button");
                button.disabled = true;
                try {
                    await window.elSharq.adjustStock({
                        product_id: form.dataset.productId,
                        location_id: form.dataset.locationId,
                        quantity,
                        notes: "تعديل الكمية من جدول المخزون"
                    });
                    await stock();
                } catch (error) {
                    button.disabled = false;
                    console.error("Stock quantity update failed:", error);
                    message.textContent = error?.message || "تعذر تحديث الكمية";
                    message.className = "stock-quantity-message error";
                }
            });
        });
        page.querySelector("#stockAdjustForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                if (!page.querySelector("#adjustProduct").value) throw new Error("ابحث عن الصنف واختره أولًا");
                const result = await window.elSharq.adjustStock({
                    product_id: page.querySelector("#adjustProduct").value,
                    location_id: page.querySelector("#adjustLocation").value,
                    quantity: page.querySelector("#adjustQuantity").value,
                    notes: page.querySelector("#adjustNotes").value
                });
                status("adjustMessage", `تم حفظ التسوية (فرق ${money(result.difference)})`);
                await stock();
            } catch (error) { fail("adjustMessage", error); }
        });
        page.querySelector("#stockTransferForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                if (!page.querySelector("#transferProduct").value) throw new Error("ابحث عن الصنف واختره أولًا");
                const result = await window.elSharq.transferStock({
                    items: [{ product_id: page.querySelector("#transferProduct").value, quantity: page.querySelector("#transferQuantity").value }],
                    from_location_id: page.querySelector("#transferFrom").value,
                    to_location_id: page.querySelector("#transferTo").value
                });
                status("transferMessage", `تم التحويل ${result.transferNumber}`);
                await stock();
            } catch (error) { fail("transferMessage", error); }
        });
    }

    async function contacts(entity) {
        const isCustomer = entity === "customers";
        const title = isCustomer ? "العملاء" : "الموردون";
        const [records, outstanding] = await Promise.all([
            isCustomer ? window.elSharq.getCustomers() : window.elSharq.getSuppliers(),
            window.elSharq.getOutstandingInvoices(entity)
        ]);
        const page = content(title, `إدارة بيانات ${isCustomer ? "العملاء وأرصدتهم" : "الموردين وأرصدتهم"}.`, `
            <div class="sales-panel">
                <div class="sales-panel-header"><div><h3>${isCustomer ? "تحصيل دفعة من عميل" : "سداد دفعة لمورد"}</h3><span>يتم تحديث متبقي الفاتورة والحساب والخزنة تلقائيًا</span></div></div>
                <form id="accountPaymentForm" class="sale-info-grid">
                    <div class="form-field"><label>الفاتورة المستحقة</label><select id="accountPaymentInvoice" required><option value="">اختر الفاتورة</option>${outstanding.map((i) => `<option value="${i.id}" data-remaining="${i.remaining}">${escape(i.invoice_number)} — ${escape(i.contact_name)} — باقي ${money(i.remaining)} ج.م</option>`).join("")}</select></div>
                    <div class="form-field"><label>مبلغ ${isCustomer ? "التحصيل" : "السداد"}</label><input id="accountPaymentAmount" type="number" min="0.01" step="0.01" required></div>
                    <div id="paymentMessage" class="product-form-message"></div>
                    <button class="primary-button" type="submit">${isCustomer ? "تحصيل المبلغ" : "تسجيل السداد"}</button>
                </form>
            </div>
            <div class="sales-panel">
                <div class="sales-panel-header"><div><h3 id="contactFormTitle">إضافة ${isCustomer ? "عميل" : "مورد"}</h3></div></div>
                <form id="contactForm" class="sale-info-grid">
                    <div class="form-field"><label>الاسم</label><input id="contactName" required maxlength="160"></div>
                    <div class="form-field"><label>الهاتف</label><input id="contactPhone" type="tel"></div>
                    <div class="form-field"><label>العنوان</label><input id="contactAddress"></div>
                    <div class="form-field"><label>الرصيد الافتتاحي (${isCustomer ? "مستحق لنا" : "مستحق علينا"})</label><input id="contactOpening" type="number" min="0" step="0.01" value="0"></div>
                    <div class="form-field"><label>ملاحظات</label><input id="contactNotes"></div>
                    <div id="contactMessage" class="product-form-message"></div>
                    <button class="primary-button" type="submit">حفظ البيانات</button>
                    <button class="secondary-button" id="contactCancel" type="button" hidden>إلغاء التعديل</button>
                </form>
            </div>
            <div class="products-panel"><div class="products-table-wrapper"><table class="products-table"><thead><tr><th>الاسم</th><th>الهاتف</th><th>العنوان</th><th>الرصيد الحالي</th><th>ملاحظات</th><th>إجراءات</th></tr></thead><tbody>${records.map((r) => `<tr><td>${escape(r.name)}</td><td>${escape(r.phone || "-")}</td><td>${escape(r.address || "-")}</td><td>${money(r.balance)} ج.م</td><td>${escape(r.notes || "-")}</td><td><button type="button" data-edit-contact="${r.id}">تعديل</button></td></tr>`).join("") || '<tr><td colspan="6">لا توجد سجلات</td></tr>'}</tbody></table></div></div>
        `);
        const paymentInvoice = page.querySelector("#accountPaymentInvoice");
        paymentInvoice.addEventListener("change", () => {
            const remaining = paymentInvoice.selectedOptions[0]?.dataset.remaining;
            page.querySelector("#accountPaymentAmount").max = remaining || "";
            page.querySelector("#accountPaymentAmount").value = remaining || "";
        });
        page.querySelector("#accountPaymentForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                await window.elSharq.recordAccountPayment(
                    entity,
                    paymentInvoice.value,
                    page.querySelector("#accountPaymentAmount").value
                );
                await contacts(entity);
            } catch (error) { fail("paymentMessage", error); }
        });
        let editingId = null;
        const clear = () => {
            editingId = null;
            page.querySelector("#contactForm").reset();
            page.querySelector("#contactOpening").value = "0";
            page.querySelector("#contactFormTitle").textContent = `إضافة ${isCustomer ? "عميل" : "مورد"}`;
            page.querySelector("#contactCancel").hidden = true;
        };
        page.querySelector("#contactCancel").addEventListener("click", clear);
        page.querySelectorAll("[data-edit-contact]").forEach((button) => button.addEventListener("click", () => {
            const record = records.find((r) => Number(r.id) === Number(button.dataset.editContact));
            if (!record) return;
            editingId = record.id;
            page.querySelector("#contactName").value = record.name;
            page.querySelector("#contactPhone").value = record.phone || "";
            page.querySelector("#contactAddress").value = record.address || "";
            page.querySelector("#contactOpening").value = record.opening_balance || 0;
            page.querySelector("#contactNotes").value = record.notes || "";
            page.querySelector("#contactFormTitle").textContent = `تعديل ${record.name}`;
            page.querySelector("#contactCancel").hidden = false;
        }));
        page.querySelector("#contactForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                await window.elSharq.saveContact(entity, editingId, {
                    name: page.querySelector("#contactName").value,
                    phone: page.querySelector("#contactPhone").value,
                    address: page.querySelector("#contactAddress").value,
                    opening_balance: page.querySelector("#contactOpening").value,
                    notes: page.querySelector("#contactNotes").value
                });
                await contacts(entity);
            } catch (error) { fail("contactMessage", error); }
        });
    }

    async function cashier() {
        const [accounts, entries, categories] = await Promise.all([
            window.elSharq.getCashSummary(),
            window.elSharq.getCashTransactions(),
            window.elSharq.getExpenseCategories()
        ]);
        const page = content("الخزنة", "متابعة الرصيد وتسجيل المقبوضات والمصروفات.", `
            <div class="stats-grid">${accounts.map((a) => `<div class="stat-card"><div class="stat-icon cash">خ</div><div><span>${escape(a.name)}</span><strong>${money(a.balance)} ج.م</strong></div></div>`).join("")}</div>
            <div class="sales-panel"><div class="sales-panel-header"><div><h3>تسجيل حركة نقدية</h3></div></div>
                <form id="cashForm" class="sale-info-grid">
                    <div class="form-field"><label>نوع الحركة</label><select id="cashDirection"><option value="in">إيراد / مقبوضات</option><option value="out">مصروف / مدفوعات</option></select></div>
                    <div class="form-field"><label>الخزنة</label><select id="cashAccount">${accounts.map((a) => `<option value="${a.id}">${escape(a.name)}</option>`).join("")}</select></div>
                    <div class="form-field"><label>المبلغ</label><input id="cashAmount" type="number" min="0.01" step="0.01" required></div>
                    <div class="form-field" id="expenseCategoryWrap" hidden><label>بند المصروف</label><select id="expenseCategory"><option value="">بدون تصنيف</option>${categories.map((c) => `<option value="${c.id}">${escape(c.name)}</option>`).join("")}</select></div>
                    <div class="form-field"><label>البيان</label><input id="cashDescription" required></div>
                    <div id="cashMessage" class="product-form-message"></div><button class="primary-button" type="submit">تسجيل الحركة</button>
                </form>
            </div>
            <div class="last-invoices-panel"><h3>آخر الحركات النقدية</h3><div class="last-invoices-table-wrapper"><table class="last-invoices-table"><thead><tr><th>التاريخ</th><th>الخزنة</th><th>البيان</th><th>النوع</th><th>القيمة</th></tr></thead><tbody>${entries.map((e) => `<tr><td>${dateText(e.created_at)}</td><td>${escape(e.account_name)}</td><td>${escape(e.description || "-")}</td><td>${e.direction === "in" ? "مقبوض" : "مدفوع"}</td><td>${e.direction === "in" ? "+" : "-"}${money(e.amount)} ج.م</td></tr>`).join("") || '<tr><td colspan="5">لا توجد حركات</td></tr>'}</tbody></table></div></div>
        `);
        page.querySelector("#cashDirection").addEventListener("change", (event) => {
            page.querySelector("#expenseCategoryWrap").hidden = event.target.value !== "out";
        });
        page.querySelector("#cashForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                await window.elSharq.addCashTransaction({
                    direction: page.querySelector("#cashDirection").value,
                    account_id: page.querySelector("#cashAccount").value,
                    amount: page.querySelector("#cashAmount").value,
                    expense_category_id: page.querySelector("#expenseCategory").value || null,
                    description: page.querySelector("#cashDescription").value
                });
                await cashier();
            } catch (error) { fail("cashMessage", error); }
        });
    }

    async function reports() {
        const today = localDate();
        const summary = await window.elSharq.getReportSummary({ from: today, to: today });
        const page = content("التقارير", "ملخص أداء المبيعات والمشتريات والمصروفات والأرباح.", `
            <form id="reportRange" class="sale-info-grid">
                <div class="form-field"><label>من</label><input id="reportFrom" type="date" value="${today}" required></div>
                <div class="form-field"><label>إلى</label><input id="reportTo" type="date" value="${today}" required></div>
                <button class="primary-button" type="submit">عرض التقرير</button><div id="reportMessage" class="product-form-message"></div>
            </form>
            <div class="stats-grid" id="reportCards"></div>
        `);
        const draw = (data) => {
            page.querySelector("#reportCards").innerHTML = `
                <div class="stat-card"><div class="stat-icon sales">م</div><div><span>المبيعات (${data.sales.count} فاتورة)</span><strong>${money(data.sales.total)} ج.م</strong><small>محصل ${money(data.sales.paid)} / آجل ${money(data.sales.remaining)}</small></div></div>
                <div class="stat-card"><div class="stat-icon cash">ش</div><div><span>المشتريات (${data.purchases.count} فاتورة)</span><strong>${money(data.purchases.total)} ج.م</strong><small>محصل ${money(data.purchases.paid)} / آجل ${money(data.purchases.remaining)}</small></div></div>
                <div class="stat-card"><div class="stat-icon profit">ر</div><div><span>مجمل الربح التقديري</span><strong>${money(data.sales.profit)} ج.م</strong></div></div>
                <div class="stat-card"><div class="stat-icon cash">ص</div><div><span>المصروفات</span><strong>${money(data.expenses)} ج.م</strong></div></div>
                <div class="stat-card"><div class="stat-icon stock">م</div><div><span>قيمة المخزون بالتكلفة</span><strong>${money(data.stockValue)} ج.م</strong></div></div>
            `;
        };
        draw(summary);
        page.querySelector("#reportRange").addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                draw(await window.elSharq.getReportSummary({
                    from: page.querySelector("#reportFrom").value,
                    to: page.querySelector("#reportTo").value
                }));
                status("reportMessage", "");
            } catch (error) { fail("reportMessage", error); }
        });
    }

    async function settings() {
        const values = await window.elSharq.getSettings();
        const storeName = values.store_name?.trim();
        if (storeName) {
            const brandName = document.querySelector(".brand-text h1");
            const brandPill = document.querySelector(".brand-pill span");
            if (brandName) brandName.textContent = storeName;
            if (brandPill) brandPill.textContent = storeName;
        }
        const page = content("الإعدادات", "بيانات المنشأة التي تظهر داخل النظام.", `
            <div class="sales-panel"><form id="settingsForm" class="sale-info-grid">
                <div class="form-field"><label>اسم المنشأة</label><input id="storeName" maxlength="160" value="${escape(values.store_name || "الشرق")}"></div>
                <div class="form-field"><label>الهاتف</label><input id="storePhone" type="tel" value="${escape(values.store_phone || "")}"></div>
                <div class="form-field"><label>العنوان</label><input id="storeAddress" value="${escape(values.store_address || "")}"></div>
                <div class="form-field"><label>العملة</label><input value="جنيه مصري" disabled></div>
                <div id="settingsMessage" class="product-form-message"></div><button class="primary-button" type="submit">حفظ الإعدادات</button>
            </form>
            <div class="sale-info-grid">
                <button class="secondary-button" id="backupDatabaseButton" type="button">إنشاء نسخة احتياطية</button>
                <div id="backupMessage" class="product-form-message"></div>
            </div></div>
            <div class="sales-panel">
                <div class="sales-panel-header"><div><h3>كلمة مرور الحذف</h3><span>${values.deletion_password_configured ? "تم إعداد كلمة مرور. أدخل الحالية لتغييرها." : "أنشئ كلمة مرور مستقلة مطلوبة قبل حذف الفواتير أو الأصناف."}</span></div></div>
                <form id="deletionPasswordForm" class="sale-info-grid">
                    ${values.deletion_password_configured ? '<div class="form-field"><label for="currentDeletionPassword">كلمة المرور الحالية</label><input id="currentDeletionPassword" type="password" autocomplete="current-password" required></div>' : ""}
                    <div class="form-field"><label for="newDeletionPassword">كلمة المرور الجديدة (8 أحرف على الأقل)</label><input id="newDeletionPassword" type="password" minlength="8" autocomplete="new-password" required></div>
                    <div class="form-field"><label for="confirmDeletionPassword">تأكيد كلمة المرور</label><input id="confirmDeletionPassword" type="password" minlength="8" autocomplete="new-password" required></div>
                    <div id="deletionPasswordMessage" class="product-form-message"></div>
                    <button class="primary-button" type="submit">${values.deletion_password_configured ? "تغيير كلمة مرور الحذف" : "تعيين كلمة مرور الحذف"}</button>
                </form>
            </div>
        `);
        page.querySelector("#settingsForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                await window.elSharq.saveSettings({
                    store_name: page.querySelector("#storeName").value,
                    store_phone: page.querySelector("#storePhone").value,
                    store_address: page.querySelector("#storeAddress").value
                });
                const updatedName = page.querySelector("#storeName").value.trim();
                if (updatedName) {
                    const brandName = document.querySelector(".brand-text h1");
                    const brandPill = document.querySelector(".brand-pill span");
                    if (brandName) brandName.textContent = updatedName;
                    if (brandPill) brandPill.textContent = updatedName;
                }
                status("settingsMessage", "تم حفظ الإعدادات");
            } catch (error) { fail("settingsMessage", error); }
        });
        page.querySelector("#backupDatabaseButton").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                const result = await window.elSharq.backupDatabase();
                if (result.canceled) return;
                status("backupMessage", "تم حفظ النسخة الاحتياطية بنجاح");
            } catch (error) {
                fail("backupMessage", error);
            } finally {
                button.disabled = false;
            }
        });
        page.querySelector("#deletionPasswordForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            const newPassword = page.querySelector("#newDeletionPassword").value;
            if (newPassword !== page.querySelector("#confirmDeletionPassword").value) {
                return status("deletionPasswordMessage", "كلمتا المرور غير متطابقتين", true);
            }
            const button = event.currentTarget.querySelector('[type="submit"]');
            button.disabled = true;
            try {
                await window.elSharq.setDeletionPassword(
                    page.querySelector("#currentDeletionPassword")?.value || "",
                    newPassword
                );
                status("deletionPasswordMessage", "تم حفظ كلمة مرور الحذف");
                await settings();
            } catch (error) {
                fail("deletionPasswordMessage", error);
            } finally {
                button.disabled = false;
            }
        });
    }

    window.elSharqPages = {
        async show(page) {
            const renderers = {
                purchases,
                stock,
                customers: () => contacts("customers"),
                suppliers: () => contacts("suppliers"),
                cashier,
                reports,
                settings
            };
            const renderer = renderers[page];
            if (!renderer) throw new Error(`الصفحة غير معروفة: ${page}`);
            try {
                await renderer();
            } catch (error) {
                console.error(`Failed to load ${page} page:`, error);
                const message = error?.message || "حدث خطأ غير معروف";
                content("تعذر تحميل الصفحة", "فشل الاتصال بقاعدة البيانات أو تحميل بيانات الوحدة.", `
                    <div class="product-form-message error">${escape(message)}</div>
                `);
            }
        }
    };
})();
