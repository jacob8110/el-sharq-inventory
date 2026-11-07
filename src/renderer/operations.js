(() => {
    const escape = (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const money = (value) => Number(value || 0).toFixed(2).replace(/(?:\.0+|(\.\d*?)0+)$/, "$1");
    const localDate = () => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    };
    const localDateForChart = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
        let activeIndex = -1;

        const updateActiveOption = (options) => {
            options.forEach((opt, idx) => {
                if (idx === activeIndex) {
                    opt.classList.add("is-active");
                    opt.scrollIntoView({ block: "nearest" });
                } else {
                    opt.classList.remove("is-active");
                }
            });
        };

        const render = () => {
            const query = input.value;
            const candidates = getCandidates();
            const matches = candidates.filter((product) => window.elSharqSearch.matches(
                query,
                product.name,
                product.internal_code,
                product.barcode,
                product.category_name
            )).slice(0, 30);
            activeIndex = -1;
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
            if (dropdown.hidden) return;
            const options = Array.from(dropdown.querySelectorAll("[data-product-picker-id]"));
            if (!options.length) return;

            if (event.key === "ArrowDown") {
                event.preventDefault();
                activeIndex = (activeIndex + 1) % options.length;
                updateActiveOption(options);
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                activeIndex = (activeIndex - 1 + options.length) % options.length;
                updateActiveOption(options);
            } else if (event.key === "Enter") {
                event.preventDefault();
                const target = activeIndex >= 0 ? options[activeIndex] : options[0];
                if (target) target.click();
            } else if (event.key === "Escape") {
                dropdown.hidden = true;
            }
        });

        input.addEventListener("blur", () => {
            setTimeout(() => {
                dropdown.hidden = true;
            }, 180);
        });

        dropdown.addEventListener("mousedown", (event) => {
            if (event.target.closest("[data-product-picker-id]")) event.preventDefault();
        });

        dropdown.addEventListener("click", (event) => {
            const button = event.target.closest("[data-product-picker-id]");
            if (!button) return;
            const product = products.find((item) => Number(item.id) === Number(button.dataset.productPickerId));
            if (!product) return;
            select.value = String(product.id);
            input.value = `${product.name} — ${product.internal_code || ""}`;
            dropdown.hidden = true;
            select.dispatchEvent(new Event("change", { bubbles: true }));

            // نقل المؤشر تلقائياً لخانة الكمية لسرعة الإدخال
            const rowOrForm = input.closest("tr, form, .form-row, .invoice-entry, .panel-body, div");
            const qtyInput = rowOrForm ? rowOrForm.querySelector('input[type="number"], input[id*="qty"], input[id*="quantity"]') : null;
            if (qtyInput) {
                qtyInput.focus();
                qtyInput.select();
            }
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
        const [products, suppliers, locations, invoices, cashAccounts] = await Promise.all([
            window.elSharq.getProducts(),
            window.elSharq.getSuppliers(),
            window.elSharq.getLocations(),
            window.elSharq.getPurchases(),
            window.elSharq.getCashAccounts()
        ]);
        const purchaseProducts = products.filter((p) => Number(p.active) === 1);
        const purchaseCategories = [...new Set(
            purchaseProducts.map((p) => String(p.category_name || "").trim()).filter(Boolean)
        )].sort((a, b) => {
            const priority = (name) => /كهرباء/.test(name) ? 0 : /سباكة/.test(name) ? 1 : /سيراميك|أدوات\s*صحي|ادوات\s*صحي|حمام/.test(name) ? 2 : 3;
            return priority(a) - priority(b) || a.localeCompare(b, "ar");
        });
        const renderPurchaseRows = (purchaseRows) => purchaseRows.length
            ? purchaseRows.map((invoice) => `<tr data-purchase-row data-purchase-id="${invoice.id}" data-purchase-supplier="${invoice.supplier_id || ""}" data-purchase-invoice="${escape(invoice.invoice_number)}" data-purchase-search="${escape(`${invoice.invoice_number} ${invoice.supplier_name || "مورد غير مسجل"} ${invoice.notes || ""}`)}"><td>${escape(invoice.invoice_number)}</td><td>${dateText(invoice.created_at)}</td><td>${escape(invoice.supplier_name || "مورد غير مسجل")}</td><td>${money(invoice.total)} ج.م</td><td>${money(invoice.paid)} ج.م</td><td>${money(invoice.remaining)} ج.م</td><td><button class="view-btn" type="button" data-print-purchase-id="${invoice.id}">طباعة</button> <button class="delete-btn" type="button" data-delete-purchase-id="${invoice.id}">حذف</button></td></tr>`).join("")
            : '<tr><td colspan="7">لا توجد فواتير مطابقة</td></tr>';
        let visibleInvoices = invoices;
        const page = content("المشتريات", "تسجيل فواتير الشراء وتحديث المخزون وحساب المورد.", `
            <div class="sales-panel">
                <div class="sales-panel-header"><div><h3>فاتورة شراء جديدة</h3><span>تضاف الكميات للمخزون عند الحفظ</span></div></div>
                <form id="purchaseForm" novalidate>
    <div class="purchase-top-grid">
        <div class="form-field">
            <label for="purchaseSupplierName">المورد / الشركة</label>
            <input id="purchaseSupplierName" type="text" list="purchaseSupplierOptions" autocomplete="off" placeholder="اكتب اسم المورد أو اختره">
            <datalist id="purchaseSupplierOptions">${suppliers.map((s) => `<option value="${escape(s.name)}"></option>`).join("")}</datalist>
        </div>
        <div class="form-field">
            <label for="purchaseLocation">مكان التخزين</label>
            <select id="purchaseLocation">${locations.map((l) => `<option value="${l.id}">${escape(l.name)}</option>`).join("")}</select>
        </div>
        <div class="form-field">
            <label for="purchaseCategoryFilter">قسم الطلبية</label>
            <select id="purchaseCategoryFilter">
                <option value="">كل الأقسام</option>
                ${purchaseCategories.map((category) => `<option value="${escape(category)}">${escape(category)}</option>`).join("")}
            </select>
        </div>
        <div class="form-field">
            <label for="purchaseDefaultDiscount">خصم الشركة على سعر الليستة (%)</label>
            <input id="purchaseDefaultDiscount" type="number" min="0" max="100" step="0.01" value="" placeholder="اتركه فارغًا للتسعير اليدوي">
            <small>حدّد الخصم قبل إضافة الأصناف؛ يُطبّق على كل أصناف الفاتورة</small>
        </div>
    </div>

    <div class="purchase-quick-bar">
        <div class="purchase-item-picker">
            ${productPicker("purchaseProductSearch", "purchaseProductDropdown", "purchaseProduct", purchaseProducts)}
        </div>
        <div class="purchase-field-sm">
            <label id="purchaseQtyLabel" for="purchaseQty">الكمية</label>
            <input id="purchaseQty" type="number" min="0.01" step="0.01" placeholder="الكمية">
        </div>
        <div class="purchase-field-sm" id="purchaseCostField">
            <label for="purchaseCost">سعر الشراء (جملة)</label>
            <input id="purchaseCost" type="number" min="0" step="0.01" placeholder="سعر الجملة">
            <small id="purchaseNetCostPreview" class="purchase-net-preview">أدخل سعر الشراء يدويًا إذا تركت الخصم فارغًا</small>
            <small id="purchasePurchasePriceHint" class="purchase-net-preview">الجملة بالنظام: — | الجديدة: —</small>
        </div>
        <div class="purchase-field-sm" id="purchaseListPriceField" hidden>
            <label for="purchaseListPrice">السعر القطاعي / الليستة</label>
            <input id="purchaseListPrice" type="number" min="0.01" step="0.01" placeholder="سعر الليستة">
            <small id="purchaseListPricePreview" class="purchase-net-preview">الجملة بعد الخصم: —</small>
            <small id="purchaseListHints" class="purchase-net-preview">الجملة والقطاعي بالنظام: —</small>
        </div>
        <div class="purchase-field-sm" id="purchaseSalePriceField" hidden>
            <label for="purchaseSalePrice">سعر البيع القطاعي</label>
            <input id="purchaseSalePrice" type="number" min="0.01" step="0.01" placeholder="سعر القطاعي">
            <small id="purchaseSalePriceHint" class="purchase-net-preview">القطاعي بالنظام: — | الجديد: —</small>
        </div>
        <div class="purchase-field-btn">
            <button class="secondary-button" id="purchaseUseOldPrices" type="button" disabled>ملء الأسعار القديمة</button>
            <button class="primary-button" id="purchaseAddItem" type="button">إضافة الصنف</button>
        </div>
    </div>
    <div class="last-invoices-table-wrapper"><table class="last-invoices-table"><thead><tr><th>الصنف / القسم</th><th>الكمية</th><th>اللستة / سعر الشراء الصافي</th><th>سعر البيع القطاعي</th><th>الإجمالي</th><th></th></tr></thead><tbody id="purchaseItems"><tr><td colspan="6">لم تتم إضافة أصناف</td></tr></tbody></table></div>
                    <div class="sale-info-grid">
                        <div class="form-field"><label for="purchasePaymentMode">طريقة الدفع</label><select id="purchasePaymentMode"><option value="cash">نقدًا بالكامل</option><option value="credit">آجل بالكامل</option><option value="mixed">جزء نقدًا والباقي آجل</option></select></div>
                        <div class="form-field"><label for="purchaseCashAccount">الخزنة التي سيتم الدفع منها</label><select id="purchaseCashAccount">${cashAccounts.map((account) => `<option value="${account.id}" ${account.name === "الخزنة الرئيسية" ? "selected" : ""}>${escape(account.name)}</option>`).join("")}</select></div><div class="form-field"><label for="purchasePaid">المبلغ المدفوع من الخزنة</label><input id="purchasePaid" type="number" min="0" step="0.01" value="0"></div>
                        <div class="form-field"><label for="purchaseNotes">ملاحظات</label><input id="purchaseNotes" type="text"></div>
                    </div>
                    <p id="purchaseTotal">الإجمالي: 0.00 ج.م</p>
                    <p class="purchase-cost-note">الخصم المكتوب هنا على الليستة يحسب سعر الجملة تلقائيًا. اتركه فارغًا لإدخال الجملة والقطاعي يدويًا. تُحدّث الأسعار للأصناف المضافة فقط، ولا تتغير الفواتير السابقة.</p>
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
            products: purchaseProducts
        });
        const purchaseCategoryFilter = page.querySelector("#purchaseCategoryFilter");
        const refreshPurchaseProductFilter = () => {
            const chosenCategory = purchaseCategoryFilter.value;
            const filteredProducts = products.filter((product) =>
                Number(product.active) === 1 &&
                (!chosenCategory || String(product.category_name || "").trim() === chosenCategory)
            );

            // Keep the same array object because the existing autocomplete closes over it.
            purchaseProducts.splice(0, purchaseProducts.length, ...filteredProducts);

            purchasePicker.clear();
            const searchInput = page.querySelector("#purchaseProductSearch");
            const dropdown = page.querySelector("#purchaseProductDropdown");
            searchInput.value = "";
            dropdown.innerHTML = "";

            productSelect.innerHTML = "";
            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = "اختر الصنف";
            productSelect.appendChild(placeholder);

            for (const product of filteredProducts) {
                const option = document.createElement("option");
                option.value = String(product.id);
                option.textContent = `${product.name}${product.category_name ? ` — ${product.category_name}` : ""}`;
                option.dataset.unit = product.unit || "قطعة";
                option.dataset.category = product.category_name || "";
                productSelect.appendChild(option);
            }

            productSelect.value = "";
            productSelect.dispatchEvent(new Event("change", { bubbles: true }));
            page.querySelector("#purchaseQty").value = "";
            page.querySelector("#purchaseCost").value = "";
            page.querySelector("#purchaseSalePrice").value = "";
            updateSelectedPricing();
        };
        purchaseCategoryFilter.addEventListener("change", refreshPurchaseProductFilter);

        // The existing picker handles arrow navigation; this fallback makes Enter choose
        // the highlighted suggestion, or the first visible suggestion if none is highlighted.
        page.querySelector("#purchaseProductSearch").addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            if (productSelect.value) return;

            const dropdown = page.querySelector("#purchaseProductDropdown");
            if (dropdown.hidden || dropdown.getClientRects().length === 0) return;
            const target = dropdown.querySelector(
                '[aria-selected="true"], .active, .highlighted, .selected, [role="option"], button, [data-product-id], [data-value], li'
            ) || dropdown.firstElementChild;
            if (!target) return;

            event.preventDefault();
            target.click();
        });
        const discountDefaultInput = page.querySelector("#purchaseDefaultDiscount");
        const wholesaleInput = page.querySelector("#purchaseCost");
        const retailInput = page.querySelector("#purchaseSalePrice");
        const listPriceInput = page.querySelector("#purchaseListPrice");
        const useOldPricesButton = page.querySelector("#purchaseUseOldPrices");
        const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
        const getDefaultDiscount = () => {
            const raw = discountDefaultInput.value.trim();
            if (!raw) return null;
            const value = Number(raw);
            return Number.isFinite(value) && value >= 0 && value <= 100 ? value : NaN;
        };
        let selectedAutoDiscount = false;
        const oldPositivePrice = (value) => {
            const amount = Number(value);
            return Number.isFinite(amount) && amount > 0 ? String(amount) : "";
        };
        const getOldCeramicMeterPrices = (product) => {
            const tileArea = (Number(product.tile_length_cm || 0) * Number(product.tile_width_cm || 0)) / 10000;
            const cartonArea = tileArea * Number(product.tiles_per_carton || 0);
            const wholesale = product.ceramic_purchase_price_per_sqm != null
                ? Number(product.ceramic_purchase_price_per_sqm)
                : product.unit === "متر" ? Number(product.purchase_price || 0)
                : product.unit === "بلاطة" && tileArea > 0 ? Number(product.purchase_price || 0) / tileArea
                : cartonArea > 0 ? Number(product.purchase_price || 0) / cartonArea : null;
            const retail = cartonArea > 0 ? Number(product.sale_price || 0) / cartonArea : null;
            return { wholesale, retail };
        };
        const fillOldPurchasePrices = () => {
            const product = products.find((item) => Number(item.id) === Number(productSelect.value));
            if (!product) {
                updateSelectedPricing();
                return;
            }
            const discount = getDefaultDiscount();
            const isCeramic = String(product.category_name || "").trim() === "سيراميك";
            const autoDiscount = !isCeramic && discount !== null && Number.isFinite(discount);
            if (isCeramic) {
                const oldPrices = getOldCeramicMeterPrices(product);
                wholesaleInput.value = oldPositivePrice(oldPrices.wholesale);
                retailInput.value = oldPositivePrice(oldPrices.retail);
                listPriceInput.value = "";
            } else if (autoDiscount) {
                // Keep the entered invoice discount; the saved retail/list price is the default.
                wholesaleInput.value = "";
                retailInput.value = "";
                listPriceInput.value = oldPositivePrice(product.sale_price);
            } else {
                wholesaleInput.value = oldPositivePrice(product.purchase_price);
                retailInput.value = oldPositivePrice(product.sale_price);
                listPriceInput.value = "";
            }
            updateSelectedPricing();
        };
        const updateSelectedPricing = ({ resetValues = false } = {}) => {
            const product = products.find((item) => Number(item.id) === Number(productSelect.value));
            const discount = getDefaultDiscount();
            const isCeramic = String(product?.category_name || "").trim() === "سيراميك";
            const autoDiscount = !isCeramic && discount !== null && Number.isFinite(discount);
            useOldPricesButton.disabled = !product;
            if (resetValues) {
                wholesaleInput.value = "";
                retailInput.value = "";
                listPriceInput.value = "";
            } else if (product && autoDiscount !== selectedAutoDiscount) {
                // Switching pricing mode keeps the prior retail value as the editable list price.
                if (autoDiscount) {
                    listPriceInput.value = retailInput.value.trim() || oldPositivePrice(product.sale_price);
                    wholesaleInput.value = "";
                    retailInput.value = "";
                } else {
                    retailInput.value = listPriceInput.value.trim() || oldPositivePrice(product.sale_price);
                    wholesaleInput.value = oldPositivePrice(product.purchase_price);
                    listPriceInput.value = "";
                }
            }
            selectedAutoDiscount = autoDiscount;
            page.querySelector("#purchaseCostField").hidden = autoDiscount;
            page.querySelector("#purchaseListPriceField").hidden = !autoDiscount;
            page.querySelector("#purchaseSalePriceField").hidden = autoDiscount;
            if (isCeramic) {
                const { wholesale: oldWholesale, retail: oldRetail } = getOldCeramicMeterPrices(product);
                const newWholesale = wholesaleInput.value.trim() ? Number(wholesaleInput.value) : null;
                const newRetail = retailInput.value.trim() ? Number(retailInput.value) : null;
                const format = (value) => value == null || !Number.isFinite(value) ? "غير متاح" : `${money(value)} ج.م`;
                page.querySelector('label[for="purchaseCost"]').textContent = "سعر الجملة للمتر المربع";
                page.querySelector('label[for="purchaseSalePrice"]').textContent = "سعر القطاعي للمتر المربع";
                page.querySelector("#purchaseQty").placeholder = "الكمية بالمتر المربع";
                page.querySelector("#purchasePurchasePriceHint").textContent = `الجملة القديمة بالمتر المربع: ${format(oldWholesale)} | الجديدة: ${format(newWholesale)}`;
                page.querySelector("#purchaseSalePriceHint").textContent = `القطاعي القديم بالمتر المربع: ${format(oldRetail)} | الجديد: ${format(newRetail)}`;
                page.querySelector("#purchaseNetCostPreview").textContent = "أدخل سعر الجملة للمتر المربع";
                page.querySelector("#purchaseListPricePreview").textContent = "";
                page.querySelector("#purchaseListHints").textContent = "";
                return;
            }
            page.querySelector('label[for="purchaseCost"]').textContent = "سعر الشراء (جملة)";
            page.querySelector('label[for="purchaseSalePrice"]').textContent = "سعر البيع القطاعي";
            page.querySelector("#purchaseQty").placeholder = "الكمية";
            const listPriceRaw = autoDiscount ? listPriceInput.value : retailInput.value;
            const listPrice = Number(listPriceRaw);
            const newWholesale = autoDiscount
                ? (listPriceInput.value.trim() && Number.isFinite(listPrice) ? roundMoney(listPrice * (1 - discount / 100)) : null)
                : (wholesaleInput.value.trim() ? Number(wholesaleInput.value) : null);
            page.querySelector("#purchaseNetCostPreview").textContent = "الخصم فارغ: أدخل سعر الجملة يدويًا";
            page.querySelector("#purchasePurchasePriceHint").textContent = `الجملة بالنظام: ${product?.purchase_price == null ? "—" : money(product.purchase_price)} | الجديدة: ${newWholesale == null || !Number.isFinite(newWholesale) ? "—" : money(newWholesale)} ج.م`;
            const newRetail = autoDiscount
                ? (listPriceInput.value.trim() && Number.isFinite(listPrice) ? listPrice : null)
                : (retailInput.value.trim() ? Number(retailInput.value) : null);
            page.querySelector("#purchaseSalePriceHint").textContent = `القطاعي بالنظام: ${product?.sale_price == null ? "—" : money(product.sale_price)} | الجديد: ${newRetail == null || !Number.isFinite(newRetail) ? "—" : money(newRetail)} ج.م`;
            page.querySelector("#purchaseListPricePreview").textContent = newWholesale == null || !Number.isFinite(newWholesale)
                ? (discount === null ? "أدخل خصمًا أولًا" : `الجملة بعد خصم ${discount}%: —`)
                : `الجملة بعد خصم ${discount}%: ${money(newWholesale)} ج.م`;
            page.querySelector("#purchaseListHints").textContent = `الجملة بالنظام: ${product?.purchase_price == null ? "—" : money(product.purchase_price)} | القطاعي بالنظام: ${product?.sale_price == null ? "—" : money(product.sale_price)}`;
        };
        const syncPurchasePayment = () => {
            const mode = page.querySelector("#purchasePaymentMode").value;
            const paidInput = page.querySelector("#purchasePaid");
            const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
            const total = subtotal;
            if (mode === "cash") paidInput.value = total.toFixed(2).replace(/(?:\.0+|(\.\d*?)0+)$/, "$1");
            else if (mode === "credit") paidInput.value = "0";
            paidInput.readOnly = mode !== "mixed";
        };
        const drawItems = () => {
            const body = page.querySelector("#purchaseItems");
            const total = items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
            if (!items.length) {
                body.innerHTML = '<tr><td colspan="6">لم تتم إضافة أصناف</td></tr>';
            } else {
                const getGroup = (item) => {
                    const category = String(item.category_name || (item.is_plumbing ? "سباكة" : "غير مصنف")).trim();
                    if (/كهرباء/.test(category)) return "الكهرباء";
                    if (item.is_plumbing || /سباكة/.test(category)) return "السباكة";
                    if (/سيراميك|أدوات\s*صحي|ادوات\s*صحي|حمام/.test(category)) return "السيراميك والأدوات الصحية";
                    return `أقسام أخرى: ${category}`;
                };
                const groupPriority = (name) => name === "الكهرباء" ? 0 : name === "السباكة" ? 1 : name === "السيراميك والأدوات الصحية" ? 2 : 3;
                const grouped = new Map();
                items.forEach((item, index) => {
                    const group = getGroup(item);
                    if (!grouped.has(group)) grouped.set(group, []);
                    grouped.get(group).push({ item, index });
                });

                let html = "";
                const groups = [...grouped.entries()].sort((a, b) => groupPriority(a[0]) - groupPriority(b[0]) || a[0].localeCompare(b[0], "ar"));
                for (const [groupName, entries] of groups) {
                    const groupTotal = entries.reduce((sum, entry) => sum + entry.item.quantity * entry.item.unit_cost, 0);
                    html += `<tr class="purchase-section-heading"><td colspan="6" style="font-weight:700;border-top:2px solid var(--border-color, #888);"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><span>${escape(groupName)}</span><span>إجمالي القسم: ${money(groupTotal)} ج.م</span></div></td></tr>`;
                    html += entries.map(({ item, index }) => `
                        <tr>
                            <td><strong>${escape(item.name)}</strong><small>${escape(item.category_name || (item.is_plumbing ? "سباكة" : "غير مصنف"))}</small></td>
                            <td>${item.quantity} ${escape(item.unit)}</td>
                            <td>${item.pricing_mode === "discount" ? `${money(item.list_price)} − خصم ${item.discount_percent}% = ${money(item.unit_cost)}` : money(item.unit_cost)}</td>
                            <td>${money(item.sale_price ?? item.list_price ?? 0)}</td>
                            <td>${money(item.quantity * item.unit_cost)}</td>
                            <td><button type="button" data-remove="${index}">حذف</button></td>
                        </tr>
                    `).join("");
                }
                body.innerHTML = html;
            }
            page.querySelector("#purchaseTotal").textContent = `إجمالي المشتريات: ${money(total)} ج.م`;
            discountDefaultInput.disabled = items.length > 0;
            discountDefaultInput.title = items.length > 0
                ? "لحماية توحيد الخصم، احذف الأصناف أولًا إذا أردت تغيير نسبة الخصم أو طريقة التسعير"
                : "يُطبّق على كل الأصناف التالية في الفاتورة";
            body.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => {
                items.splice(Number(button.dataset.remove), 1);
                drawItems();
            }));
            syncPurchasePayment();
        };
        productSelect.addEventListener("change", () => {
            const selected = productSelect.selectedOptions[0];
            const product = products.find((item) => Number(item.id) === Number(productSelect.value));
            const unit = selected?.dataset.unit || product?.unit || "قطعة";
            page.querySelector("#purchaseQtyLabel").textContent =
                product?.category_name === "سيراميك" ? "الكمية بالمتر المربع"
                    : unit === "متر" ? "الكمية بالمتر" : unit === "كيلو" ? "الكمية بالكيلو" : "الكمية";
            updateSelectedPricing({ resetValues: true });
            fillOldPurchasePrices();
        });
        useOldPricesButton.addEventListener("click", fillOldPurchasePrices);
        wholesaleInput.addEventListener("input", () => updateSelectedPricing());
        retailInput.addEventListener("input", () => updateSelectedPricing());
        listPriceInput.addEventListener("input", () => updateSelectedPricing());
        discountDefaultInput.addEventListener("input", () => {
            const discount = getDefaultDiscount();
            discountDefaultInput.setCustomValidity(discount !== null && !Number.isFinite(discount)
                ? "أدخل خصمًا بين 0 و100 أو اترك الخانة فارغة" : "");
            updateSelectedPricing();
        });
        page.querySelector("#purchasePaymentMode").addEventListener("change", () => {
            if (page.querySelector("#purchasePaymentMode").value === "mixed") {
                page.querySelector("#purchasePaid").value = "0";
            }
            syncPurchasePayment();
        });
        syncPurchasePayment();
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
            const discount = getDefaultDiscount();
            if (discount !== null && !Number.isFinite(discount)) {
                status("purchaseMessage", "أدخل خصمًا بين 0 و100 أو اترك الخانة فارغة", true);
                discountDefaultInput.focus();
                return;
            }
            if (!product || !Number.isFinite(quantity) || quantity <= 0) {
                status("purchaseMessage", "اختر الصنف وأدخل كمية صحيحة", true);
                return;
            }
            const isCeramic = String(product.category_name || "").trim() === "سيراميك";
            const pricingMode = isCeramic ? "ceramic_meter" : (discount === null ? "manual" : "discount");
            let unitCost, listPrice, salePrice;
            if (isCeramic) {
                const cartonArea = (Number(product.tile_length_cm || 0) * Number(product.tile_width_cm || 0) / 10000) * Number(product.tiles_per_carton || 0);
                if (!(cartonArea > 0)) {
                    status("purchaseMessage", "أكمل مقاس البلاطة وعدد البلاطات بالكرتونة في بيانات الصنف أولًا", true);
                    return;
                }
                unitCost = Number(wholesaleInput.value);
                salePrice = Number(retailInput.value);
                if (!wholesaleInput.value.trim() || !Number.isFinite(unitCost) || unitCost <= 0) {
                    status("purchaseMessage", "أدخل سعر الجملة للمتر المربع صحيحًا", true);
                    wholesaleInput.focus();
                    return;
                }
                if (!retailInput.value.trim() || !Number.isFinite(salePrice) || salePrice <= 0) {
                    status("purchaseMessage", "أدخل سعر القطاعي للمتر المربع صحيحًا", true);
                    retailInput.focus();
                    return;
                }
                listPrice = salePrice;
            } else if (pricingMode === "discount") {
                listPrice = Number(listPriceInput.value);
                if (!listPriceInput.value.trim() || !Number.isFinite(listPrice) || listPrice <= 0) {
                    status("purchaseMessage", "أدخل سعر القطاعي / الليستة الصحيح", true);
                    listPriceInput.focus();
                    return;
                }
                unitCost = roundMoney(listPrice * (1 - discount / 100));
                salePrice = listPrice;
            } else {
                unitCost = Number(wholesaleInput.value);
                salePrice = Number(retailInput.value);
                if (!wholesaleInput.value.trim() || !Number.isFinite(unitCost) || unitCost <= 0) {
                    status("purchaseMessage", "أدخل سعر الشراء بالجملة الصحيح", true);
                    wholesaleInput.focus();
                    return;
                }
                if (!retailInput.value.trim() || !Number.isFinite(salePrice) || salePrice <= 0) {
                    status("purchaseMessage", "أدخل سعر البيع القطاعي الصحيح", true);
                    retailInput.focus();
                    return;
                }
                listPrice = salePrice;
            }
            items.push({
                product_id: productId,
                name: product.name,
                category_name: product.category_name || "غير مصنف",
                quantity,
                unit: isCeramic ? "متر مربع" : (product.unit || "قطعة"),
                unit_cost: unitCost,
                pricing_mode: pricingMode,
                discount_percent: discount,
                is_plumbing: product.category_name === "سباكة",
                list_price: listPrice,
                plumbing_discount_percent: discount,
                sale_price: salePrice
            });
            page.querySelector("#purchaseQty").value = "";
            purchasePicker.clear();
            productSelect.value = "";
            wholesaleInput.value = "";
            retailInput.value = "";
            listPriceInput.value = "";
            updateSelectedPricing();
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
                const result = await window.elSharq.createPurchase({
                    supplier_name: page.querySelector("#purchaseSupplierName").value.trim(),
                    location_id: page.querySelector("#purchaseLocation").value,
                    discount_amount: 0,
                    paid_amount: Number(page.querySelector("#purchasePaid").value || 0),
                    cash_account_id: Number(page.querySelector("#purchaseCashAccount").value || 0),
                    notes: page.querySelector("#purchaseNotes").value,
                    items
                });
                purchaseSaved = true;
                const purchaseInvoiceSettings = await window.elSharq.getSettings().catch(() => ({}));
                status("purchaseMessage", `تم حفظ الفاتورة ${result.invoiceNumber}`);
                try {
                    window.elSharqInvoicePrint.print(printWindow, {
                        store_owner_name: purchaseInvoiceSettings.store_owner_name,
                        type: "purchase",
                        invoice_number: result.invoiceNumber,
                        created_at: new Date().toISOString(),
                        partyName: result.supplierName || "مورد نقدي",
                        locationName: locations.find((location) => String(location.id) === page.querySelector("#purchaseLocation").value)?.name || "-",
                        items: items.map((item) => ({
                            ...item,
                            product_name: item.name,
                            product_unit: item.unit,
                            total: item.quantity * item.unit_cost
                        })),
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
                    const invoiceSettings = await window.elSharq.getSettings().catch(() => ({}));
                    window.elSharqInvoicePrint.print(printWindow, {
                        ...invoice,
                        store_owner_name: invoiceSettings.store_owner_name,
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
                adjustUnit === "متر" ? "الرصيد الفعلي (متر)" : adjustUnit === "كيلو" ? "الرصيد الفعلي (كيلو)" : "الرصيد الفعلي";
            page.querySelector("#transferQuantityLabel").textContent =
                transferUnit === "متر" ? "الكمية بالمتر" : transferUnit === "كيلو" ? "الكمية بالكيلو" : "الكمية";
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
            ${isCustomer ? `<div class="sales-panel"><div class="sales-panel-header"><div><h3>متابعة المستحقات</h3><span>إجمالي أرصدة العملاء ومواعيد السداد المحددة</span></div><button type="button" class="secondary-button" id="openReceivablesButton">فتح صفحة المستحقات</button></div></div>` : ""}
            <div class="sales-panel">
                <div class="sales-panel-header"><div><h3>${isCustomer ? "تحصيل دفعة من عميل" : "سداد دفعة لمورد"}</h3><span>يتم تحديث متبقي الفاتورة والحساب والخزنة تلقائيًا</span></div></div>
                <form id="accountPaymentForm" class="sale-info-grid">
                    <div class="form-field"><label>الفاتورة المستحقة</label><div style="position:relative;width:100%;"><input id="accountPaymentInvoiceSearch" type="search" autocomplete="off" aria-label="بحث عن فاتورة" placeholder="ابحث باسم ${isCustomer ? 'العميل' : 'المورد'} أو رقم الفاتورة..." style="width:100%;box-sizing:border-box;"><div id="accountPaymentInvoiceResults" role="listbox" aria-live="polite" hidden style="position:absolute;top:100%;left:0;right:0;z-index:1000;max-height:260px;overflow:auto;background:#17232d;border:1px solid #405462;border-radius:8px;box-shadow:0 8px 22px rgba(0,0,0,.3);"></div></div><div style="display:none;"><select id="accountPaymentInvoice" aria-hidden="true" tabindex="-1"><option value="">اختر الفاتورة</option>${outstanding.map((i) => `<option value="${i.id}" data-remaining="${i.remaining}">${escape(i.invoice_number)} — ${escape(i.contact_name)} — باقي ${money(i.remaining)} ج.م</option>`).join("")}</select></div></div>
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
            <div class="products-panel">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
        <div style="position:relative;flex:1;max-width:420px;">
            <input id="contactTableSearchInput" type="search" placeholder="بحث ذكي في ${isCustomer ? 'العملاء' : 'الموردين'} (بالاسم أو الهاتف أو العنوان)..." style="width:100%;padding:9px 14px;border-radius:8px;border:1px solid #405462;background:#17232d;color:#fff;font-size:13px;box-sizing:border-box;">
        </div>
        <span id="contactTableCount" style="font-size:12px;color:#a9bac6;font-weight:bold;">إجمالي: ${records.length}</span>
    </div>
    <div class="products-table-wrapper"><table class="products-table" id="contactsDataTable"><thead><tr><th>الاسم</th><th>الهاتف</th><th>العنوان</th><th>الرصيد الحالي</th><th>ملاحظات</th><th>إجراءات</th></tr></thead><tbody>${records.map((r) => `<tr><td>${escape(r.name)}</td><td>${escape(r.phone || "-")}</td><td>${escape(r.address || "-")}</td><td>${Number(r.balance) < -0.000001 ? (isCustomer ? `<span style="color:#ffb74d;font-weight:bold;background:rgba(255,183,77,0.12);padding:3px 8px;border-radius:6px;display:inline-block;">دائن: له ${money(Math.abs(r.balance))} ج.م</span>` : `<span style="color:#4fc3f7;font-weight:bold;">مستحق له: ${money(Math.abs(r.balance))} ج.م</span>`) : (Number(r.balance) > 0.000001 ? `<strong class="remaining-danger">${money(r.balance)} ج.م</strong>` : `<span style="color:#888;">0.00 ج.م</span>`)}</td><td>${escape(r.notes || "-")}</td><td><button type="button" data-edit-contact="${r.id}">تعديل</button></td></tr>`).join("") || '<tr><td colspan="6">لا توجد سجلات</td></tr>'}</tbody></table></div></div>
        `);
        page.querySelector("#openReceivablesButton")?.addEventListener("click", () => {
            document.querySelector('[data-nav="receivables"]')?.click();
        });
        const paymentInvoice = page.querySelector("#accountPaymentInvoice");
        const paymentInvoiceSearch = page.querySelector("#accountPaymentInvoiceSearch");
        const paymentInvoiceResults = page.querySelector("#accountPaymentInvoiceResults");
        const paymentAmount = page.querySelector("#accountPaymentAmount");
        const renderCustomerInvoiceResults = () => {
            if (!paymentInvoiceSearch || !paymentInvoiceResults) return;
            const query = paymentInvoiceSearch.value.trim().toLocaleLowerCase();
            const matches = query ? outstanding.filter((invoice) =>
                `${invoice.invoice_number || ""} ${invoice.contact_name || ""}`.toLocaleLowerCase().includes(query)
            ).slice(0, 12) : [];
            paymentInvoiceResults.innerHTML = matches.length
                ? matches.map((invoice) => `<button type="button" role="option" data-customer-invoice-result="${invoice.id}" style="display:block;width:100%;padding:10px 12px;text-align:right;color:#e6eef3;background:transparent;border:0;border-bottom:1px solid #30414d;cursor:pointer;">${escape(invoice.invoice_number || "-")} — ${escape(invoice.contact_name || "عميل")} — باقي ${money(invoice.remaining)} ج.م</button>`).join("")
                : query ? `<div style="padding:10px 12px;color:#a9bac6;">\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u062A\u0627\u0626\u062C \u0645\u0637\u0627\u0628\u0642\u0629</div>` : "";
            paymentInvoiceResults.hidden = !query;
        };
        paymentInvoiceSearch?.addEventListener("input", () => {
            paymentInvoice.value = "";
            paymentAmount.value = "";
            paymentAmount.max = "";
            renderCustomerInvoiceResults();
        });
        paymentInvoiceResults?.addEventListener("click", (event) => {
            const result = event.target.closest("[data-customer-invoice-result]");
            if (!result) return;
            const invoice = outstanding.find((item) => String(item.id) === String(result.dataset.customerInvoiceResult));
            if (!invoice) return;
            paymentInvoice.value = String(invoice.id);
            paymentInvoiceSearch.value = `${invoice.invoice_number || "-"} — ${invoice.contact_name || (isCustomer ? "عميل" : "مورد")}`;
            paymentAmount.max = invoice.remaining || "";
            paymentAmount.value = invoice.remaining || "";
            paymentInvoiceResults.hidden = true;
            paymentInvoice.dispatchEvent(new Event("change"));
        });
        paymentInvoiceSearch?.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            const firstResult = paymentInvoiceResults?.querySelector("[data-customer-invoice-result]");
            if (firstResult) {
                event.preventDefault();
                firstResult.click();
            }
        });
        paymentInvoice.addEventListener("change", () => {
            const remaining = paymentInvoice.selectedOptions[0]?.dataset.remaining;
            paymentAmount.max = remaining || "";
            paymentAmount.value = remaining || "";
        });
        page.querySelector("#accountPaymentForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                if (!paymentInvoice.value) throw new Error("\u0627\u0628\u062D\u062B \u0639\u0646 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0648\u0627\u062E\u062A\u0631 \u0646\u062A\u064A\u062C\u0629 \u0645\u0646 \u0627\u0644\u0642\u0627\u0626\u0645\u0629.");
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

            async function receivables(preferredTab = "receivables") {
        let activeTab = preferredTab;
        const [invoices, payables] = await Promise.all([
            window.elSharq.getOutstandingInvoices("customers"),
            window.elSharq.getCustomerPayables ? window.elSharq.getCustomerPayables() : Promise.resolve([])
        ]);
        const today = localDate();
        const openInvoices = invoices.filter((invoice) => Number(invoice.remaining || 0) > 0.000001);
        const dueToday = openInvoices.filter((invoice) => String(invoice.due_date || "").slice(0, 10) === today);
        const overdue = openInvoices.filter((invoice) => {
            const due = String(invoice.due_date || "").slice(0, 10);
            return due && due < today;
        });
        // الصافي على مستوى حساب العميل: الرصيد الدائن بيتخصم مرة واحدة لكل عميل من إجمالي المستحقات
        const creditOffsetByCustomer = new Map();
        openInvoices.forEach((invoice) => {
            const offset = Number(invoice.account_credit_offset || 0);
            if (invoice.contact_id && offset > 0.000001) creditOffsetByCustomer.set(String(invoice.contact_id), offset);
        });
        const totalCreditOffset = [...creditOffsetByCustomer.values()].reduce((sum, value) => sum + value, 0);
        const totalRemaining = Math.max(0, openInvoices.reduce((sum, invoice) => sum + Number(invoice.remaining || 0), 0) - totalCreditOffset);
        const todayRemaining = dueToday.reduce((sum, invoice) => sum + Number(invoice.remaining || 0), 0);
        const overdueRemaining = overdue.reduce((sum, invoice) => sum + Number(invoice.remaining || 0), 0);

        const payablesList = Array.isArray(payables) ? payables : [];
        const totalPayablesAmount = payablesList.reduce((sum, item) => sum + Number(item.amount || 0), 0);

        const dateLabel = (value) => {
            const raw = String(value || "").slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "من غير ميعاد";
            const [year, month, day] = raw.split("-").map(Number);
            return new Date(year, month - 1, day).toLocaleDateString("ar-EG");
        };
        const stateFor = (invoice) => {
            if (invoice.is_opening || String(invoice.id).startsWith("opening-")) {
                return { label: "رصيد قديم", css: "status active" };
            }
            const due = String(invoice.due_date || "").slice(0, 10);
            if (!due) return { label: "من غير ميعاد", css: "status inactive" };
            if (due < today) return { label: "متأخر", css: "status inactive" };
            if (due === today) return { label: "مستحق اليوم", css: "status active" };
            return { label: "موعد قادم", css: "status active" };
        };
        const sortedInvoices = [...openInvoices].sort((a, b) => {
            const da = String(a.due_date || "9999-12-31").slice(0, 10);
            const db = String(b.due_date || "9999-12-31").slice(0, 10);
            return da.localeCompare(db) || String(b.id).localeCompare(String(a.id));
        });

        const page = content("المستحقات", "متابعة المبالغ المطلوبة من العملاء، والمبالغ المستحقة للعملاء على المحل.", `
            <div class="page-header">
                <div></div>
                <button type="button" class="secondary-button" id="backToCustomersButton">العودة للعملاء</button>
            </div>

            <div class="dues-tabs" style="display:flex;gap:12px;margin:18px 0 24px 0">
                <button type="button" class="${activeTab === "receivables" ? "primary-button" : "secondary-button"}" data-dues-tab="receivables" style="padding:10px 22px;font-size:14px;font-weight:700">
                    <span>مستحقات لنا على العملاء</span>
                    <span class="badge" style="margin-right:8px;background:rgba(255,255,255,0.18);padding:2px 8px;border-radius:10px;font-size:12px">${openInvoices.length}</span>
                </button>
                <button type="button" class="${activeTab === "payables" ? "primary-button" : "secondary-button"}" data-dues-tab="payables" style="padding:10px 22px;font-size:14px;font-weight:700">
                    <span>مستحقات للعملاء على المحل</span>
                    <span class="badge" style="margin-right:8px;background:rgba(255,255,255,0.18);padding:2px 8px;border-radius:10px;font-size:12px">${payablesList.length}</span>
                </button>
            </div>

            <!-- TAB 1: RECEIVABLES PANEL -->
            <section data-dues-panel="receivables" ${activeTab !== "receivables" ? "hidden" : ""}>
                <div class="stats-grid">
                    <div class="stat-card"><div class="stat-icon cash">ج</div><div><span>إجمالي مستحقات العملاء (الصافي)</span><strong>${money(totalRemaining)} ج.م</strong></div></div>
                    <div class="stat-card"><div class="stat-icon invoices">◷</div><div><span>المستحق اليوم (${dueToday.length} فاتورة)</span><strong>${money(todayRemaining)} ج.م</strong></div></div>
                    <div class="stat-card"><div class="stat-icon profit">!</div><div><span>المتأخر (${overdue.length} فاتورة)</span><strong>${money(overdueRemaining)} ج.م</strong></div></div>
                </div>
                <div class="last-invoices-panel">
                    <div class="last-invoices-panel-header"><div><h3>الفواتير ذات الأرصدة المفتوحة (مطلوبة من العملاء)</h3><span>${openInvoices.length} فاتورة، تشمل الفواتير من غير موعد</span></div></div>
                    <div class="last-invoices-table-wrapper"><table class="last-invoices-table">
                        <thead><tr><th>العميل</th><th>رقم الفاتورة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>ميعاد السداد</th><th>الحالة</th><th>إجراء</th></tr></thead>
                        <tbody>${sortedInvoices.map((invoice) => {
                            const state = stateFor(invoice);
                            return `<tr>
                                <td><strong>${escape(invoice.contact_name || "عميل")}</strong></td>
                                <td>${escape(invoice.invoice_number || "-")}</td>
                                <td>${money(invoice.total)} ج.م</td>
                                <td>${money(invoice.paid)} ج.م</td>
                                <td><strong class="remaining-danger">${money(invoice.remaining)} ج.م</strong>${Number(invoice.account_credit_offset || 0) > 0.000001 ? `<div style="font-size:11px;color:#22c55e;margin-top:4px">للعميل رصيد دائن ${money(invoice.account_credit_offset)} ج.م — صافي حسابه ${money(invoice.account_net || 0)} ج.م</div>` : ""}</td>
                                <td>${dateLabel(invoice.due_date)}</td>
                                <td><span class="${state.css}">${state.label}</span></td>
                                <td data-receivable-actions="${escape(invoice.id)}"><button type="button" class="edit-btn" data-receivable-pay="${escape(invoice.id)}">تحصيل دفعة</button></td>
                            </tr>`;
                        }).join("") || `<tr><td colspan="8"><div class="table-empty"><strong>لا توجد مستحقات مفتوحة</strong><span>الفواتير التي لم تُسدّد بالكامل ستظهر هنا</span></div></td></tr>`}</tbody>
                    </table></div>
                </div>
            </section>

            <!-- TAB 2: PAYABLES PANEL -->
            <section data-dues-panel="payables" ${activeTab !== "payables" ? "hidden" : ""}>
                <div class="stats-grid">
                    <div class="stat-card"><div class="stat-icon cash" style="color:#22c55e">✓</div><div><span>إجمالي المبالغ المستحقة للعملاء</span><strong style="color:#22c55e">${money(totalPayablesAmount)} ج.م</strong></div></div>
                    <div class="stat-card"><div class="stat-icon invoices">👥</div><div><span>عدد الحسابات المستحقة للرد</span><strong>${payablesList.length} مستحق</strong></div></div>
                </div>
                <div class="last-invoices-panel">
                    <div class="last-invoices-panel-header"><div><h3>المبالغ المستحقة للعملاء طرف المحل (دائنون)</h3><span>أرصدة دائنة ناتجة عن مرتجعات فواتير أو دفعات زائدة</span></div></div>
                    <div class="last-invoices-table-wrapper"><table class="last-invoices-table">
                        <thead><tr><th>العميل</th><th>الهاتف</th><th>الفاتورة / المرجع</th><th>المبلغ المستحق للعميل</th><th>البيان / السبب</th><th>التاريخ</th><th>إجراء</th></tr></thead>
                        <tbody>${payablesList.map((item) => {
                            return `<tr>
                                <td><strong>${escape(item.customer_name || "عميل")}</strong></td>
                                <td>${escape(item.phone || "-")}</td>
                                <td>${escape(item.invoice_number || "-")}</td>
                                <td><strong style="color:#22c55e;font-size:15px">${money(item.amount)} ج.م</strong></td>
                                <td><span class="status active">${escape(item.reason || "رصيد دائن مستحق للعميل")}</span></td>
                                <td>${dateLabel(item.date)}</td>
                                <td data-payable-actions="${escape(item.id)}"><button type="button" class="primary-button" style="background:#059669;border-color:#059669;padding:6px 14px;font-size:12px;font-weight:700" data-payable-refund="${escape(item.id)}">رد نقدية للعميل</button></td>
                            </tr>`;
                        }).join("") || `<tr><td colspan="7"><div class="table-empty"><strong>لا توجد مبالغ مستحقة للعملاء</strong><span>عند تسجيل مرتجع لفاتورة مدفوعة أو وجود رصيد دائن لعميل ستظهر هنا تلقائيًا</span></div></td></tr>`}</tbody>
                    </table></div>
                </div>
            </section>
        `);

        // Back button
        page.querySelector("#backToCustomersButton")?.addEventListener("click", () => {
            document.querySelector('[data-nav="customers"]')?.click();
        });

        // Tabs switcher
        page.querySelectorAll("[data-dues-tab]").forEach((button) => {
            button.addEventListener("click", () => {
                const targetTab = button.dataset.duesTab;
                activeTab = targetTab;
                page.querySelectorAll("[data-dues-tab]").forEach((tabBtn) => {
                    tabBtn.className = tabBtn === button ? "primary-button" : "secondary-button";
                });
                page.querySelectorAll("[data-dues-panel]").forEach((panel) => {
                    panel.hidden = panel.dataset.duesPanel !== targetTab;
                });
            });
        });

        // معالج نقر واحد مفوّض. المهم هنا إنه "خاصية" (onclick) مش addEventListener:
        // عنصر .dashboard بيتعاد استخدامه مع كل رسم للصفحة، فالـ addEventListener كان بيكدّس
        // معالجات قديمة (بقوائم بيانات قديمة) وكل ضغطة كانت بتنفّذ أكتر من مرة.
        let refundInFlight = false;
        const collectButtonHtml = (id) => `<button type="button" class="edit-btn" data-receivable-pay="${escape(id)}">تحصيل دفعة</button>`;
        const refundButtonHtml = (id) => `<button type="button" class="primary-button" style="background:#059669;border-color:#059669;padding:6px 14px;font-size:12px;font-weight:700" data-payable-refund="${escape(id)}">رد نقدية للعميل</button>`;

        page.onclick = async (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            // --- تحصيل من العميل: فتح خانة المبلغ ---
            const collect = target.closest("[data-receivable-pay]");
            if (collect) {
                const payId = collect.dataset.receivablePay;
                const invoice = sortedInvoices.find((item) => String(item.id) === String(payId));
                const cell = collect.closest("[data-receivable-actions]");
                if (!invoice || !cell) return;
                cell.innerHTML = `<form class="receivable-inline-payment" data-receivable-payment-form="${escape(invoice.id)}" style="display:flex;gap:6px;align-items:center;min-width:220px"><input type="number" min="0.01" max="${Number(invoice.remaining)}" step="0.01" value="${Number(invoice.remaining)}" required aria-label="مبلغ التحصيل"><button type="submit" class="primary-button">حفظ</button><button type="button" class="secondary-button" data-cancel-receivable>إلغاء</button></form>`;
                cell.querySelector("input")?.focus();
                cell.querySelector("input")?.select();
                return;
            }

            // --- تحصيل: إلغاء ---
            if (target.closest("[data-cancel-receivable]")) {
                const cell = target.closest("[data-receivable-actions]");
                if (cell) cell.innerHTML = collectButtonHtml(cell.dataset.receivableActions);
                return;
            }

            // --- رد نقدية للعميل: فتح خانة المبلغ ---
            const openRefund = target.closest("[data-payable-refund]");
            if (openRefund) {
                const payId = openRefund.dataset.payableRefund;
                const item = payablesList.find((p) => String(p.id) === String(payId));
                const cell = openRefund.closest("[data-payable-actions]");
                if (!item || !cell) return;
                cell.innerHTML = `<div class="payable-inline-refund" data-payable-refund-box="${escape(item.id)}" style="display:flex;gap:6px;align-items:center;min-width:220px"><input type="number" min="0.01" max="${Number(item.amount)}" step="0.01" value="${Number(item.amount)}" style="width:100px;padding:6px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#fff" required aria-label="مبلغ الرد"><button type="button" class="primary-button btn-confirm-refund" data-confirm-refund="${escape(item.id)}" style="background:#059669;border-color:#059669;padding:6px 14px;cursor:pointer">صرف</button><button type="button" class="secondary-button" data-cancel-payable style="padding:6px 10px;cursor:pointer">إلغاء</button></div>`;
                cell.querySelector("input")?.focus();
                cell.querySelector("input")?.select();
                return;
            }

            // --- رد نقدية: إلغاء (كان بيدوّر على data-payable-refund-form وده مش موجود، فالإلغاء ما كانش بيشتغل) ---
            if (target.closest("[data-cancel-payable]")) {
                const cell = target.closest("[data-payable-actions]");
                if (cell) cell.innerHTML = refundButtonHtml(cell.dataset.payableActions);
                return;
            }

            // --- رد نقدية: تأكيد الصرف ---
            const confirmBtn = target.closest("[data-confirm-refund]");
            if (confirmBtn) {
                event.preventDefault();
                if (refundInFlight) return;

                const payId = confirmBtn.dataset.confirmRefund;
                const item = payablesList.find((p) => String(p.id) === String(payId));
                const box = confirmBtn.closest("[data-payable-refund-box]");
                const amount = Math.round(Number(box?.querySelector("input")?.value) * 100) / 100;

                if (!item || !Number.isFinite(amount) || amount <= 0 || amount > Number(item.amount) + 0.000001) {
                    window.alert("يرجى إدخال مبلغ صحيح لا يتجاوز المستحق للعميل (" + (item ? item.amount : 0) + " ج.م)");
                    return;
                }
                if (!window.confirm(`هل أنت متأكد من صرف مبلغ ${amount} ج.م للعميل ${item.customer_name || ""}؟`)) return;

                refundInFlight = true;
                confirmBtn.disabled = true;
                confirmBtn.textContent = "جاري الصرف...";
                try {
                    await window.elSharq.refundCustomer(
                        item.customer_id,
                        amount,
                        item.reason || `رد نقدية للعميل ${item.customer_name || ""}`,
                        item.invoice_number
                    );
                    refundInFlight = false;
                    window.alert("تم تسجيل صرف المبلغ بنجاح وتحديث الخزنة!");
                    // إعادة جلب كل البيانات من القاعدة (المستحقات + المرتجعات) بدل الاعتماد على نسخة قديمة
                    await receivables("payables");
                } catch (err) {
                    refundInFlight = false;
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = "صرف";
                    window.alert("حدث خطأ أثناء الصرف: " + (err?.message || err));
                }
            }
        };

        // تحصيل دفعة من العميل (submit). نفس الفكرة: خاصية واحدة بتتبدّل مع كل رسم.
        page.onsubmit = async (event) => {
            const recForm = event.target.closest("[data-receivable-payment-form]");
            if (!recForm) return;
            event.preventDefault();
            if (recForm.dataset.busy === "1") return;
            recForm.dataset.busy = "1";

            const invoiceId = recForm.dataset.receivablePaymentForm;
            const invoice = sortedInvoices.find((item) => String(item.id) === String(invoiceId));
            const amount = Number(recForm.querySelector("input")?.value);
            if (!invoice || !Number.isFinite(amount) || amount <= 0 || amount > Number(invoice.remaining) + 0.000001) {
                recForm.dataset.busy = "0";
                window.alert("أدخل مبلغ تحصيل صحيح لا يتجاوز المتبقي على الفاتورة.");
                return;
            }
            const submit = recForm.querySelector('[type="submit"]');
            if (submit) submit.disabled = true;
            try {
                await window.elSharq.recordAccountPayment("customers", invoiceId, amount);
                await receivables("receivables");
            } catch (error) {
                if (submit) submit.disabled = false;
                recForm.dataset.busy = "0";
                window.alert(error?.message || "تعذر تسجيل التحصيل.");
            }
        };
    }


async function quickTransactions() {
        const [products, history] = await Promise.all([window.elSharq.getProducts(), window.elSharq.getQuickTransactions()]);
        const activeProducts = products.filter((product) => Number(product.active) === 1);
        const page = content("المعاملات السريعة", "بيع سريع أو مرتجع نقدي مستقل بدون إثبات بيع. الحركة تخص المعرض والخزنة تلقائيًا.", `
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-icon sales">ب</div><div><span>بيع سريع</span><strong>مدفوع بالكامل</strong><small>الخصم من رصيد المعرض</small></div></div>
                <div class="stat-card"><div class="stat-icon cash">ر</div><div><span>مرتجع سريع</span><strong>رد نقدي</strong><small>الإضافة إلى المعرض وخصم الخزنة</small></div></div>
            </div>
            <div class="quick-transaction-tabs" style="display:flex;gap:10px;margin:18px 0">
                <button type="button" class="primary-button" data-quick-tab="sale">بيع سريع</button>
                <button type="button" class="secondary-button" data-quick-tab="return">مرتجع سريع</button>
            </div>
            <section class="sales-panel" data-quick-panel="sale">
                <div class="sales-panel-header"><div><h3>تسجيل بيع سريع</h3><span>السعر يُؤخذ تلقائيًا من سعر البيع المسجل، والبيع يخرج من المعرض فقط.</span></div></div>
                <div class="sale-add-product">
                    ${productPicker("quickSaleSearch", "quickSaleDropdown", "quickSaleProduct", activeProducts)}
                    <div class="form-field"><label for="quickSaleQty">الكمية (${escape("وحدة المنتج")})</label><input id="quickSaleQty" type="number" min="0.01" step="0.01" placeholder="الكمية"></div>
                    <div class="form-field"><label for="quickSalePrice">سعر الوحدة المسجل</label><input id="quickSalePrice" type="text" readonly value=""></div>
                    <button class="secondary-button" id="quickSaleAdd" type="button">إضافة للصنف</button>
                </div>
                <div class="last-invoices-table-wrapper"><table class="last-invoices-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>الوحدة</th><th>سعر الوحدة</th><th>الإجمالي</th><th></th></tr></thead><tbody id="quickSaleItems"><tr><td colspan="6">لم تتم إضافة أصناف</td></tr></tbody></table></div>
                <div class="sale-info-grid" style="margin-top:16px"><div class="form-field"><label for="quickSaleNotes">ملاحظات (اختياري)</label><input id="quickSaleNotes" type="text" placeholder="ملاحظات داخلية"></div><div class="form-field"><label>الإجمالي المدفوع نقدًا</label><strong id="quickSaleTotal">0.00 ج.م</strong></div></div>
                <div id="quickSaleMessage" class="product-form-message"></div>
                <button class="primary-button" id="quickSaleSave" type="button">حفظ البيع واستلام النقدية</button>
            </section>
                        <section class="sales-panel" data-quick-panel="return" hidden>
                <div class="sales-panel-header">
                    <div>
                        <h3>تسجيل مرتجع سريع</h3>
                        <span>بدون إثبات بيع. السعر من سعر البيع المسجل، والكمية تُضاف إلى المعرض، والمبلغ يُرد نقدًا.</span>
                    </div>
                </div>

                <div class="sale-add-product">
                    ${productPicker("quickReturnSearch", "quickReturnDropdown", "quickReturnProduct", activeProducts)}
                    <div class="form-field">
                        <label for="quickReturnQty">الكمية (وحدة المنتج)</label>
                        <input id="quickReturnQty" type="number" min="0.01" step="0.01" placeholder="الكمية">
                    </div>
                    <div class="form-field">
                        <label for="quickReturnPrice">سعر الوحدة المسجل</label>
                        <input id="quickReturnPrice" type="text" readonly value="">
                    </div>
                    <button class="secondary-button" id="quickReturnAdd" type="button">إضافة للصنف</button>
                </div>

                <div class="last-invoices-table-wrapper">
                    <table class="last-invoices-table">
                        <thead><tr><th>الصنف</th><th>الكمية</th><th>الوحدة</th><th>سعر الوحدة</th><th>الإجمالي</th><th></th></tr></thead>
                        <tbody id="quickReturnItems"><tr><td colspan="6">لم تتم إضافة أصناف</td></tr></tbody>
                    </table>
                </div>

                <div class="sale-info-grid" style="margin-top:16px">
                    <div class="form-field">
                        <label for="quickReturnNotes">ملاحظات (اختياري)</label>
                        <input id="quickReturnNotes" type="text" placeholder="سبب أو تفاصيل المرتجع">
                    </div>
                    <div class="form-field">
                        <label>إجمالي المبلغ المسترد نقدًا</label>
                        <strong id="quickReturnTotal">0.00 ج.م</strong>
                    </div>
                </div>

                <div id="quickReturnMessage" class="product-form-message"></div>
                <button class="primary-button" id="quickReturnSave" type="button" disabled>حفظ المرتجع ورد النقدية</button>
            </section>
            <div class="last-invoices-panel"><h3>سجل المعاملات السريعة</h3><div class="last-invoices-table-wrapper"><table class="last-invoices-table"><thead><tr><th>الرقم الداخلي</th><th>النوع</th><th>مرتبط ببيع</th><th>التاريخ</th><th>عدد الأصناف</th><th>القيمة</th><th>إجراء</th></tr></thead><tbody>${history.map((entry) => `<tr><td><strong>${escape(entry.transaction_number)}</strong></td><td>${entry.transaction_type === "sale" ? "بيع نقدي" : "مرتجع نقدي"}</td><td>${escape(entry.source_sale_number || "-")}</td><td>${dateText(entry.created_at)}</td><td>${Number(entry.item_count || 0)}</td><td>${entry.transaction_type === "return" ? "-" : "+"}${money(entry.total_amount)} ج.م</td><td><button type="button" class="delete-btn" data-delete-quick-transaction="${Number(entry.id)}">حذف</button></td></tr>`).join("") || '<tr><td colspan="7">لا توجد معاملات سريعة بعد</td></tr>'}</tbody></table></div></div>
        `);
        const quickHistoryBody = page.querySelector(".last-invoices-panel .last-invoices-table tbody");

        quickHistoryBody.addEventListener("click", async (event) => {
            const button = event.target.closest("[data-delete-quick-transaction]");
            if (!button) return;

            const id = Number(button.dataset.deleteQuickTransaction);
            const entry = history.find((item) => Number(item.id) === id);
            if (!entry) return;

            const isSale = entry.transaction_type === "sale";
            const explanation = isSale
                ? "سيُعاد الصنف إلى مخزون المعرض، وسيُخصم مبلغ البيع من الخزنة."
                : "ستُسحب كمية المرتجع من مخزون المعرض، وسيُضاف مبلغ المرتجع إلى الخزنة.";

            const confirmed = window.confirm(
                `تأكيد حذف ${isSale ? "البيع" : "المرتجع"} ${entry.transaction_number}؟\n\n` +
                `${explanation}\n\nلن يمكن التراجع عن الحذف.`
            );

            if (!confirmed) return;

            button.disabled = true;

            try {
                const result = await window.elSharq.deleteQuickTransaction(id);

                window.alert(
                    `تم حذف ${result.transactionNumber} وعكس تأثيرها على المخزون والخزنة.`
                );

                await quickTransactions();
            } catch (error) {
                window.alert(error?.message || "تعذر حذف المعاملة.");
                button.disabled = false;
            }
        });
        const saleItems = [];
        const productSelect = page.querySelector("#quickSaleProduct");
        setupProductPicker(page, { inputId: "quickSaleSearch", dropdownId: "quickSaleDropdown", selectId: "quickSaleProduct", products: activeProducts });
        const selectedProduct = () => activeProducts.find((product) => Number(product.id) === Number(productSelect.value));
        const drawQuickSale = () => {
            const body = page.querySelector("#quickSaleItems");
            body.innerHTML = saleItems.length ? saleItems.map((item, index) => `<tr><td>${escape(item.name)}</td><td>${item.quantity}</td><td>${escape(item.unit)}</td><td>${money(item.unit_price)} ج.م</td><td>${money(item.quantity * item.unit_price)} ج.م</td><td><button type="button" class="delete-btn" data-remove-quick-sale="${index}">حذف</button></td></tr>`).join("") : '<tr><td colspan="6">لم تتم إضافة أصناف</td></tr>';
            page.querySelector("#quickSaleTotal").textContent = `${money(saleItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0))} ج.م`;
        };
        productSelect.addEventListener("change", () => {
            const product = selectedProduct();
            page.querySelector("#quickSalePrice").value = product ? `${money(product.sale_price)} ج.م / ${product.unit || "قطعة"}` : "";
            page.querySelector("#quickSaleQty").value = "";
            page.querySelector("#quickSaleQty").focus();
        });
        page.querySelector("#quickSaleAdd").addEventListener("click", () => {
            const product = selectedProduct();
            const quantity = Number(page.querySelector("#quickSaleQty").value);
            if (!product) return status("quickSaleMessage", "اختر صنفًا أولًا", true);
            if (!Number.isFinite(quantity) || quantity <= 0) return status("quickSaleMessage", "أدخل كمية صحيحة", true);
            const existing = saleItems.find((item) => Number(item.product_id) === Number(product.id));
            if (existing) existing.quantity += quantity;
            else saleItems.push({ product_id: Number(product.id), name: product.name, unit: product.unit || "قطعة", quantity, unit_price: Number(product.sale_price || 0) });
            status("quickSaleMessage", "");
            productSelect.value = "";
            page.querySelector("#quickSaleSearch").value = "";
            page.querySelector("#quickSaleQty").value = "";
            page.querySelector("#quickSalePrice").value = "";
            drawQuickSale();
        });
        page.querySelector("#quickSaleItems").addEventListener("click", (event) => {
            const button = event.target.closest("[data-remove-quick-sale]");
            if (!button) return;
            saleItems.splice(Number(button.dataset.removeQuickSale), 1);
            drawQuickSale();
        });
        page.querySelector("#quickSaleSave").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            if (!saleItems.length) return status("quickSaleMessage", "أضف صنفًا واحدًا على الأقل", true);
            if (!window.confirm(`تأكيد البيع النقدي بقيمة ${money(saleItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0))} ج.م؟`)) return;
            button.disabled = true;
            try {
                const result = await window.elSharq.createQuickSale({ items: saleItems, notes: page.querySelector("#quickSaleNotes").value });
                window.alert(`تم حفظ البيع السريع ${result.transactionNumber} واستلام ${money(result.totalAmount)} ج.م.`);
                await quickTransactions();
            } catch (error) { fail("quickSaleMessage", error); button.disabled = false; }
        });
        const returnItems = [];
        const returnProductSelect = page.querySelector("#quickReturnProduct");

        setupProductPicker(page, {
            inputId: "quickReturnSearch",
            dropdownId: "quickReturnDropdown",
            selectId: "quickReturnProduct",
            products: activeProducts
        });

        const selectedReturnProduct = () =>
            activeProducts.find(
                (product) => Number(product.id) === Number(returnProductSelect.value)
            );

        const drawQuickReturn = () => {
            const body = page.querySelector("#quickReturnItems");

            body.innerHTML = returnItems.length
                ? returnItems.map((item, index) => `
                    <tr>
                        <td>${escape(item.name)}</td>
                        <td>${item.quantity}</td>
                        <td>${escape(item.unit)}</td>
                        <td>${money(item.unit_price)} ج.م</td>
                        <td>${money(item.quantity * item.unit_price)} ج.م</td>
                        <td><button type="button" class="delete-btn" data-remove-quick-return="${index}">حذف</button></td>
                    </tr>
                `).join("")
                : '<tr><td colspan="6">لم تتم إضافة أصناف</td></tr>';

            const total = returnItems.reduce(
                (sum, item) => sum + item.quantity * item.unit_price,
                0
            );

            page.querySelector("#quickReturnTotal").textContent = `${money(total)} ج.م`;
            page.querySelector("#quickReturnSave").disabled = returnItems.length === 0;
        };

        returnProductSelect.addEventListener("change", () => {
            const product = selectedReturnProduct();

            page.querySelector("#quickReturnPrice").value = product
                ? `${money(product.sale_price)} ج.م / ${product.unit || "قطعة"}`
                : "";

            page.querySelector("#quickReturnQty").value = "";
            page.querySelector("#quickReturnQty").focus();
        });

        page.querySelector("#quickReturnAdd").addEventListener("click", () => {
            const product = selectedReturnProduct();
            const quantity = Number(page.querySelector("#quickReturnQty").value);
            const price = Number(product?.sale_price || 0);

            if (!product) return status("quickReturnMessage", "اختر صنفًا أولًا", true);
            if (!Number.isFinite(quantity) || quantity <= 0) return status("quickReturnMessage", "أدخل كمية مرتجعة صحيحة", true);
            if (!Number.isFinite(price) || price <= 0) return status("quickReturnMessage", "سعر البيع المسجل للصنف غير صالح", true);

            const existing = returnItems.find(
                (item) => Number(item.product_id) === Number(product.id)
            );

            if (existing) {
                existing.quantity += quantity;
            } else {
                returnItems.push({
                    product_id: Number(product.id),
                    name: product.name,
                    unit: product.unit || "قطعة",
                    quantity,
                    unit_price: price
                });
            }

            status("quickReturnMessage", "");
            returnProductSelect.value = "";
            page.querySelector("#quickReturnSearch").value = "";
            page.querySelector("#quickReturnQty").value = "";
            page.querySelector("#quickReturnPrice").value = "";
            drawQuickReturn();
        });

        page.querySelector("#quickReturnItems").addEventListener("click", (event) => {
            const button = event.target.closest("[data-remove-quick-return]");
            if (!button) return;

            returnItems.splice(Number(button.dataset.removeQuickReturn), 1);
            drawQuickReturn();
        });

        page.querySelector("#quickReturnSave").addEventListener("click", async (event) => {
            const button = event.currentTarget;

            if (!returnItems.length) return status("quickReturnMessage", "أضف صنفًا واحدًا على الأقل", true);

            const total = returnItems.reduce(
                (sum, item) => sum + item.quantity * item.unit_price,
                0
            );

            if (!window.confirm(
                `سيتم رد ${money(total)} ج.م نقدًا للعميل وإضافة الأصناف إلى المعرض، دون ربطها بفاتورة بيع. متابعة؟`
            )) return;

            button.disabled = true;

            try {
                const result = await window.elSharq.createQuickStandaloneReturn({
                    items: returnItems.map((item) => ({
                        product_id: item.product_id,
                        quantity: item.quantity
                    })),
                    notes: page.querySelector("#quickReturnNotes").value
                });

                window.alert(
                    `تم حفظ المرتجع ${result.transactionNumber} ورد ${money(result.totalAmount)} ج.م نقدًا.`
                );

                await quickTransactions();
            } catch (error) {
                fail("quickReturnMessage", error);
                button.disabled = returnItems.length === 0;
            }
        });
        page.querySelectorAll("[data-quick-tab]").forEach((button) => button.addEventListener("click", () => {
            const mode = button.dataset.quickTab;
            page.querySelectorAll("[data-quick-tab]").forEach((tab) => {
                tab.className = tab === button ? "primary-button" : "secondary-button";
            });
            page.querySelectorAll("[data-quick-panel]").forEach((panel) => { panel.hidden = panel.dataset.quickPanel !== mode; });
        }));
    }

    async function cashier() {
        const today = localDate();
        const days = Array.from({ length: 7 }, (_, index) => {
            const date = new Date();
            date.setHours(12, 0, 0, 0);
            date.setDate(date.getDate() - (6 - index));
            return localDateForChart(date);
        });
        const [accounts, entries, categories, todaySummary, week] = await Promise.all([
            window.elSharq.getCashSummary(),
            window.elSharq.getCashTransactions(),
            window.elSharq.getExpenseCategories(),
            window.elSharq.getReportSummary({ from: today, to: today }),
            Promise.all(days.map((day) => window.elSharq.getReportSummary({ from: day, to: day })))
        ]);
        const totalProfit = Number(todaySummary.sales.profit || 0);
        const totalExpenses = Number(todaySummary.expenses || 0);
        const maxSales = Math.max(1, ...week.map((item) => Number(item.sales.total || 0)));
        const chart = week.map((item, index) => {
            const value = Number(item.sales.total || 0);
            const height = Math.max(5, Math.round(value / maxSales * 100));
            return `<div title="${escape(days[index])}: ${money(value)} ج.م" style="flex:1;min-width:24px;text-align:center"><div style="height:120px;display:flex;align-items:flex-end;justify-content:center"><span style="display:block;width:70%;height:${height}%;min-height:5px;background:#4b9bea;border-radius:6px 6px 0 0"></span></div><small>${escape(days[index].slice(5))}</small></div>`;
        }).join("");
        const page = content("الخزنة", "الأرصدة والملخص المالي اليومي وحركة آخر سبعة أيام.", `
            <div class="stats-grid">${accounts.map((a) => `<div class="stat-card"><div class="stat-icon cash">خ</div><div><span>رصيد ${escape(a.name)}</span><strong>${money(a.balance)} ج.م</strong></div></div>`).join("")}
                <div class="stat-card"><div class="stat-icon sales">م</div><div><span>مبيعات اليوم</span><strong>${money(todaySummary.sales.total)} ج.م</strong><small>${Number(todaySummary.sales.count || 0)} فاتورة</small></div></div>
                <div class="stat-card"><div class="stat-icon invoices">ف</div><div><span>عدد فواتير اليوم</span><strong>${Number(todaySummary.sales.count || 0)}</strong></div></div>
                <div class="stat-card"><div class="stat-icon profit">ر</div><div><span>مجمل الربح اليوم</span><strong>${money(totalProfit)} ج.م</strong></div></div>
                <div class="stat-card"><div class="stat-icon cash">ص</div><div><span>مصروفات اليوم</span><strong>${money(totalExpenses)} ج.م</strong></div></div>
                <div class="stat-card"><div class="stat-icon profit">ن</div><div><span>صافي الربح اليوم</span><strong>${money(totalProfit - totalExpenses)} ج.م</strong></div></div>
            </div>
            <div class="sales-panel" style="margin-top:16px"><div class="sales-panel-header"><div><h3>المبيعات خلال آخر 7 أيام</h3><span>إجمالي المبيعات اليومية</span></div></div><div style="display:flex;gap:12px;align-items:flex-end;padding:16px 8px 8px">${chart}</div></div>
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
            <div class="last-invoices-panel"><h3>آخر الحركات النقدية</h3><div class="last-invoices-table-wrapper"><table class="last-invoices-table"><thead><tr><th>التاريخ</th><th>الخزنة</th><th>البيان</th><th>النوع</th><th>القيمة</th><th>إجراء</th></tr></thead><tbody>${entries.map((e) => `<tr><td>${dateText(e.created_at)}</td><td>${escape(e.account_name)}</td><td>${escape(e.description || "-")}</td><td>${e.direction === "in" ? "مقبوض" : "مدفوع"}</td><td>${e.direction === "in" ? "+" : "-"}${money(e.amount)} ج.م</td><td>${Number(e.can_delete) === 1 ? `<button type="button" class="secondary-button" data-delete-cash-transaction="${Number(e.id)}">حذف</button>` : `<span title="الحركة مرتبطة بعملية أخرى ولا تُحذف من هنا">—</span>`}</td></tr>`).join("") || '<tr><td colspan="6">لا توجد حركات</td></tr>'}</tbody></table></div></div>
        `);
        page.querySelectorAll("[data-delete-cash-transaction]").forEach((button) => {
            button.addEventListener("click", async () => {
                const id = Number(button.dataset.deleteCashTransaction);
                const entry = entries.find((item) => Number(item.id) === id);

                if (!entry || Number(entry.can_delete) !== 1) return;

                const label = entry.direction === "in" ? "المقبوض" : "المصروف";
                const confirmed = window.confirm(
                    `هل تريد حذف حركة ${label} "${entry.description || "بدون بيان"}" بقيمة ${money(entry.amount)} ج.م؟\n\nسيتم تعديل رصيد الخزنة والتقارير.`
                );

                if (!confirmed) return;

                button.disabled = true;

                try {
                    await window.elSharq.deleteCashTransaction(id);
                    await cashier();
                } catch (error) {
                    fail("cashMessage", error);
                    if (button.isConnected) button.disabled = false;
                }
            });
        });

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

    async function expenses() {
        const [accounts, entries, categories] = await Promise.all([
            window.elSharq.getCashAccounts(),
            window.elSharq.getExpenses(),
            window.elSharq.getExpenseCategories()
        ]);

        const totalExpenses = entries.reduce(
            (sum, entry) => sum + Number(entry.amount || 0),
            0
        );

        const page = content(
            "المصروفات",
            "دفتر المصروفات اليومية ومتابعة المبالغ المصروفة.",
            `
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon cash">م</div>
                        <div>
                            <span>إجمالي المصروفات المسجلة</span>
                            <strong>${money(totalExpenses)} ج.م</strong>
                            <small>${entries.length} بند مصروف</small>
                        </div>
                    </div>

                </div>

                <div class="sales-panel">
                    <div class="sales-panel-header">
                        <div>
                            <h3>تسجيل مصروف جديد</h3>
                            <span>اكتب بيان المصروف والمبلغ المطلوب خصمه من الخزنة.</span>
                        </div>
                    </div>

                    <form id="expenseForm" class="sale-info-grid">
                        <div class="form-field">
                            <label for="expenseDescription">بيان المصروف</label>
                            <input
                                id="expenseDescription"
                                type="text"
                                maxlength="500"
                                placeholder="مثال: شراء شاي وسكر للعمال"
                                required
                            >
                        </div>

                        <div class="form-field">
                            <label for="expenseAmount">المبلغ بالجنيه</label>
                            <input
                                id="expenseAmount"
                                type="number"
                                min="0.01"
                                step="0.01"
                                placeholder="0.00"
                                required
                            >
                        </div>

                        <div class="form-field">
                            <label for="expenseAccount">الخزنة</label>
                            <select id="expenseAccount" required>
                                ${accounts.map((account) => `
                                    <option value="${account.id}">
                                        ${escape(account.name)}
                                    </option>
                                `).join("")}
                            </select>
                        </div>

                        <div class="form-field">
                            <label for="expenseCategory">تصنيف المصروف (اختياري)</label>
                            <select id="expenseCategory">
                                <option value="">بدون تصنيف</option>
                                ${categories.map((category) => `
                                    <option value="${category.id}">
                                        ${escape(category.name)}
                                    </option>
                                `).join("")}
                            </select>
                        </div>

                        <div
                            id="expenseMessage"
                            class="product-form-message"
                            role="status"
                            aria-live="polite"
                        ></div>

                        <button class="primary-button" type="submit">
                            حفظ المصروف وخصمه من الخزنة
                        </button>
                    </form>
                </div>

                <div class="last-invoices-panel">
                    <h3>دفتر المصروفات السابقة</h3>

                    <div class="last-invoices-table-wrapper">
                        <table class="last-invoices-table">
                            <thead>
                                <tr>
                                    <th>التاريخ</th>
                                    <th>البيان</th>
                                    <th>التصنيف</th>
                                    <th>الخزنة</th>
                                    <th>المبلغ</th>
                                    <th>إجراء</th>
                                </tr>
                            </thead>

                            <tbody>
                                ${entries.map((entry) => `
                                    <tr>
                                        <td>${escape(dateText(entry.created_at))}</td>
                                        <td>${escape(entry.description || "—")}</td>
                                        <td>${escape(entry.category_name || "بدون تصنيف")}</td>
                                        <td>${escape(entry.account_name || "—")}</td>
                                        <td><strong>${money(entry.amount)} ج.م</strong></td>
                                        <td>
                                            ${Number(entry.can_delete) === 1
                                                ? `<button type="button" class="secondary-button" data-delete-expense="${Number(entry.id)}">حذف</button>`
                                                : `<span title="لا يمكن حذف هذا السجل من هنا">—</span>`}
                                        </td>
                                    </tr>
                                `).join("") || `
                                    <tr>
                                        <td colspan="6">لا توجد مصروفات مسجلة حتى الآن.</td>
                                    </tr>
                                `}
                            </tbody>
                        </table>
                    </div>
                </div>
            `
        );

        page.querySelectorAll("[data-delete-expense]").forEach((button) => {
            button.addEventListener("click", async () => {
                const expenseId = Number(button.dataset.deleteExpense);
                const entry = entries.find((item) => Number(item.id) === expenseId);

                if (!entry || Number(entry.can_delete) !== 1) return;

                const confirmed = window.confirm(
                    `هل تريد حذف المصروف "${entry.description || "بدون بيان"}" بقيمة ${money(entry.amount)} ج.م؟\n\nسيتم حذف حركة الصرف المرتبطة وإرجاع المبلغ إلى الخزنة.`
                );

                if (!confirmed) return;

                button.disabled = true;

                try {
                    const password = await window.requestDeletionPassword?.();
                    if (!password) return;
                    await window.elSharq.deleteExpense(expenseId, password);
                    await expenses();
                } catch (error) {
                    fail("expenseMessage", error);
                    if (button.isConnected) button.disabled = false;
                }
            });
        });

        page.querySelector("#expenseForm").addEventListener("submit", async (event) => {
            event.preventDefault();

            const button = page.querySelector('#expenseForm button[type="submit"]');
            if (button.disabled) return;

            button.disabled = true;

            try {
                await window.elSharq.addExpense({
                    account_id: page.querySelector("#expenseAccount").value,
                    amount: page.querySelector("#expenseAmount").value,
                    expense_category_id:
                        page.querySelector("#expenseCategory").value || null,
                    description:
                        page.querySelector("#expenseDescription").value.trim()
                });

                // إعادة تحميل دفتر المصروفات بعد نجاح التسجيل.
                await expenses();
            } catch (error) {
                fail("expenseMessage", error);
            } finally {
                if (button.isConnected) {
                    button.disabled = false;
                }
            }
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
            <div class="sales-panel" style="margin-top:16px">
                <div class="sales-panel-header"><div><h3>كشف الخزنة للفترة المحددة</h3><span>طباعة كل الحركات المالية من وإلى الخزنة حسب تاريخ التقرير</span></div></div>
                <div class="sale-info-grid">
                    <div class="form-field">
                        <label for="reportPrintMode">نوع البيان للطباعة</label>
                        <select id="reportPrintMode">
                            <option value="detailed">بيان مفصل - كل حركة بالتفصيل</option>
                            <option value="summary">بيان مختصر - إجماليات حسب البند</option>
                        </select>
                    </div>
                    <div class="form-field" style="align-self:end">
                        <button type="button" class="primary-button" id="reportPrintButton">طباعة التقرير المالي</button>
                    </div>
                </div>
            </div>
        `);
        const draw = (data) => {
            page.querySelector("#reportCards").innerHTML = `
                <div class="stat-card"><div class="stat-icon sales">م</div><div><span>إجمالي المبيعات</span><strong>${money(data.sales.total)} ج.م</strong><small>مقبوضات المبيعات خلال الفترة ${money(data.sales.paid)} / متبقي حالي على فواتير الفترة ${money(data.sales.remaining)}</small></div></div>
                <div class="stat-card"><div class="stat-icon cash">ش</div><div><span>المشتريات (${data.purchases.count} فاتورة)</span><strong>${money(data.purchases.total)} ج.م</strong><small>مدفوعات المشتريات خلال الفترة ${money(data.purchases.paid)} / متبقي حالي على فواتير الفترة ${money(data.purchases.remaining)}</small></div></div>
                <div class="stat-card"><div class="stat-icon profit">ر</div><div><span>مجمل الربح التقديري</span><strong>${money(data.sales.profit)} ج.م</strong></div></div>
                <div class="stat-card"><div class="stat-icon profit">ص</div><div><span>صافي الربح بعد المصروفات</span><strong>${money(Number(data.sales.profit || 0) - Number(data.expenses || 0))} ج.م</strong><small>مجمل الربح ناقص المصروفات</small></div></div>
                <div class="stat-card"><div class="stat-icon cash">ص</div><div><span>المصروفات</span><strong>${money(data.expenses)} ج.م</strong></div></div>
                <div class="stat-card"><div class="stat-icon stock">م</div><div><span>قيمة المخزون الحالية بالجملة</span><strong>${money(data.stockValue)} ج.م</strong></div></div>
                <div class="stat-card"><div class="stat-icon stock">ق</div><div><span>قيمة المخزون الحالية بالقطاعي</span><strong>${money(data.stockRetailValue)} ج.م</strong></div></div>
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
        });        page.querySelector("#reportPrintButton").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            const from = page.querySelector("#reportFrom").value;
            const to = page.querySelector("#reportTo").value;
            const mode = page.querySelector("#reportPrintMode").value;

            if (!from || !to || from > to) {
                status("reportMessage", "حدد فترة تاريخ صحيحة قبل الطباعة", true);
                return;
            }

            let printWindow;
            button.disabled = true;
            try {
                // Open synchronously from the click so the desktop print window is not blocked.
                printWindow = window.elSharqInvoicePrint.open();
                const report = await window.elSharq.getCashStatement({ from, to });
                const formatMoney = (value) => new Intl.NumberFormat("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2
                }).format(Number(value || 0));
                const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
                    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
                }[character]));
                const movementLabels = {
                    sale: "مبيعات نقدية",
                    quick_sale: "بيع سريع",
                    quick_return: "مرتجع سريع",
                    purchase: "مشتريات / دفع مورد",
                    manual_income: "إيراد يدوي",
                    manual_expense: "مصروف يدوي",
                    expense: "مصروف",
                    customer_payment: "تحصيل من عميل",
                    supplier_payment: "سداد مورد",
                    sale_payment: "تحصيل مبيعات",
                    purchase_payment: "سداد مشتريات",
                    transfer_in: "تحويل وارد",
                    transfer_out: "تحويل صادر"
                };
                const referenceLabels = {
                    sale: "فاتورة بيع",
                    purchase: "فاتورة شراء",
                    quick_transaction: "معاملة سريعة",
                    cash_transaction: "حركة نقدية",
                    expense: "مصروف",
                    customer_payment: "تحصيل عميل",
                    supplier_payment: "سداد مورد"
                };
                const movementLabel = (type) => movementLabels[type] || String(type || "حركة مالية").replace(/_/g, " ");
                const fmtDate = (value) => {
                    const text = String(value || "").replace("T", " ");
                    return htmlEscape(text.length > 19 ? text.slice(0, 19) : text);
                };
                const money = (value) => `${formatMoney(value)} ج.م`;
                const accounts = report.accounts || [];
                const transactions = report.transactions || [];
                const accountsById = new Map(accounts.map((account) => [Number(account.id), account]));

                const totalOpening = accounts.reduce((sum, account) => sum + Number(account.opening_balance || 0), 0);
                const totalIn = accounts.reduce((sum, account) => sum + Number(account.total_in || 0), 0);
                const totalOut = accounts.reduce((sum, account) => sum + Number(account.total_out || 0), 0);
                const totalClosing = accounts.reduce((sum, account) => sum + Number(account.closing_balance || 0), 0);

                const accountRows = accounts.map((account) => `
                    <tr>
                        <td>${htmlEscape(account.name)}</td>
                        <td class="num">${money(account.opening_balance)}</td>
                        <td class="num incoming">${money(account.total_in)}</td>
                        <td class="num outgoing">${money(account.total_out)}</td>
                        <td class="num">${money(account.closing_balance)}</td>
                    </tr>
                `).join("") || '<tr><td colspan="5">لا توجد خزائن مسجلة</td></tr>';

                let movementRows = "";
                if (mode === "detailed") {
                    const running = new Map(accounts.map((account) => [Number(account.id), Number(account.opening_balance || 0)]));
                    movementRows = transactions.map((transaction, index) => {
                        const accountId = Number(transaction.cash_account_id);
                        const isIncoming = transaction.direction === "in";
                        const amount = Number(transaction.amount || 0);
                        const after = Number(running.get(accountId) || 0) + (isIncoming ? amount : -amount);
                        running.set(accountId, after);
                        const ref = transaction.reference_type
                            ? `${referenceLabels[transaction.reference_type] || transaction.reference_type}${transaction.reference_id == null ? "" : ` #${transaction.reference_id}`}`
                            : "-";
                        return `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${fmtDate(transaction.created_at)}</td>
                                <td>${htmlEscape(transaction.account_name)}</td>
                                <td>${htmlEscape(movementLabel(transaction.transaction_type))}</td>
                                <td>${htmlEscape(transaction.description || "-")}</td>
                                <td>${htmlEscape(ref)}</td>
                                <td class="num incoming">${isIncoming ? money(amount) : "-"}</td>
                                <td class="num outgoing">${isIncoming ? "-" : money(amount)}</td>
                                <td class="num">${money(after)}</td>
                            </tr>
                        `;
                    }).join("") || '<tr><td colspan="9">لا توجد حركات مالية في الفترة المحددة</td></tr>';
                } else {
                    const grouped = new Map();
                    for (const transaction of transactions) {
                        const key = `${transaction.cash_account_id}|${transaction.transaction_type || "unknown"}`;
                        if (!grouped.has(key)) {
                            grouped.set(key, {
                                account_name: transaction.account_name,
                                transaction_type: transaction.transaction_type,
                                count: 0,
                                total_in: 0,
                                total_out: 0
                            });
                        }
                        const group = grouped.get(key);
                        group.count += 1;
                        if (transaction.direction === "in") group.total_in += Number(transaction.amount || 0);
                        else group.total_out += Number(transaction.amount || 0);
                    }
                    movementRows = Array.from(grouped.values()).map((group) => `
                        <tr>
                            <td>${htmlEscape(group.account_name)}</td>
                            <td>${htmlEscape(movementLabel(group.transaction_type))}</td>
                            <td class="num">${group.count}</td>
                            <td class="num incoming">${money(group.total_in)}</td>
                            <td class="num outgoing">${money(group.total_out)}</td>
                        </tr>
                    `).join("") || '<tr><td colspan="5">لا توجد حركات مالية في الفترة المحددة</td></tr>';
                }

                const detailed = mode === "detailed";
                const movementTable = detailed ? `
                    <table>
                        <thead><tr><th>#</th><th>التاريخ والوقت</th><th>الخزنة</th><th>نوع الحركة</th><th>البيان والتفاصيل</th><th>المرجع</th><th>وارد</th><th>صادر</th><th>الرصيد بعد الحركة</th></tr></thead>
                        <tbody>${movementRows}</tbody>
                    </table>
                ` : `
                    <table>
                        <thead><tr><th>الخزنة</th><th>البند</th><th>عدد الحركات</th><th>إجمالي الوارد</th><th>إجمالي الصادر</th></tr></thead>
                        <tbody>${movementRows}</tbody>
                    </table>
                `;

                const printableHtml = `<!doctype html>
                    <html lang="ar" dir="rtl">
                    <head>
                        <meta charset="utf-8">
                        <title>كشف الخزنة ${detailed ? "المفصل" : "المختصر"}</title>
                        <style>
                            * { box-sizing: border-box; }
                            body { font-family: Tahoma, Arial, sans-serif; color: #18202b; margin: 18px; font-size: 12px; }
                            h1,h2,p { margin: 0; }
                            .header { display: flex; justify-content: space-between; align-items: start; border-bottom: 2px solid #263449; padding-bottom: 12px; margin-bottom: 12px; }
                            h1 { font-size: 22px; margin-bottom: 5px; }
                            h2 { font-size: 17px; margin-bottom: 6px; }
                            .muted { color: #586477; line-height: 1.8; }
                            .totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
                            .card { border: 1px solid #cbd1db; border-radius: 5px; padding: 9px; }
                            .card strong { display: block; font-size: 14px; margin-top: 5px; }
                            table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: auto; }
                            th,td { border: 1px solid #cbd1db; text-align: right; vertical-align: top; padding: 6px; overflow-wrap: anywhere; }
                            th { background: #edf0f4; white-space: nowrap; }
                            .num { direction: ltr; text-align: left; white-space: nowrap; }
                            .incoming { color: #12633c; }
                            .outgoing { color: #9e2727; }
                            .section { margin-top: 17px; }
                            .footer { margin-top: 18px; border-top: 1px solid #ccd2dc; padding-top: 8px; color: #667085; }
                            @page { size: landscape; margin: 10mm; }
                            @media print { body { margin: 0; } .card { break-inside: avoid; } tr { break-inside: avoid; } }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <div><h1>الشرق</h1><p class="muted">نظام إدارة المحل — كشف حركة الخزنة</p></div>
                            <div><h2>${detailed ? "بيان مفصل" : "بيان مختصر"}</h2><p>الفترة: ${htmlEscape(from)} إلى ${htmlEscape(to)}</p><p class="muted">تاريخ الطباعة: ${htmlEscape(new Date().toLocaleString("ar-EG"))}</p></div>
                        </div>
                        <div class="totals">
                            <div class="card">الرصيد الافتتاحي<strong>${money(totalOpening)}</strong></div>
                            <div class="card">إجمالي الوارد<strong class="incoming">${money(totalIn)}</strong></div>
                            <div class="card">إجمالي الصادر<strong class="outgoing">${money(totalOut)}</strong></div>
                            <div class="card">الرصيد الختامي<strong>${money(totalClosing)}</strong></div>
                        </div>
                        <section class="section">
                            <h2>ملخص أرصدة الخزائن</h2>
                            <table><thead><tr><th>الخزنة</th><th>الرصيد الافتتاحي</th><th>وارد الفترة</th><th>صادر الفترة</th><th>الرصيد الختامي</th></tr></thead><tbody>${accountRows}</tbody></table>
                        </section>
                        <section class="section">
                            <h2>${detailed ? "تفاصيل جميع الحركات المالية" : "إجماليات الحركات حسب البند"}</h2>
                            ${movementTable}
                        </section>
                        <div class="footer">تم إنشاء التقرير من سجل الحركات النقدية المسجل في النظام. التوقيع: ____________________</div>
                    </body></html>`;

                printWindow.document.open();
                printWindow.document.write(printableHtml);
                printWindow.document.close();
                printWindow.focus();
                setTimeout(() => {
                    if (!printWindow.closed) printWindow.print();
                }, 400);
                status("reportMessage", "تم تجهيز كشف الخزنة للطباعة");
            } catch (error) {
                if (printWindow && !printWindow.closed) printWindow.close();
                fail("reportMessage", error);
                window.alert(error?.message || "تعذرت طباعة كشف الخزنة");
            } finally {
                button.disabled = false;
            }
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
                <div class="form-field"><label>اسم المحل الظاهر في الفاتورة</label><input id="storeName" maxlength="160" value="${escape(values.store_name || "الشرق")}"></div>
                <div class="form-field"><label>الهاتف</label><input id="storePhone" type="tel" value="${escape(values.store_phone || "")}"></div>
                                <div class="form-field"><label>العنوان</label><input id="storeAddress" value="${escape(values.store_address || "")}"></div>
                                <div class="form-field"><label for="storeOwnerName">اسم صاحب المحل</label><input id="storeOwnerName" maxlength="160" value="${escape(values.store_owner_name || "ناشد دميان")}"></div>
                                <div class="form-field"><label>العملة</label><input value="جنيه مصري" disabled></div>
                <div id="settingsMessage" class="product-form-message"></div><button class="primary-button" type="submit">حفظ الإعدادات</button>
            </form>
            <div class="sale-info-grid">
                <button class="secondary-button" id="backupDatabaseButton" type="button">إنشاء نسخة احتياطية</button>
                <div id="backupMessage" class="product-form-message"></div>
            </div></div>
            <div class="sales-panel">
                <div class="sales-panel-header"><div><h3>نقل المنتجات والأسعار</h3><span>صدّر ملفًا إلى الفلاشة ثم استورده في نسخة العميل.</span></div></div>
                <div class="sale-info-grid">
                    <button class="secondary-button" id="exportProductCatalogButton" type="button">تصدير المنتجات والأسعار</button>
                    <button class="secondary-button" id="importProductCatalogButton" type="button">استيراد ملف المنتجات</button>
                    <div id="productTransferMessage" class="product-form-message"></div>
                </div>
            </div>
            <div class="sales-panel">
                <div class="sales-panel-header"><div><h3>كلمة المرور الموحدة</h3><span>${values.finance_password_configured || values.deletion_password_configured ? "أدخل كلمات المرور الحالية المضبوطة لتوحيدها أو تغييرها." : "أنشئ كلمة واحدة للخزنة والتقارير وحذف الأصناف والفواتير."}</span></div></div>
                <form id="sharedSecurityPasswordForm" class="sale-info-grid">
                    ${(values.finance_password_configured || values.deletion_password_configured) && values.security_passwords_unified ? '<div class="form-field"><label for="currentSharedPassword">كلمة المرور الحالية</label><input id="currentSharedPassword" type="password" autocomplete="current-password" required></div>' : ""}
                    ${!values.security_passwords_unified && values.finance_password_configured ? '<div class="form-field"><label for="currentFinancePassword">كلمة مرور الخزنة/التقارير الحالية</label><input id="currentFinancePassword" type="password" autocomplete="current-password" required></div>' : ""}
                    ${!values.security_passwords_unified && values.deletion_password_configured ? '<div class="form-field"><label for="currentDeletionPassword">كلمة مرور الحذف الحالية</label><input id="currentDeletionPassword" type="password" autocomplete="current-password" required></div>' : ""}
                    <div class="form-field"><label for="newSharedPassword">كلمة المرور الجديدة (4 أحرف أو أرقام على الأقل)</label><input id="newSharedPassword" type="password" minlength="4" autocomplete="new-password" required></div>
                    <div class="form-field"><label for="confirmSharedPassword">تأكيد كلمة المرور الجديدة</label><input id="confirmSharedPassword" type="password" minlength="4" autocomplete="new-password" required></div>
                    <div id="sharedSecurityPasswordMessage" class="product-form-message"></div>
                    <button class="primary-button" type="submit">${values.finance_password_configured || values.deletion_password_configured ? "حفظ كلمة المرور الموحدة" : "تعيين كلمة المرور الموحدة"}</button>
                </form>
            </div>
        `);
        page.querySelector("#settingsForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                await window.elSharq.saveSettings({
                    store_name: page.querySelector("#storeName").value,
                    store_phone: page.querySelector("#storePhone").value,
                                        store_address: page.querySelector("#storeAddress").value,
                                        store_owner_name: page.querySelector("#storeOwnerName").value
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
        page.querySelector("#exportProductCatalogButton").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                const result = await window.elSharq.exportProductCatalog();
                if (result.canceled) return;
                status("productTransferMessage", `تم تصدير ${result.count} منتجًا. انسخ ملف JSON إلى الفلاشة.`);
            } catch (error) {
                fail("productTransferMessage", error);
            } finally {
                button.disabled = false;
            }
        });
        page.querySelector("#importProductCatalogButton").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                const result = await window.elSharq.importProductCatalog();
                if (result.canceled) return;
                status("productTransferMessage", `اكتمل الاستيراد: إضافة ${result.added} صنف جديد بمخزون صفر، وتجاهل ${result.skipped} صنفًا موجودًا بنفس الكود دون تغيير بياناته.`);
            } catch (error) {
                fail("productTransferMessage", error);
            } finally {
                button.disabled = false;
            }
        });
        page.querySelector("#sharedSecurityPasswordForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            const newPassword = page.querySelector("#newSharedPassword").value;
            if (newPassword !== page.querySelector("#confirmSharedPassword").value) {
                return status("sharedSecurityPasswordMessage", "كلمتا المرور غير متطابقتين", true);
            }
            const button = event.currentTarget.querySelector('[type="submit"]');
            button.disabled = true;
            try {
                await window.elSharq.setSharedSecurityPassword(
                    page.querySelector("#currentSharedPassword")?.value || page.querySelector("#currentFinancePassword")?.value || "",
                    page.querySelector("#currentSharedPassword")?.value || page.querySelector("#currentDeletionPassword")?.value || "",
                    newPassword
                );
                status("sharedSecurityPasswordMessage", "تم حفظ كلمة المرور الموحدة للخزنة والتقارير والحذف");
                await settings();
            } catch (error) {
                fail("sharedSecurityPasswordMessage", error);
            } finally {
                button.disabled = false;
            }
        });
    }

    // reservation-smart-search-v2: dark, responsive UI with searchable product picker and price snapshots.
    async function reservations() {
        const [allProducts, reservationRows, stockRows] = await Promise.all([
            window.elSharq.getProducts(),
            window.elSharq.getReservations(),
            window.elSharq.getStockOverview()
        ]);
        const products = (allProducts || [])
            .filter((product) => Number(product.active ?? product.is_active ?? 1) === 1)
            .map((product) => ({
                ...product,
                id: Number(product.id),
                sale_price: Number(product.sale_price ?? product.salePrice ?? 0),
                category_name: String(product.category_name || product.category || "").trim(),
                unit: String(product.unit || "قطعة"),
                code: String(product.product_code || product.code || product.barcode || product.sku || "").trim()
            }));
        const stockByProduct = new Map((stockRows || []).map((row) => [
            Number(row.id ?? row.product_id),
            Number(row.total_quantity ?? row.quantity ?? 0)
        ]));
        const money = (value) => Number(value || 0).toLocaleString("en-EG", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        const dateText = (value) => {
            if (!value) return "-";
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString("ar-EG");
        };
        const statusText = (value) => ({ pending: "قيد الحجز", completed: "تم التسليم", cancelled: "ملغي" }[value] || String(value || "-"));
        const pendingRows = (reservationRows || []).filter((row) => row.status === "pending");
        const pendingTotal = pendingRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
        const pendingRemaining = pendingRows.reduce((sum, row) => sum + Number(row.remaining_amount || 0), 0);

        const rowsHtml = (reservationRows || []).map((row) => {
            const actions = row.status === "pending" ? `
                <button type="button" class="secondary-button" data-res-action="view" data-id="${Number(row.id)}">عرض الحجز</button>
                <button type="button" class="secondary-button" data-res-action="edit" data-id="${Number(row.id)}">تعديل</button>
                <button type="button" class="primary-button" data-res-action="payment" data-id="${Number(row.id)}">تحصيل دفعة</button>
                <button type="button" class="secondary-button" data-res-action="deliver" data-id="${Number(row.id)}">تسليم وتحويل لفاتورة</button>
                <button type="button" class="secondary-button" data-res-action="cancel" data-id="${Number(row.id)}">إلغاء ورد المدفوع</button>
            ` : (row.status === "completed" ? `
                <button type="button" class="secondary-button" data-res-action="view" data-id="${Number(row.id)}">عرض الفاتورة ${escape(row.invoice_number || "")}</button>
            ` : `
                <button type="button" class="secondary-button" data-res-action="view" data-id="${Number(row.id)}">عرض الحجز الملغي</button>
                <span class="reservation-cancelled-label">تم إلغاء الحجز</span>
            `);
            return `
                <tr>
                    <td><strong class="reservation-number">${escape(row.reservation_number || "")}</strong><small class="reservation-date">${escape(dateText(row.created_at))}</small></td>
                    <td><strong>${escape(row.customer_name || "")}</strong><small class="reservation-date">${escape(row.customer_phone || "بدون رقم هاتف")}</small></td>
                    <td class="reservation-summary-cell">${escape(row.items_summary || "-")}</td>
                    <td class="reservation-money">${money(row.total_amount)} <small>ج.م</small></td>
                    <td class="reservation-money">${money(row.paid_amount)} <small>ج.م</small></td>
                    <td class="reservation-money ${Number(row.remaining_amount || 0) > 0 ? "reservation-due" : ""}">${money(row.remaining_amount)} <small>ج.م</small></td>
                    <td><span class="reservation-status reservation-status-${escape(row.status || "pending")}">${escape(statusText(row.status))}</span></td>
                    <td><div class="reservation-actions">${actions}</div></td>
                </tr>
            `;
        }).join("");

        const page = content("حجوزات العملاء", "إدارة الحجوزات والعربون وتسليم الأصناف مع الحفاظ على رصيد المخزون.", `
            <style>
                .reservation-screen{color:#e7eef5;direction:rtl;min-width:0}
                .reservation-hero{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;padding:23px 25px;margin:0 0 18px;border:1px solid #2b4555;border-radius:20px;background:radial-gradient(circle at 12% 5%,rgba(84,227,189,.12),transparent 30%),linear-gradient(120deg,#1b2c3a,#15232f 62%,#19343b);box-shadow:0 12px 28px rgba(0,0,0,.12)}
                .reservation-hero-copy{min-width:230px;flex:1}.reservation-eyebrow{display:inline-block;font-size:11px;letter-spacing:.08em;color:#54e3bd;font-weight:800;margin-bottom:7px}.reservation-hero h2{margin:0 0 7px;color:#f5f8fb;font-size:23px;font-weight:800}.reservation-hero p{margin:0;color:#aabac9;font-size:13px;line-height:1.8;max-width:720px}
                .reservation-stats{display:grid;grid-template-columns:repeat(3,minmax(115px,1fr));gap:10px;min-width:min(100%,390px);flex:1;max-width:500px}.reservation-stat{padding:13px 14px;border:1px solid rgba(140,171,192,.18);border-radius:13px;background:rgba(7,17,26,.25)}.reservation-stat span{display:block;color:#9cafbf;font-size:11px;margin-bottom:7px}.reservation-stat strong{display:block;color:#f3f7fb;font-size:17px;font-weight:800;white-space:nowrap}.reservation-stat small{font-size:10px;color:#9cafbf;font-weight:500}
                .reservation-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:17px;align-items:start}/* reservation-full-width-layout-v1 */
                .reservation-card{background:linear-gradient(160deg,#192734,#141f2a 80%);border:1px solid #2a3a49;border-radius:18px;padding:19px;min-width:0;color:#e7eef5;box-shadow:0 10px 25px rgba(0,0,0,.1)}
                .reservation-card-heading{display:flex;align-items:center;gap:11px;margin:0 0 16px;padding-bottom:14px;border-bottom:1px solid #2b3a48}.reservation-card-icon{width:37px;height:37px;display:grid;place-items:center;border-radius:11px;background:rgba(84,227,189,.12);color:#54e3bd;font-size:18px;flex:none}.reservation-card-heading h3{margin:0;color:#f3f7fb;font-size:16px;font-weight:800}.reservation-card-heading p{margin:4px 0 0;color:#92a6b8;font-size:11px;line-height:1.65}
                .reservation-screen .form-field label,.reservation-screen label{display:block;color:#adbecc;font-size:12px;font-weight:650;margin-bottom:7px}.reservation-screen .form-field{min-width:0}.reservation-form-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) minmax(0,.8fr);gap:13px}/* reservation-wide-form-fields-v1 */.reservation-screen input,.reservation-screen select,.reservation-screen textarea{background:#101a24!important;border:1px solid #334656!important;border-radius:10px!important;color:#eef4f8!important;min-height:42px;box-sizing:border-box;box-shadow:none!important;width:100%;padding:10px 12px;font:inherit;font-size:13px;outline:none}.reservation-screen textarea{resize:vertical;min-height:75px}.reservation-screen input::placeholder,.reservation-screen textarea::placeholder{color:#718494}.reservation-screen input:focus,.reservation-screen select:focus,.reservation-screen textarea:focus{border-color:#54e3bd!important;box-shadow:0 0 0 3px rgba(84,227,189,.09)!important}.reservation-screen input[readonly]{color:#bcefe2!important;background:#14252c!important}.reservation-screen input[type=date]{color-scheme:dark}
                .reservation-section-label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:20px 0 8px}.reservation-section-label strong{font-size:13px;color:#edf3f8}.reservation-section-label span{font-size:11px;color:#95a9b9}.reservation-hint{display:block;color:#8ea4b6;font-size:11px;line-height:1.7;margin-top:6px}.reservation-items{display:grid;gap:9px;margin:10px 0 12px}.reservation-item-row{display:grid;grid-template-columns:minmax(0,1fr) 83px 112px 34px;gap:8px;align-items:start;border:1px solid #2b3d4c;background:rgba(10,19,28,.38);border-radius:13px;padding:10px}/* reservation-aligned-grid-v1 */.reservation-product-picker{position:relative;min-width:0}.reservation-picker-input{padding-left:36px!important}.reservation-search-icon{position:absolute;left:12px;top:13px;color:#7e95a6;pointer-events:none;font-size:14px}.reservation-product-dropdown{position:absolute;inset-inline:0;top:calc(100% + 5px);z-index:1000;max-height:290px;overflow:auto;border:1px solid #3a5264;background:#101b26;border-radius:12px;box-shadow:0 16px 35px rgba(0,0,0,.4);padding:5px}.reservation-product-dropdown[hidden]{display:none}.reservation-suggestion{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:right;border:1px solid transparent;background:transparent;color:#e8f0f6;border-radius:9px;padding:10px;cursor:pointer}.reservation-suggestion:hover,.reservation-suggestion.reservation-suggestion-active{background:#1d303d;border-color:#365162}.reservation-suggestion-main{min-width:0;display:flex;flex-direction:column;gap:4px}.reservation-suggestion-main strong{font-size:12px;white-space:normal;color:#f3f7fa}.reservation-suggestion-main small{font-size:10px;color:#91a7b8;line-height:1.5}.reservation-suggestion-price{font-size:12px;font-weight:800;color:#54e3bd;white-space:nowrap}.reservation-no-match{padding:14px;text-align:center;color:#8fa4b5;font-size:12px}.reservation-mini-field{min-width:0}.reservation-mini-field input{text-align:center;padding-inline:6px}.reservation-remove-button{height:40px;margin-top:26px;align-self:start;min-width:34px;border-radius:9px!important;background:rgba(240,104,104,.09)!important;border:1px solid rgba(240,104,104,.27)!important;color:#ff9b9b!important;font-size:20px;cursor:pointer}.reservation-remove-button:hover{background:rgba(240,104,104,.17)!important}.reservation-selected-meta{display:block;color:#8ea6b7;font-size:10px;line-height:1.5;margin-top:4px;min-height:0}.reservation-selected-meta[hidden]{display:none!important}
                .reservation-screen .primary-button,.reservation-screen .secondary-button{border-radius:10px!important;font:inherit;font-size:12px;font-weight:750;min-height:38px;padding:9px 13px;cursor:pointer;transition:transform .15s,filter .15s}.reservation-screen .primary-button{background:linear-gradient(135deg,#54e3bd,#37c7a4)!important;color:#10232a!important;border:1px solid #54e3bd!important;box-shadow:0 5px 14px rgba(31,191,151,.1)}.reservation-screen .secondary-button{background:#202f3b!important;color:#d9e4ec!important;border:1px solid #3b4d5c!important}.reservation-screen .primary-button:hover,.reservation-screen .secondary-button:hover{filter:brightness(1.08);transform:translateY(-1px)}.reservation-screen button:disabled{opacity:.5;cursor:not-allowed;transform:none}.reservation-add-item{width:100%;border-style:dashed!important}.reservation-total{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:14px 0 12px;padding:14px;border-radius:12px;border:1px solid rgba(84,227,189,.2);background:rgba(84,227,189,.06)}.reservation-total span{font-size:12px;color:#a9bbc9}.reservation-total strong{font-size:22px;color:#54e3bd;font-variant-numeric:tabular-nums}.reservation-form-actions{display:grid;grid-template-columns:1fr;gap:8px}.reservation-message{font-size:12px;line-height:1.7;min-height:0}.reservation-message:empty{display:none}
                .reservation-table-wrap{overflow:auto;border:1px solid #293b4a;border-radius:12px}.reservation-table{width:100%;border-collapse:separate;border-spacing:0;min-width:920px;font-size:12px}.reservation-table th,.reservation-table td{padding:13px 11px;text-align:right;border-bottom:1px solid #293946;vertical-align:middle}.reservation-table th{position:sticky;top:0;background:#223341;color:#afc2d0;font-weight:750;font-size:11px;white-space:nowrap}.reservation-table tbody tr{background:rgba(14,24,34,.32)}.reservation-table tbody tr:nth-child(even){background:rgba(30,44,56,.25)}.reservation-table tbody tr:hover{background:rgba(84,227,189,.045)}.reservation-table tbody tr:last-child td{border-bottom:0}.reservation-number{color:#7fe7cb;font-size:12px;letter-spacing:.02em}.reservation-date{display:block;color:#839aab;font-size:10px;margin-top:5px}.reservation-summary-cell{color:#bdcbd5;line-height:1.9;min-width:150px}.reservation-money{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:700}.reservation-money small{font-size:10px;color:#8ea3b4;font-weight:500}.reservation-due{color:#ffca85}.reservation-status{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;padding:5px 8px;border-radius:20px;font-size:10px;font-weight:800}.reservation-status-pending{color:#f8ce87;background:rgba(246,188,93,.12);border:1px solid rgba(246,188,93,.22)}.reservation-status-completed{color:#72e2bc;background:rgba(84,227,189,.1);border:1px solid rgba(84,227,189,.2)}.reservation-status-cancelled{color:#ff9b9b;background:rgba(240,104,104,.1);border:1px solid rgba(240,104,104,.2)}.reservation-actions{display:flex;flex-wrap:wrap;gap:6px;min-width:220px}.reservation-actions button{font-size:10px!important;padding:7px 9px!important;min-height:31px!important}.reservation-invoice-label{color:#83e1c3}.reservation-cancelled-label{color:#ad8f8f}.reservation-empty{padding:34px 16px;text-align:center;color:#91a6b7}.reservation-empty strong{display:block;color:#dce7ee;font-size:13px;margin-bottom:5px}.reservation-empty span{font-size:11px}.reservation-list-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:13px}.reservation-list-heading .reservation-card-heading{margin:0;padding:0;border:0}.reservation-count{border:1px solid #304755;border-radius:10px;color:#9eb4c4;background:#1a2935;font-size:11px;padding:7px 10px;white-space:nowrap}
                @media(max-width:1250px){.reservation-layout{grid-template-columns:minmax(0,1fr)}.reservation-stats{max-width:550px}}
                @media(max-width:760px){.reservation-hero{padding:18px}.reservation-hero h2{font-size:20px}.reservation-stats{grid-template-columns:1fr;min-width:100%;max-width:none}.reservation-stat{display:flex;justify-content:space-between;align-items:center;gap:12px}.reservation-stat span{margin:0}.reservation-stat strong{font-size:15px}.reservation-card{padding:14px}.reservation-form-grid{grid-template-columns:1fr 1fr}.reservation-item-row{grid-template-columns:minmax(0,1fr) 77px 95px 32px;padding:8px;gap:6px}.reservation-section-label{align-items:flex-start;flex-direction:column}.reservation-screen .form-field label,.reservation-screen label{font-size:11px}}
                @media(max-width:520px){.reservation-form-grid{grid-template-columns:1fr}.reservation-item-row{grid-template-columns:minmax(0,1fr) 1fr 32px;align-items:end}.reservation-item-product{grid-column:1/-1}.reservation-item-row .reservation-mini-field[data-field="price"]{grid-column:1/3}.reservation-item-row .reservation-remove-button{grid-column:3;grid-row:2}.reservation-item-row .reservation-mini-field[data-field="quantity"]{grid-column:1}.reservation-item-row .reservation-mini-field[data-field="price"]{grid-column:2}.reservation-total strong{font-size:19px}}
            </style>
            <div class="reservation-screen">
                <section class="reservation-hero">
                    <div class="reservation-hero-copy">
                        <span class="reservation-eyebrow">EL-SHARQ / CUSTOMER ORDERS</span>
                        <h2>حجوزات العملاء</h2>
                        <p>سجّل طلب العميل بالعربون والأسعار وقت الاتفاق. الكميات تظل محجوزة دون خصمها من الرصيد الفعلي حتى يتم التسليم.</p>
                    </div>
                    <div class="reservation-stats">
                        <div class="reservation-stat"><span>حجوزات قيد الانتظار</span><strong>${pendingRows.length}</strong></div>
                        <div class="reservation-stat"><span>إجمالي الحجوزات النشطة</span><strong>${money(pendingTotal)} <small>ج.م</small></strong></div>
                        <div class="reservation-stat"><span>المتبقي للتحصيل</span><strong>${money(pendingRemaining)} <small>ج.م</small></strong></div>
                    </div>
                </section>
                <div class="reservation-layout">
                    <section class="reservation-card">
                        <div class="reservation-card-heading"><span class="reservation-card-icon">＋</span><div><h3>تسجيل حجز جديد</h3><p>أضف العميل والأصناف وموعد الاستلام.</p></div></div>
                        <form id="reservationForm">
                            <div class="reservation-form-grid">
                                <div class="form-field"><label for="reservationCustomer">اسم العميل *</label><input id="reservationCustomer" type="text" required maxlength="160" placeholder="اكتب اسم العميل"></div>
                                <div class="form-field"><label for="reservationPhone">رقم الهاتف</label><input id="reservationPhone" type="tel" maxlength="40" placeholder="01xxxxxxxxx"></div>
                                <div class="form-field"><label for="reservationDueDate">موعد الاستلام المتوقع</label><input id="reservationDueDate" type="date"></div>
                                <div class="form-field"><label for="reservationDeposit">العربون (ج.م)</label><input id="reservationDeposit" type="number" min="0" step="0.01" value="0"></div>
                            </div>
                            <div class="reservation-section-label"><strong>أصناف الحجز</strong><span>ابحث باسم الصنف أو الكود</span></div>
                            <div id="reservationItems" class="reservation-items"></div>
                            <button type="button" class="secondary-button reservation-add-item" id="reservationAddItem">＋ إضافة صنف جديد</button>
                            <span class="reservation-hint">سعر البيع الحالي يظهر تلقائيًا عند اختيار الصنف. السعر المحفوظ للحجز لا يتغير لو قائمة أسعار المنتج اتعدلت لاحقًا.</span>
                            <div class="form-field" style="margin-top:16px"><label for="reservationNotes">ملاحظات الحجز</label><textarea id="reservationNotes" rows="2" placeholder="تفاصيل إضافية أو اتفاق مع العميل"></textarea></div>
                            <div class="reservation-total"><span>إجمالي الحجز</span><strong id="reservationTotal">0.00 ج.م</strong></div>
                            <div class="reservation-form-actions"><button type="submit" class="primary-button" id="reservationSave">حفظ الحجز والعربون</button><div id="reservationMessage" class="reservation-message" aria-live="polite"></div></div>
                        </form>
                    </section>
                    <section class="reservation-card">
                        <div class="reservation-list-heading"><div class="reservation-card-heading"><span class="reservation-card-icon">▤</span><div><h3>الحجوزات المسجلة</h3><p>تابع حالة كل حجز والمبالغ المتبقية.</p></div></div><span class="reservation-count">${(reservationRows || []).length} حجز</span></div>
                        <div class="reservation-table-wrap"><table class="reservation-table">
                            <thead><tr><th>رقم الحجز / التاريخ</th><th>العميل</th><th>الأصناف</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
                            <tbody>${rowsHtml || `<tr><td colspan="8"><div class="reservation-empty"><strong>لسه مفيش حجوزات</strong><span>أول حجز هتسجله هيظهر هنا.</span></div></td></tr>`}</tbody>
                        </table></div>
                    </section>
                </div>
            </div>
        `);

        const itemsContainer = page.querySelector("#reservationItems");
        const message = page.querySelector("#reservationMessage");
        const setMessage = (text, isError = false) => {
            message.textContent = text || "";
            message.className = "reservation-message" + (text ? (isError ? " product-form-message error" : " product-form-message") : "");
        };
        const getProductSearchText = (product) => [product.name, product.code, product.category_name, product.unit]
            .map((part) => String(part || "").toLocaleLowerCase("ar-EG"))
            .join(" ");
        const addItemRow = () => {
            const row = document.createElement("div");
            row.className = "reservation-item-row";
            row.innerHTML = `
                <div class="reservation-product-picker reservation-item-product">
                    <label>الصنف</label>
                    <span class="reservation-search-icon" aria-hidden="true">⌕</span>
                    <input data-search type="text" class="reservation-picker-input" autocomplete="off" placeholder="ابحث عن اسم المنتج أو الكود..." aria-label="البحث عن صنف" required>
                    <input data-product-id-field type="hidden">
                    <div class="reservation-product-dropdown" data-dropdown role="listbox" hidden></div>
                    <small data-selected-meta class="reservation-selected-meta" hidden></small>
                </div>
                <div class="reservation-mini-field" data-field="quantity"><label>الكمية</label><input data-quantity type="number" min="0.01" step="0.01" value="1" required aria-label="الكمية"></div>
                <div class="reservation-mini-field" data-field="price"><label>سعر الوحدة</label><input data-price type="number" min="0" step="0.01" placeholder="0.00" required aria-label="سعر الوحدة"></div>
                <button type="button" class="reservation-remove-button" data-remove aria-label="حذف الصنف" title="حذف الصنف">×</button>
            `;
            itemsContainer.appendChild(row);
            const search = row.querySelector("[data-search]");
            const dropdown = row.querySelector("[data-dropdown]");
            const hiddenProductId = row.querySelector("[data-product-id-field]");
            const priceInput = row.querySelector("[data-price]");
            const meta = row.querySelector("[data-selected-meta]");
            let activeIndex = 0;
            let currentMatches = [];

            const chooseProduct = (product) => {
                hiddenProductId.value = String(product.id);
                search.value = product.name;
                priceInput.value = String(Number(product.sale_price || 0));
                meta.textContent = `السعر الحالي: ${money(product.sale_price)} ج.م | الوحدة: ${product.unit || "قطعة"}${product.category_name ? ` | ${product.category_name}` : ""}`; meta.hidden = false;
                dropdown.hidden = true;
                recalculate();
            };
            const renderMatches = () => {
                const query = search.value.trim().toLocaleLowerCase("ar-EG");
                const terms = query.split(/\s+/).filter(Boolean);
                currentMatches = products.filter((product) => {
                    const haystack = getProductSearchText(product);
                    return terms.every((term) => haystack.includes(term));
                }).slice(0, 9);
                activeIndex = 0;
                if (!currentMatches.length) {
                    dropdown.innerHTML = `<div class="reservation-no-match">لا توجد أصناف مطابقة للبحث</div>`;
                    dropdown.hidden = false;
                    return;
                }
                dropdown.innerHTML = currentMatches.map((product, index) => {
                    const physical = Number(stockByProduct.get(product.id) || 0);
                    const details = [product.code, product.category_name, product.unit ? `الوحدة: ${product.unit}` : "", `الرصيد الفعلي: ${money(physical)}`].filter(Boolean).join(" · ");
                    return `<button type="button" class="reservation-suggestion${index === activeIndex ? " reservation-suggestion-active" : ""}" role="option" aria-selected="${index === activeIndex}" data-select-product="${product.id}"><span class="reservation-suggestion-main"><strong>${escape(product.name)}</strong><small>${escape(details)}</small></span><span class="reservation-suggestion-price">${money(product.sale_price)} ج.م</span></button>`;
                }).join("");
                dropdown.hidden = false;
            };

            search.addEventListener("focus", renderMatches);
            search.addEventListener("input", () => {
                hiddenProductId.value = "";
                priceInput.value = "";
                meta.textContent = ""; meta.hidden = true;
                recalculate();
                renderMatches();
            });
            search.addEventListener("keydown", (event) => {
                if (event.key === "Escape") {
                    dropdown.hidden = true;
                    return;
                }
                if (dropdown.hidden || !currentMatches.length) return;
                if (event.key === "ArrowDown") {
                    event.preventDefault();
                    activeIndex = (activeIndex + 1) % currentMatches.length;
                    renderDropdownActive();
                } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length;
                    renderDropdownActive();
                } else if (event.key === "Enter") {
                    event.preventDefault();
                    chooseProduct(currentMatches[activeIndex] || currentMatches[0]);
                }
            });
            const renderDropdownActive = () => {
                dropdown.querySelectorAll("[data-select-product]").forEach((button, index) => {
                    button.classList.toggle("reservation-suggestion-active", index === activeIndex);
                    button.setAttribute("aria-selected", index === activeIndex ? "true" : "false");
                });
            };
            row.addEventListener("click", (event) => {
                const choice = event.target.closest("[data-select-product]");
                if (!choice) return;
                const chosen = products.find((product) => Number(product.id) === Number(choice.dataset.selectProduct));
                if (chosen) chooseProduct(chosen);
            });
            row.addEventListener("focusout", (event) => {
                if (!row.contains(event.relatedTarget)) {
                    window.setTimeout(() => { dropdown.hidden = true; }, 120);
                }
            });
        };
        const recalculate = () => {
            let total = 0;
            for (const row of itemsContainer.querySelectorAll(".reservation-item-row")) {
                total += Math.max(0, Number(row.querySelector("[data-quantity]").value || 0)) *
                    Math.max(0, Number(row.querySelector("[data-price]").value || 0));
            }
            page.querySelector("#reservationTotal").textContent = money(total) + " ج.م";
        };
        itemsContainer.addEventListener("input", recalculate);
        itemsContainer.addEventListener("change", recalculate);
        itemsContainer.addEventListener("click", (event) => {
            const removeButton = event.target.closest("[data-remove]");
            if (!removeButton) return;
            const row = removeButton.closest(".reservation-item-row");
            if (itemsContainer.querySelectorAll(".reservation-item-row").length > 1) {
                row.remove();
            } else {
                row.querySelector("[data-search]").value = "";
                row.querySelector("[data-product-id-field]").value = "";
                row.querySelector("[data-quantity]").value = "1";
                row.querySelector("[data-price]").value = "";
                row.querySelector("[data-selected-meta]").textContent = "اختار صنفًا من نتائج البحث ليتم تعبئة السعر الحالي.";
                row.querySelector("[data-dropdown]").hidden = true;
            }
            recalculate();
        });
        addItemRow();
        recalculate();
        page.querySelector("#reservationAddItem").addEventListener("click", () => {
            addItemRow();
            const rows = itemsContainer.querySelectorAll(".reservation-item-row");
            rows[rows.length - 1]?.querySelector("[data-search]")?.focus();
        });
        page.querySelector("#reservationForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            const button = page.querySelector("#reservationSave");
            const rowEls = Array.from(itemsContainer.querySelectorAll(".reservation-item-row"));
            const payloadItems = rowEls.map((row) => ({
                product_id: Number(row.querySelector("[data-product-id-field]").value),
                quantity: Number(row.querySelector("[data-quantity]").value),
                unit_price: Number(row.querySelector("[data-price]").value)
            }));
            if (payloadItems.some((item) => !item.product_id || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0)) {
                setMessage("اختار صنفًا من نتائج البحث، وراجع الكمية والسعر في كل سطر.", true);
                const invalidRow = rowEls.find((row) => !Number(row.querySelector("[data-product-id-field]").value));
                invalidRow?.querySelector("[data-search]")?.focus();
                return;
            }
            const deposit = Number(page.querySelector("#reservationDeposit").value || 0);
            if (!Number.isFinite(deposit) || deposit < 0) {
                setMessage("أدخل قيمة عربون صحيحة.", true);
                return;
            }
            button.disabled = true;
            setMessage("جارٍ حفظ الحجز...");
            try {
                const result = await window.elSharq.createReservation({
                    customer_name: page.querySelector("#reservationCustomer").value.trim(),
                    customer_phone: page.querySelector("#reservationPhone").value.trim(),
                    due_date: page.querySelector("#reservationDueDate").value,
                    notes: page.querySelector("#reservationNotes").value.trim(),
                    deposit,
                    items: payloadItems
                });
                window.alert(`تم حفظ الحجز ${result.reservationNumber}\nالإجمالي: ${money(result.totalAmount)} ج.م\nالمتبقي: ${money(result.remainingAmount)} ج.م`);
                await reservations();
            } catch (error) {
                setMessage(error?.message || "تعذر حفظ الحجز", true);
            } finally {
                button.disabled = false;
            }
        });
        const requestReservationDeliveryAmount = (row) => new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.setAttribute("data-reservation-delivery-dialog", "true");
            overlay.style.cssText = "position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:18px;background:rgba(3,10,16,.78);";
            overlay.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="reservationDeliveryTitle" style="width:min(460px,100%);padding:22px;border:1px solid #3a5264;border-radius:16px;background:#17232d;color:#e8f0f6;box-shadow:0 22px 70px rgba(0,0,0,.5);direction:rtl;">
                <h3 id="reservationDeliveryTitle" style="margin:0 0 8px;font-size:17px;">تسليم الحجز وتحويله لفاتورة</h3>
                <p style="margin:0 0 14px;color:#b6c5d0;line-height:1.8;font-size:13px;">الحجز ${escape(row.reservation_number)} — المتبقي ${money(row.remaining_amount)} ج.م</p>
                <p style="margin:0 0 14px;color:#9eb0bd;line-height:1.8;font-size:12px;">اكتب المبلغ الذي ستقبضه الآن. اكتب 0 إذا كان الباقي آجلًا. عند التأكيد ستُنشأ الفاتورة وتُخصم الكمية من المخزون، مع ربط العربون والمدفوعات السابقة دون تسجيلها مرة أخرى في الخزنة.</p>
                <form data-reservation-delivery-form>
                    <label for="reservationDeliveryAmount" style="display:block;margin-bottom:7px;font-size:12px;color:#c3d0da;">مبلغ التحصيل الآن (ج.م)</label>
                    <input id="reservationDeliveryAmount" type="number" min="0" max="${Number(row.remaining_amount || 0)}" step="0.01" value="${Number(row.remaining_amount || 0)}" required style="box-sizing:border-box;width:100%;min-height:44px;padding:10px 12px;border:1px solid #405462;border-radius:9px;background:#101a24;color:#eef4f8;font-size:16px;">
                    <div data-delivery-error role="alert" style="min-height:0;margin-top:8px;color:#ff9b9b;font-size:12px;"></div>
                    <div style="display:flex;gap:9px;margin-top:16px;">
                        <button type="submit" class="primary-button" style="flex:1;">تأكيد التسليم وإنشاء الفاتورة</button>
                        <button type="button" data-cancel-delivery class="secondary-button">إلغاء</button>
                    </div>
                </form>
            </section>`;
            const close = (amount) => {
                document.removeEventListener("keydown", onKeyDown, true);
                overlay.remove();
                resolve(amount);
            };
            const onKeyDown = (event) => { if (event.key === "Escape") close(null); };
            overlay.addEventListener("click", (event) => { if (event.target === overlay) close(null); });
            overlay.querySelector("[data-cancel-delivery]").addEventListener("click", () => close(null));
            overlay.querySelector("[data-reservation-delivery-form]").addEventListener("submit", (event) => {
                event.preventDefault();
                const input = overlay.querySelector("#reservationDeliveryAmount");
                const error = overlay.querySelector("[data-delivery-error]");
                const raw = input.value.trim();
                const amount = Number(raw);
                if (!raw || !Number.isFinite(amount) || amount < 0) {
                    error.textContent = "أدخل مبلغًا صحيحًا، أو اكتب 0 إذا كان الباقي آجلًا.";
                    input.focus();
                    return;
                }
                if (amount > Number(row.remaining_amount || 0) + 0.000001) {
                    error.textContent = "مبلغ التحصيل أكبر من المتبقي على الحجز.";
                    input.focus();
                    return;
                }
                close(amount);
            });
            document.addEventListener("keydown", onKeyDown, true);
            document.body.appendChild(overlay);
            overlay.querySelector("#reservationDeliveryAmount").focus();
            overlay.querySelector("#reservationDeliveryAmount").select();
        });

        const requestReservationPaymentAmount = (row) => new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.setAttribute("data-reservation-payment-dialog", "true");
            overlay.style.cssText = "position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:18px;background:rgba(3,10,16,.78);";
            overlay.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="reservationPaymentTitle" style="width:min(430px,100%);padding:22px;border:1px solid #3a5264;border-radius:16px;background:#17232d;color:#e8f0f6;box-shadow:0 22px 70px rgba(0,0,0,.5);direction:rtl;">
                <h3 id="reservationPaymentTitle" style="margin:0 0 8px;font-size:17px;">تحصيل دفعة من الحجز</h3>
                <p style="margin:0 0 14px;color:#b6c5d0;line-height:1.8;font-size:13px;">${escape(row.reservation_number)} — المتبقي ${money(row.remaining_amount)} ج.م</p>
                <form data-reservation-payment-form><label for="reservationPaymentAmount" style="display:block;margin-bottom:7px;font-size:12px;color:#c3d0da;">مبلغ التحصيل (ج.م)</label>
                    <input id="reservationPaymentAmount" type="number" min="0.01" max="${Number(row.remaining_amount || 0)}" step="0.01" value="${Number(row.remaining_amount || 0)}" required style="box-sizing:border-box;width:100%;min-height:44px;padding:10px 12px;border:1px solid #405462;border-radius:9px;background:#101a24;color:#eef4f8;font-size:16px;">
                    <div data-payment-error role="alert" style="min-height:0;margin-top:8px;color:#ff9b9b;font-size:12px;"></div>
                    <div style="display:flex;gap:9px;margin-top:16px;"><button type="submit" class="primary-button" style="flex:1;">تسجيل التحصيل</button><button type="button" data-cancel-payment class="secondary-button">إلغاء</button></div>
                </form></section>`;
            const finish = (value) => { document.removeEventListener("keydown", onKeyDown, true); overlay.remove(); resolve(value); };
            const onKeyDown = (event) => { if (event.key === "Escape") finish(null); };
            overlay.addEventListener("click", (event) => { if (event.target === overlay) finish(null); });
            overlay.querySelector("[data-cancel-payment]").addEventListener("click", () => finish(null));
            overlay.querySelector("[data-reservation-payment-form]").addEventListener("submit", (event) => {
                event.preventDefault();
                const input = overlay.querySelector("#reservationPaymentAmount");
                const amount = Number(input.value);
                const error = overlay.querySelector("[data-payment-error]");
                if (!Number.isFinite(amount) || amount <= 0) { error.textContent = "أدخل مبلغًا أكبر من صفر."; input.focus(); return; }
                if (amount > Number(row.remaining_amount || 0) + 0.000001) { error.textContent = "الدفعة أكبر من المتبقي على الحجز."; input.focus(); return; }
                finish(amount);
            });
            document.addEventListener("keydown", onKeyDown, true);
            document.body.appendChild(overlay);
            overlay.querySelector("#reservationPaymentAmount").focus();
            overlay.querySelector("#reservationPaymentAmount").select();
        });

        const requestReservationEdit = (reservation) => new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.setAttribute("data-reservation-edit-dialog", "true");
            overlay.style.cssText = "position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:18px;background:rgba(3,10,16,.78);";
            const productOptions = (item) => {
                const selectedId = Number(item?.product_id || 0);
                const options = products.map((product) => `<option value="${product.id}" ${Number(product.id) === selectedId ? "selected" : ""}>${escape(product.name)}${product.code ? ` — ${escape(product.code)}` : ""}</option>`);
                if (item && selectedId && !products.some((product) => Number(product.id) === selectedId)) {
                    options.unshift(`<option value="${selectedId}" selected>${escape(item.product_name || "صنف غير نشط")}${item.product_code ? ` — ${escape(item.product_code)}` : ""}</option>`);
                }
                return `<option value="">اختر الصنف</option>${options.join("")}`;
            };
            overlay.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="reservationEditTitle" style="width:min(900px,100%);max-height:92vh;overflow:auto;padding:22px;border:1px solid #3a5264;border-radius:16px;background:#17232d;color:#e8f0f6;box-shadow:0 22px 70px rgba(0,0,0,.5);direction:rtl;">
                <h3 id="reservationEditTitle" style="margin:0 0 7px;font-size:18px;">تعديل الحجز ${escape(reservation.reservation_number)}</h3>
                <p style="margin:0 0 14px;color:#9eb0bd;line-height:1.8;font-size:12px;">أسعار الأصناف الموجودة تظل كما كانت عند تسجيلها. أي صنف تضيفه أو تستبدله يأخذ سعر البيع الحالي. إذا أصبح الإجمالي أقل من المدفوع، يسجل النظام رد الفرق نقدًا من الخزنة.</p>
                <form data-reservation-edit-form>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:16px;">
                        <label style="font-size:12px;color:#c3d0da;">اسم العميل<input data-edit-customer required maxlength="160" value="${escape(reservation.customer_name || "")}" style="display:block;box-sizing:border-box;width:100%;min-height:40px;margin-top:6px;padding:9px;border:1px solid #405462;border-radius:8px;background:#101a24;color:#eef4f8;"></label>
                        <label style="font-size:12px;color:#c3d0da;">رقم الهاتف<input data-edit-phone maxlength="40" value="${escape(reservation.customer_phone || "")}" style="display:block;box-sizing:border-box;width:100%;min-height:40px;margin-top:6px;padding:9px;border:1px solid #405462;border-radius:8px;background:#101a24;color:#eef4f8;"></label>
                        <label style="font-size:12px;color:#c3d0da;">موعد الاستلام<input data-edit-due type="date" value="${escape(reservation.due_date || "")}" style="display:block;box-sizing:border-box;width:100%;min-height:40px;margin-top:6px;padding:9px;border:1px solid #405462;border-radius:8px;background:#101a24;color:#eef4f8;"></label>
                    </div>
                    <div data-edit-items style="display:grid;gap:8px;"></div>
                    <button type="button" data-add-edit-item class="secondary-button" style="margin-top:10px;">＋ إضافة صنف</button>
                    <label style="display:block;margin-top:14px;font-size:12px;color:#c3d0da;">ملاحظات<textarea data-edit-notes rows="2" style="display:block;box-sizing:border-box;width:100%;margin-top:6px;padding:9px;border:1px solid #405462;border-radius:8px;background:#101a24;color:#eef4f8;">${escape(reservation.notes || "")}</textarea></label>
                    <div style="display:flex;justify-content:space-between;gap:10px;margin-top:14px;padding:12px;border:1px solid rgba(84,227,189,.2);border-radius:10px;color:#bcefe2;"><span>الإجمالي الجديد</span><strong data-edit-total></strong></div>
                    <div data-edit-error role="alert" style="margin-top:8px;color:#ff9b9b;font-size:12px;"></div>
                    <div style="display:flex;gap:9px;margin-top:14px;"><button type="submit" data-save-edit class="primary-button" style="flex:1;">حفظ التعديل</button><button type="button" data-cancel-edit class="secondary-button">إلغاء</button></div>
                </form></section>`;
            const itemsHost = overlay.querySelector("[data-edit-items]");
            const finish = (value) => { document.removeEventListener("keydown", onKeyDown, true); overlay.remove(); resolve(value); };
            const onKeyDown = (event) => { if (event.key === "Escape") finish(null); };
            const recalculate = () => {
                const total = Array.from(itemsHost.querySelectorAll("[data-edit-line]")).reduce((sum, line) => sum + Number(line.querySelector("[data-edit-qty]").value || 0) * Number(line.querySelector("[data-edit-price]").value || 0), 0);
                overlay.querySelector("[data-edit-total]").textContent = `${money(total)} ج.م`;
            };
            const addLine = (item = null) => {
                const line = document.createElement("div");
                line.setAttribute("data-edit-line", "true");
                if (item) line.dataset.existingItemId = String(item.id);
                line.style.cssText = "display:grid;grid-template-columns:minmax(220px,1fr) 110px 140px 38px;gap:8px;align-items:end;padding:9px;border:1px solid #334656;border-radius:10px;background:#111c26;";
                line.innerHTML = `<label style="font-size:11px;color:#aebfcd;">الصنف<select data-edit-product required style="display:block;box-sizing:border-box;width:100%;min-height:39px;margin-top:5px;padding:7px;border:1px solid #405462;border-radius:8px;background:#101a24;color:#eef4f8;">${productOptions(item)}</select></label>
                    <label style="font-size:11px;color:#aebfcd;">الكمية<input data-edit-qty type="number" min="0.01" step="0.01" required value="${item ? Number(item.quantity) : 1}" style="display:block;box-sizing:border-box;width:100%;min-height:39px;margin-top:5px;padding:7px;border:1px solid #405462;border-radius:8px;background:#101a24;color:#eef4f8;"></label>
                    <label style="font-size:11px;color:#aebfcd;">سعر الوحدة<input data-edit-price type="number" min="0" step="0.01" readonly value="${item ? Number(item.unit_price) : ""}" placeholder="يُحدد تلقائيًا" style="display:block;box-sizing:border-box;width:100%;min-height:39px;margin-top:5px;padding:7px;border:1px solid #405462;border-radius:8px;background:#14252c;color:#bcefe2;"></label>
                    <button type="button" data-remove-edit-line aria-label="حذف الصنف" title="حذف الصنف" class="secondary-button" style="min-width:38px;height:39px;color:#ff9b9b;">×</button>`;
                itemsHost.appendChild(line);
                line.querySelector("[data-edit-product]").addEventListener("change", (event) => {
                    const selected = products.find((product) => Number(product.id) === Number(event.target.value));
                    delete line.dataset.existingItemId;
                    line.querySelector("[data-edit-price]").value = selected ? String(Number(selected.sale_price || 0)) : "";
                    recalculate();
                });
                line.querySelector("[data-edit-qty]").addEventListener("input", recalculate);
                line.querySelector("[data-remove-edit-line]").addEventListener("click", () => { line.remove(); recalculate(); });
            };
            (reservation.items || []).forEach((item) => addLine(item));
            if (!(reservation.items || []).length) addLine();
            overlay.querySelector("[data-add-edit-item]").addEventListener("click", () => addLine());
            overlay.querySelector("[data-cancel-edit]").addEventListener("click", () => finish(null));
            overlay.addEventListener("click", (event) => { if (event.target === overlay) finish(null); });
            overlay.querySelector("[data-reservation-edit-form]").addEventListener("submit", (event) => {
                event.preventDefault();
                const lines = Array.from(itemsHost.querySelectorAll("[data-edit-line]"));
                const items = lines.map((line) => ({
                    existing_item_id: line.dataset.existingItemId ? Number(line.dataset.existingItemId) : null,
                    product_id: Number(line.querySelector("[data-edit-product]").value),
                    quantity: Number(line.querySelector("[data-edit-qty]").value)
                }));
                if (!items.length || items.some((item) => !item.product_id || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
                    overlay.querySelector("[data-edit-error]").textContent = "راجع الصنف والكمية في كل سطر.";
                    return;
                }
                const save = overlay.querySelector("[data-save-edit]");
                save.disabled = true;
                resolve({
                    customer_name: overlay.querySelector("[data-edit-customer]").value.trim(),
                    customer_phone: overlay.querySelector("[data-edit-phone]").value.trim(),
                    due_date: overlay.querySelector("[data-edit-due]").value,
                    notes: overlay.querySelector("[data-edit-notes]").value.trim(),
                    items
                });
                document.removeEventListener("keydown", onKeyDown, true);
                overlay.remove();
            });
            document.addEventListener("keydown", onKeyDown, true);
            document.body.appendChild(overlay);
            recalculate();
        });

        const showReservationDocument = async (reservationRow) => {
            let printWindow;
            try {
                printWindow = window.elSharqInvoicePrint.open();
                const reservation = await window.elSharq.getReservationById(reservationRow.id);
                if (!reservation) throw new Error("الحجز غير موجود");
                const settings = await window.elSharq.getSettings().catch(() => ({}));
                if (reservation.status === "completed" && reservation.sale_id) {
                    const sale = await window.elSharq.getSaleById(reservation.sale_id);
                    if (!sale) throw new Error("فاتورة التسليم غير موجودة");
                    window.elSharqInvoicePrint.print(printWindow, {
                        ...sale, store_name: settings.store_name, store_phone: settings.store_phone,
                        store_address: settings.store_address, store_owner_name: settings.store_owner_name,
                        type: sale.sale_type === "plumbing_order" ? "plumbing_order" : "sale",
                        partyName: sale.customer_name || reservation.customer_name,
                        items: (sale.items || []).map((item) => ({
                            ...item, displayQuantity: Number(item.display_quantity ?? item.quantity ?? 0),
                            displayUnit: item.display_unit || item.product_unit || item.unit || "قطعة",
                            unitPrice: Number(item.display_unit_price ?? item.unit_price ?? 0),
                            total: Number(item.total ?? item.total_amount ?? 0)
                        }))
                    }, { autoPrint: false });
                } else {
                    window.elSharqInvoicePrint.print(printWindow, {
                        type: "reservation", invoice_number: reservation.reservation_number,
                        created_at: reservation.created_at, store_name: settings.store_name,
                        store_phone: settings.store_phone, store_address: settings.store_address,
                        store_owner_name: settings.store_owner_name,
                        partyName: reservation.customer_name, customer_phone: reservation.customer_phone,
                        subtotal: reservation.subtotal, total: reservation.total_amount,
                        paid: reservation.paid_amount, remaining: reservation.remaining_amount,
                        notes: [reservation.notes, reservation.status === "cancelled" ? "حجز ملغي" : "حجز قيد الانتظار"].filter(Boolean).join(" | "),
                        items: (reservation.items || []).map((item) => ({
                            product_name: item.product_name, displayQuantity: Number(item.quantity),
                            displayUnit: item.product_unit || "قطعة", unitPrice: Number(item.unit_price),
                            total: Number(item.total_amount)
                        }))
                    }, { autoPrint: false });
                }
            } catch (error) {
                if (printWindow && !printWindow.closed) printWindow.close();
                throw error;
            }
        };

        // reservation-actions-direct-binding-v1
        // Bind each rendered button directly so actions do not depend on table event delegation.
        const reservationActionButtons = page.querySelectorAll("[data-res-action][data-id]");
        reservationActionButtons.forEach((actionButton) => {
            actionButton.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (actionButton.disabled) return;

                const action = String(actionButton.dataset.resAction || "");
                const id = Number(actionButton.dataset.id);
                const row = (reservationRows || []).find((item) => Number(item.id) === id);
                if (!Number.isInteger(id) || id <= 0 || !row) {
                    window.alert("تعذر تحديد الحجز. حدّث صفحة الحجوزات وحاول مرة أخرى.");
                    return;
                }
                if (action === "view") {
                    try { await showReservationDocument(row); }
                    catch (error) { window.alert(error?.message || "تعذر عرض الحجز أو الفاتورة."); }
                    return;
                }
                if (row.status !== "pending") {
                    window.alert("هذا الحجز لم يعد قيد الانتظار. سيتم تحديث القائمة.");
                    await reservations();
                    return;
                }
                if (action === "edit") {
                    actionButton.disabled = true;
                    const editButtonText = actionButton.textContent;
                    actionButton.textContent = "جارٍ حفظ التعديل...";
                    try {
                        const detail = await window.elSharq.getReservationById(id);
                        if (!detail) throw new Error("الحجز غير موجود");
                        const payload = await requestReservationEdit(detail);
                        if (!payload) return;
                        const result = await window.elSharq.updateReservation(id, payload);
                        window.alert(result.refundedAmount > 0
                            ? `تم تعديل الحجز. تم رد ${money(result.refundedAmount)} ج.م نقدًا من الخزنة.\nالإجمالي الجديد: ${money(result.totalAmount)} ج.م`
                            : `تم تعديل الحجز بنجاح.\nالإجمالي الجديد: ${money(result.totalAmount)} ج.م\nالمتبقي: ${money(result.remainingAmount)} ج.م`);
                        await reservations();
                    } catch (error) {
                        window.alert(`تعذر تعديل الحجز: ${error?.message || "خطأ غير معروف"}`);
                        try { await reservations(); } catch (refreshError) { console.error("Reservation refresh failed:", refreshError); }
                    } finally {
                        actionButton.disabled = false;
                        actionButton.textContent = editButtonText;
                    }
                    return;
                }

                const apiByAction = {
                    payment: window.elSharq.addReservationPayment,
                    deliver: window.elSharq.deliverReservation,
                    cancel: window.elSharq.cancelReservation
                };
                if (!Object.prototype.hasOwnProperty.call(apiByAction, action) || typeof apiByAction[action] !== "function") {
                    window.alert("وظيفة هذا الإجراء غير متاحة في نسخة البرنامج الحالية. لم يتم تعديل أي حساب أو مخزون.");
                    return;
                }

                actionButton.disabled = true;
                const originalText = actionButton.textContent;
                actionButton.textContent = "جارٍ التنفيذ...";
                try {
                    if (action === "payment") {
                        const amount = await requestReservationPaymentAmount(row);
                        if (amount === null) return;
                        const result = await window.elSharq.addReservationPayment(id, amount);
                        window.alert(`تم تسجيل الدفعة في الخزنة الرئيسية.\nإجمالي المدفوع: ${money(result.paidAmount)} ج.م\nالمتبقي: ${money(result.remainingAmount)} ج.م`);
                    } else if (action === "deliver") {
                        const amount = await requestReservationDeliveryAmount(row);
                        if (amount === null) return;
                        const result = await window.elSharq.deliverReservation(id, amount);
                        window.alert(`تم تسليم الحجز بنجاح.\nرقم الفاتورة: ${result.invoiceNumber}\nالإجمالي: ${money(result.totalAmount)} ج.م\nالمدفوع: ${money(result.paidAmount)} ج.م\nالمتبقي: ${money(result.remainingAmount)} ج.م`);
                    } else if (action === "cancel") {
                        const confirmed = window.confirm(
                            `إلغاء الحجز ${row.reservation_number}؟\nسيتم تحرير كمياته المحجوزة ورد المدفوع الفعلي إلى الخارج من الخزنة الرئيسية وتسجيل حركة الرد. لا يتم حذف سجل الحجز.`
                        );
                        if (!confirmed) return;
                        const result = await window.elSharq.cancelReservation(id);
                        window.alert(`تم إلغاء الحجز.\nالمبلغ المردود: ${money(result.refundedAmount)} ج.م\nتم تحرير الكميات المحجوزة.`);
                    }
                    await reservations();
                } catch (error) {
                    console.error("Reservation action failed:", action, id, error);
                    window.alert(`لم يتم إكمال العملية: ${error?.message || "خطأ غير معروف"}\nلم يتم تحديث الواجهة على أنها نجحت.`);
                    // Reload the current rows to show the actual database state after a rejected operation.
                    try { await reservations(); } catch (refreshError) { console.error("Reservation refresh failed:", refreshError); }
                } finally {
                    actionButton.disabled = false;
                    actionButton.textContent = originalText;
                }
            });
        });
    }

    // worker-payroll-ui-v1
    async function workers(selectedWorkerId = null, editWorkerId = null) {
        const workerRows = await window.elSharq.getWorkers();
        const selectedId = selectedWorkerId == null ? null : Number(selectedWorkerId);
        const editing = editWorkerId == null ? null : (workerRows || []).find((worker) => Number(worker.id) === Number(editWorkerId)) || null;
        let ledger = null;
        if (selectedId != null) ledger = await window.elSharq.getWorkerLedger(selectedId);
        const money = (value) => Number(value || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const dateText = (value) => {
            if (!value) return "-";
            const raw = String(value).slice(0, 10);
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
            return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
        };
        const escapeText = (value) => escape(String(value ?? ""));
        const todayForInput = (() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })();
        const activeRows = (workerRows || []).filter((worker) => Number(worker.is_active) === 1);
        const dueCyclesAll = (workerRows || []).reduce((sum, worker) => sum + Number(worker.due_cycle_count || 0), 0);
        const dueAmountAll = (workerRows || []).reduce((sum, worker) => sum + Number(worker.due_total || 0), 0);
        const workerTableRows = (workerRows || []).map((worker) => {
            const current = worker.current_cycle;
            const isActive = Number(worker.is_active) === 1;
            const currentAdvance = Number(current?.advances_total || 0);
            const expected = Number(current?.remaining_salary || 0);
            const payStatus = Number(worker.due_cycle_count || 0) > 0 ? `مستحق (${Number(worker.due_cycle_count)})` : (current ? `موعده ${dateText(current.due_date)}` : "لم تبدأ الدورة");
            return `<tr>
                <td><strong>${escapeText(worker.name)}</strong><br><small>${escapeText(worker.job_title || "بدون مسمى وظيفي")}</small><br><small style="color:#0284c7; font-weight:600;">بداية العمل: ${dateText(worker.start_date)}</small></td>
                <td>${escapeText(worker.phone || "-")}</td>
                <td>${money(worker.monthly_salary)} ج.م</td>
                <td>${money(currentAdvance)} ج.م</td>
                <td><strong>${money(expected)} ج.م</strong></td>
                <td>${payStatus}</td>
                <td><span class="worker-status ${isActive ? "is-active" : "is-inactive"}">${isActive ? "نشط" : "غير نشط"}</span></td>
                <td><div class="worker-actions"><button type="button" class="secondary-button" data-worker-action="view" data-id="${Number(worker.id)}">الحساب والنوتة</button><button type="button" class="secondary-button" data-worker-action="edit" data-id="${Number(worker.id)}">تعديل</button>${isActive ? `<button type="button" class="secondary-button" data-worker-action="stop" data-id="${Number(worker.id)}">إيقاف</button>` : ""}</div></td>
            </tr>`;
        }).join("");

        const currentWorker = ledger?.worker || null;
        const cycleRows = ledger ? (ledger.cycles || []).map((cycle) => {
            const isDue = String(cycle.due_date) <= todayForInput;
            const isPaid = cycle.status === "paid";
            const status = isPaid ? "مقفولة ومدفوعة" : (isDue ? "مستحق القبض" : "الدورة الحالية");
            const action = isPaid ? `<span class="worker-muted">تمت التصفية</span>` : (isDue
                ? `<button type="button" class="primary-button" data-worker-action="pay-cycle" data-id="${Number(cycle.id)}">صرف وتصفية ${money(cycle.remaining_salary)} ج.م</button>`
                : `<span class="worker-muted">يستحق ${dateText(cycle.due_date)}</span>`);
            return `<tr>
                <td>${dateText(cycle.period_start)} – ${dateText(cycle.period_end)}</td>
                <td>${money(cycle.salary_amount)} ج.م</td>
                <td>${money(cycle.advances_total)} ج.م</td>
                <td><strong>${money(cycle.remaining_salary)} ج.م</strong></td>
                <td>${dateText(cycle.due_date)}</td><td>${status}</td><td>${action}</td>
            </tr>`;
        }).join("") : "";
        const transactionRows = ledger ? (ledger.transactions || []).map((tx) => {
            const isAdvance = tx.transaction_type === "advance";
            return `<tr>
                <td>${dateText(tx.created_at)}<br><small>${escapeText(String(tx.created_at || "").slice(11, 16))}</small></td>
                <td>${isAdvance ? "سلفة / مصروف شخصي" : "صرف باقي المرتب"}</td>
                <td>${escapeText(tx.description || "-")}</td>
                <td>${dateText(tx.period_start)} – ${dateText(tx.period_end)}</td>
                <td><strong>${money(tx.amount)} ج.م</strong></td>
                <td>${escapeText(tx.cash_account_name || (Number(tx.amount) === 0 ? "بدون صرف نقدي" : "الخزنة الرئيسية"))}</td>
            </tr>`;
        }).join("") : "";

        const page = content("العمال والرواتب", "إضافة العمال وتسجيل السلف والمصاريف الشخصية وصرف المرتب الشهري من الخزنة", `
            <style>
                .worker-payroll-v1 .worker-form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:end}
                .worker-payroll-v1 .worker-actions{display:flex;flex-wrap:wrap;gap:6px;min-width:175px}
                .worker-payroll-v1 .worker-actions button,.worker-payroll-v1 .worker-cycle-action button{white-space:nowrap}
                .worker-payroll-v1 .worker-table-wrap{width:100%;overflow:auto}
                .worker-payroll-v1 .worker-table{width:100%;border-collapse:collapse;min-width:950px}
                .worker-payroll-v1 .worker-table th,.worker-payroll-v1 .worker-table td{padding:11px 10px;text-align:right;border-bottom:1px solid var(--border-color,#394150);vertical-align:middle}
                .worker-payroll-v1 .worker-table th{white-space:nowrap}
                .worker-payroll-v1 .worker-status{display:inline-block;padding:4px 8px;border-radius:12px;font-size:12px}
                .worker-payroll-v1 .worker-status.is-active{background:rgba(62,201,153,.13);color:#55d6ad}
                .worker-payroll-v1 .worker-status.is-inactive{background:rgba(220,120,120,.13);color:#e7a0a0}
                .worker-payroll-v1 .worker-muted{color:var(--muted-color,#a1a8b5);font-size:12px}
                .worker-payroll-v1 .worker-detail-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.7fr);gap:16px;align-items:start}
                .worker-payroll-v1 .worker-panel{min-width:0;margin-bottom:16px}
                .worker-payroll-v1 .worker-panel .panel-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
                .worker-payroll-v1 .worker-inline-message{margin-top:10px;min-height:20px}
                .worker-payroll-v1 .worker-inline-message.error{color:#f08a8a}
                .worker-payroll-v1 .worker-inline-message.success{color:#57d6af}
                .worker-payroll-v1 .worker-help{display:block;margin-top:7px;color:var(--muted-color,#a1a8b5);font-size:12px;line-height:1.7}
                .worker-payroll-v1 .worker-cycle-alert{border:1px solid rgba(232,174,77,.35);border-radius:12px;padding:12px;margin-bottom:12px;background:rgba(232,174,77,.07)}
                .worker-payroll-v1 .worker-empty{padding:20px;text-align:center;color:var(--muted-color,#a1a8b5)}
                .worker-payroll-v1 .worker-checkbox-row{display:flex;align-items:center;gap:8px;min-height:42px}
                .worker-payroll-v1 input,.worker-payroll-v1 textarea,.worker-payroll-v1 select{max-width:100%;box-sizing:border-box}
                @media(max-width:1000px){.worker-payroll-v1 .worker-form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.worker-payroll-v1 .worker-detail-grid{grid-template-columns:1fr}}
                @media(max-width:600px){.worker-payroll-v1 .worker-form-grid{grid-template-columns:1fr}}
            </style>
            <div class="worker-payroll-v1">
                <div class="stats-grid">
                    <div class="stat-card"><div class="stat-icon sales">ع</div><div><span>العمال النشطون</span><strong>${activeRows.length}</strong><small>من إجمالي ${Number((workerRows || []).length)} عامل</small></div></div>
                    <div class="stat-card"><div class="stat-icon cash">س</div><div><span>رواتب مستحقة للقبض</span><strong>${dueCyclesAll}</strong><small>دورات قبض وصلت لموعدها</small></div></div>
                    <div class="stat-card"><div class="stat-icon profit">ج</div><div><span>صافي مستحق حاليًا</span><strong>${money(dueAmountAll)} ج.م</strong><small>بعد خصم المسحوبات المسجلة</small></div></div>
                </div>
                ${editing ? `<div class="worker-cycle-alert">أنت تعدّل بيانات ${escapeText(editing.name)}. تغيير المرتب يسري على دورات القبض الجديدة فقط؛ الدورة الجارية تحتفظ بالمرتب المتفق عليه عند بدايتها.</div>` : ""}
                <section class="panel worker-panel">
                    <div class="panel-header"><div><h3>${editing ? "تعديل بيانات عامل" : "إضافة عامل جديد"}</h3><span>حدد المرتب وتاريخ بداية العمل لكل عامل</span></div>${editing ? `<button type="button" class="secondary-button" id="workerCancelEdit">إلغاء التعديل</button>` : ""}</div>
                    <form id="workerForm">
                        <div class="worker-form-grid">
                            <div class="form-field"><label for="workerName">اسم العامل *</label><input id="workerName" type="text" required maxlength="160" value="${escapeText(editing?.name || "")}" placeholder="اسم العامل"></div>
                            <div class="form-field"><label for="workerPhone">رقم الهاتف</label><input id="workerPhone" type="tel" maxlength="40" value="${escapeText(editing?.phone || "")}" placeholder="رقم الهاتف (اختياري)"></div>
                            <div class="form-field"><label for="workerJobTitle">الوظيفة</label><input id="workerJobTitle" type="text" maxlength="100" value="${escapeText(editing?.job_title || "")}" placeholder="عامل / سائق / فني"></div>
                            <div class="form-field"><label for="workerSalary">المرتب الشهري (ج.م) *</label><input id="workerSalary" type="number" min="0.01" step="0.01" required value="${editing ? money(editing.monthly_salary).replace(/,/g, "") : ""}" placeholder="مثال: 4000"></div>
                            <div class="form-field"><label for="workerStartDate">تاريخ بداية الشغل *</label><input id="workerStartDate" type="date" required value="${escapeText(editing?.start_date || todayForInput)}"></div>
                            ${editing ? `<div class="form-field"><label>حالة العامل</label><label class="worker-checkbox-row"><input id="workerIsActive" type="checkbox" ${Number(editing.is_active) === 1 ? "checked" : ""}> <span>العامل نشط ويستقبل سلفًا جديدة</span></label></div>` : `<div class="form-field"><span class="worker-help">دورة القبض تبدأ من يوم بداية العمل، وتتكرر شهريًا في نفس اليوم قدر الإمكان.</span></div>`}
                            <div class="form-field"><button class="primary-button" type="submit" id="workerSaveButton">${editing ? "حفظ التعديلات" : "+ إضافة العامل"}</button></div>
                        </div>
                        <div id="workerFormMessage" class="worker-inline-message" aria-live="polite"></div>
                    </form>
                </section>
                <section class="panel worker-panel">
                    <div class="panel-header"><div><h3>العمال المسجلون</h3><span>المسحوبات محسوبة على دورة كل عامل بصورة مستقلة</span></div></div>
                    <div class="worker-table-wrap"><table class="worker-table"><thead><tr><th>العامل / الوظيفة</th><th>الهاتف</th><th>المرتب الشهري</th><th>مسحوبات الدورة الحالية</th><th>باقي المرتب المتوقع</th><th>موعد القبض</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>${workerTableRows || `<tr><td colspan="8"><div class="worker-empty">لسه مفيش عمال مسجلين. أضف أول عامل من النموذج.</div></td></tr>`}</tbody></table></div>
                </section>
                ${currentWorker ? `
                    <section class="panel worker-panel">
                        <div class="panel-header"><div><h3>حساب ونوتة العامل: ${escapeText(currentWorker.name)}</h3><span>الدورة الحالية: ${dateText(ledger.cycles.find((cycle) => String(cycle.period_start) <= todayForInput && String(cycle.period_end) >= todayForInput)?.period_start || currentWorker.start_date)} – ${dateText(ledger.cycles.find((cycle) => String(cycle.period_start) <= todayForInput && String(cycle.period_end) >= todayForInput)?.period_end || "-")}</span></div><button type="button" class="secondary-button" id="workerCloseDetails">إخفاء التفاصيل</button></div>
                        ${(ledger.cycles || []).some((cycle) => cycle.status === "open" && String(cycle.due_date) <= todayForInput) ? `<div class="worker-cycle-alert">فيه دورة قبض أو أكثر وصلت لموعدها. راجع جدول دورات القبض تحت، وصرف المستحق بضغطة تأكيد.</div>` : ""}
                        <div class="worker-detail-grid">
                            <section class="panel worker-panel">
                                <div class="panel-header"><div><h3>تسجيل سلفة / مصروف شخصي</h3><span>سيُخصم المبلغ من الخزنة الرئيسية ويسجل في النوتة.</span></div></div>
                                <form id="workerAdvanceForm">
                                    <div class="form-field"><label for="workerAdvanceAmount">المبلغ (ج.م) *</label><input id="workerAdvanceAmount" type="number" min="0.01" step="0.01" required placeholder="المبلغ"></div>
                                    <div class="form-field"><label for="workerAdvanceNotes">البيان / النوتة *</label><textarea id="workerAdvanceNotes" rows="3" required maxlength="500" placeholder="مثال: سلفة شخصية أو مصاريف غداء"></textarea></div>
                                    <button type="submit" class="primary-button" ${Number(currentWorker.is_active) !== 1 ? "disabled" : ""}>تسجيل السحب من الخزنة</button>
                                    <div id="workerAdvanceMessage" class="worker-inline-message" aria-live="polite"></div>
                                    <span class="worker-help">لا يمكن تسجيل سحوبات تتجاوز باقي مرتب الدورة الحالية. كل عملية محفوظة بتاريخها ولا يمكن حذفها من الشاشة.</span>
                                </form>
                            </section>
                            <section class="panel worker-panel">
                                <div class="panel-header"><div><h3>دورات القبض الشهرية</h3><span>كل شهر محفوظ بأرقامه وحركاته حتى بعد التصفية.</span></div></div>
                                <div class="worker-table-wrap"><table class="worker-table"><thead><tr><th>الفترة</th><th>المرتب</th><th>المسحوبات</th><th>الصافي</th><th>موعد القبض</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${cycleRows || `<tr><td colspan="7">لا توجد دورات مسجلة.</td></tr>`}</tbody></table></div>
                            </section>
                        </div>
                        <section class="panel worker-panel">
                            <div class="panel-header"><div><h3>النوتة وسجل الحركات</h3><span>آخر الحركات المسجلة للعامل، مرتبة من الأحدث.</span></div></div>
                            <div class="worker-table-wrap"><table class="worker-table"><thead><tr><th>التاريخ والوقت</th><th>نوع الحركة</th><th>البيان</th><th>فترة المرتب</th><th>المبلغ</th><th>الحساب النقدي</th></tr></thead><tbody>${transactionRows || `<tr><td colspan="6"><div class="worker-empty">لا توجد سلف أو عمليات قبض مسجلة لهذا العامل حتى الآن.</div></td></tr>`}</tbody></table></div>
                        </section>
                    </section>
                ` : `<section class="panel worker-panel"><div class="worker-empty">اختار «الحساب والنوتة» بجانب أي عامل لعرض السلف ودورات القبض وسجل الخزنة.</div></section>`}
            </div>
        `);

        const form = page.querySelector("#workerForm");
        const formMessage = page.querySelector("#workerFormMessage");
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const button = page.querySelector("#workerSaveButton");
            button.disabled = true;
            formMessage.textContent = "";
            const payload = {
                name: page.querySelector("#workerName").value.trim(),
                phone: page.querySelector("#workerPhone").value.trim(),
                job_title: page.querySelector("#workerJobTitle").value.trim(),
                monthly_salary: Number(page.querySelector("#workerSalary").value),
                start_date: page.querySelector("#workerStartDate")?.value || (editing ? editing.start_date : ""),
                is_active: editing ? Boolean(page.querySelector("#workerIsActive")?.checked) : true
            };
            try {
                if (editing) {
                    await window.elSharq.updateWorker(Number(editing.id), payload);
                    window.alert("تم حفظ بيانات العامل. المرتب الجديد يسري على دورات القبض الجديدة.");
                    await workers(selectedId === Number(editing.id) ? selectedId : Number(editing.id));
                } else {
                    const result = await window.elSharq.createWorker(payload);
                    window.alert(`تمت إضافة العامل ${result.name} بنجاح.`);
                    await workers(result.id);
                }
            } catch (error) {
                formMessage.textContent = error?.message || "تعذر حفظ بيانات العامل";
                formMessage.className = "worker-inline-message error";
            } finally {
                button.disabled = false;
            }
        });
        page.querySelector("#workerCancelEdit")?.addEventListener("click", () => workers(selectedId));
        page.querySelector("#workerCloseDetails")?.addEventListener("click", () => workers());

        page.querySelectorAll("[data-worker-action][data-id]").forEach((button) => {
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                if (button.disabled) return;
                const action = String(button.dataset.workerAction || "");
                const id = Number(button.dataset.id);
                button.disabled = true;
                try {
                    if (action === "view") {
                        await workers(id);
                    } else if (action === "edit") {
                        await workers(selectedId, id);
                        page.querySelector("#workerName")?.focus();
                    } else if (action === "stop") {
                        const worker = (workerRows || []).find((entry) => Number(entry.id) === id);
                        if (!worker || Number(worker.is_active) !== 1) throw new Error("العامل غير نشط بالفعل؛ حدّث الشاشة وحاول مرة أخرى.");
                        if (!window.confirm(`تأكيد إيقاف العامل ${worker.name}؟\nسيُمنع تسجيل سلف جديدة له. ستظل بياناته ودوراته وسلفه ومرتباته السابقة محفوظة دون تغيير.`)) return;
                        await window.elSharq.stopWorker(id);
                        window.alert("تم إيقاف العامل مع الاحتفاظ بسجله وحركاته.");
                        await workers(selectedId === id ? id : null);
                    } else if (action === "pay-cycle") {
                        const cycle = (ledger?.cycles || []).find((entry) => Number(entry.id) === id);
                        if (!cycle) throw new Error("تعذر تحديد دورة المرتب. حدّث الصفحة وحاول مرة أخرى.");
                        if (cycle.status !== "open") throw new Error("هذه الدورة تمت تصفيتها بالفعل.");
                        const message = `تأكيد صرف باقي المرتب؟\nالعامل: ${currentWorker.name}\nالمرتب: ${money(cycle.salary_amount)} ج.م\nالمسحوبات: ${money(cycle.advances_total)} ج.م\nالمتبقي الذي سيخرج من الخزنة الرئيسية: ${money(cycle.remaining_salary)} ج.م\nالفترة: ${dateText(cycle.period_start)} إلى ${dateText(cycle.period_end)}`;
                        if (!window.confirm(message)) return;
                        const result = await window.elSharq.payWorkerSalaryCycle(id);
                        window.alert(`تمت تصفية دورة قبض ${result.workerName}.\nالمرتب: ${money(result.salaryAmount)} ج.م\nالمسحوبات: ${money(result.advancesTotal)} ج.م\nالمبلغ المصروف من الخزنة: ${money(result.payoutAmount)} ج.م`);
                        await workers(Number(currentWorker.id));
                    }
                } catch (error) {
                    window.alert(error?.message || "تعذر تنفيذ العملية");
                } finally {
                    button.disabled = false;
                }
            });
        });

        const advanceForm = page.querySelector("#workerAdvanceForm");
        advanceForm?.addEventListener("submit", async (event) => {
            event.preventDefault();
            const button = advanceForm.querySelector('[type="submit"]');
            const amount = Number(page.querySelector("#workerAdvanceAmount").value);
            const notes = page.querySelector("#workerAdvanceNotes").value.trim();
            const message = page.querySelector("#workerAdvanceMessage");
            if (!Number.isFinite(amount) || amount <= 0) { message.textContent = "اكتب مبلغًا أكبر من صفر."; message.className = "worker-inline-message error"; return; }
            if (!notes) { message.textContent = "اكتب بيان السحب في النوتة."; message.className = "worker-inline-message error"; return; }
            if (!window.confirm(`تأكيد تسجيل سحب ${money(amount)} ج.م من الخزنة الرئيسية للعامل ${currentWorker.name}؟`)) return;
            button.disabled = true;
            try {
                const result = await window.elSharq.addWorkerAdvance(Number(currentWorker.id), amount, notes);
                window.alert(`تم تسجيل السحب في النوتة والخزنة.\nالمتبقي من مرتب الدورة الحالية: ${money(result.remainingSalary)} ج.م`);
                await workers(Number(currentWorker.id));
            } catch (error) {
                message.textContent = error?.message || "تعذر تسجيل السحب";
                message.className = "worker-inline-message error";
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
                receivables,
                suppliers: () => contacts("suppliers"),
                cashier,
                expenses,
                quickTransactions,
                reservations,
                workers,
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


