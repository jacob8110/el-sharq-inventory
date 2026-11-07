const { verifyDeletionPassword } = require("./deletion");
const { isFinancePasswordConfigured, verifyFinancePassword, setSharedSecurityPassword } = require("./finance-auth");

const { PREFIX: invoiceGroupPrefix, resolveParentId, metadata: getInvoiceMetadata } = require("./invoice-consolidation");

function registerOperations(ipcMain, db) {
    const financeSessions = new Set();
    const financeNavigationHooks = new Set();
    const requireMainFrame = (event) => {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
            throw new Error("الطلب مرفوض خارج نافذة التطبيق الرئيسية");
        }
    };
    const requireFinanceSession = (event) => {
        requireMainFrame(event);
        if (!financeSessions.has(event.sender.id)) {
            throw new Error("الخزنة والتقارير مقفلة. أدخل كلمة المرور للمتابعة.");
        }
    };
    const requiredText = (value, label) => {
        if (typeof value !== "string" || !value.trim()) {
            throw new Error(`${label} مطلوب`);
        }
        return value.trim();
    };

    const finiteNumber = (value, label, { min = 0 } = {}) => {
        const number = Number(value);
        if (!Number.isFinite(number) || number < min) {
            throw new Error(`${label} غير صحيح`);
        }
        return number;
    };

    const getLocation = (id) => {
        const location = db.prepare(
            "SELECT id, name FROM locations WHERE id = ? AND is_active = 1"
        ).get(Number(id));
        if (!location) throw new Error("مكان التخزين غير موجود أو غير نشط");
        return location;
    };

    const ensureStockRow = db.prepare(`
        INSERT INTO stock (product_id, location_id, quantity)
        VALUES (?, ?, 0)
        ON CONFLICT(product_id, location_id) DO NOTHING
    `);

    const addStockMovement = db.prepare(`
        INSERT INTO stock_movements
            (product_id, location_id, movement_type, quantity, reference_type, reference_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    ipcMain.handle("purchases:getAll", (_event, filters = {}) => {
        const conditions = [];
        const parameters = [];
        if (filters.supplierId) {
            const supplierId = Number(filters.supplierId);
            if (!Number.isInteger(supplierId) || supplierId <= 0) {
                throw new Error("المورد المحدد غير صحيح");
            }
            conditions.push("pu.supplier_id = ?");
            parameters.push(supplierId);
        }
        const query = typeof filters.query === "string"
            ? filters.query.trim().replace(/\s+/gu, " ")
            : "";
        for (const term of query.split(" ").filter(Boolean)) {
            conditions.push(`(
                pu.invoice_number LIKE ? COLLATE NOCASE
                OR COALESCE(su.name, '') LIKE ? COLLATE NOCASE
                OR COALESCE(pu.notes, '') LIKE ? COLLATE NOCASE
            )`);
            const pattern = `%${term}%`;
            parameters.push(pattern, pattern, pattern);
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const limit = conditions.length ? "" : "LIMIT 200";
        return db.prepare(`
            SELECT pu.*, pu.total_amount AS total, pu.paid_amount AS paid,
                pu.remaining_amount AS remaining, su.name AS supplier_name
            FROM purchases pu
            LEFT JOIN suppliers su ON su.id = pu.supplier_id
            ${where}
            ORDER BY pu.id DESC
            ${limit}
        `).all(...parameters);
    });

    ipcMain.handle("purchases:getById", (_event, purchaseId) => {
        const id = Number(purchaseId);
        const purchase = db.prepare(`
            SELECT pu.*, pu.total_amount AS total, pu.paid_amount AS paid,
                pu.remaining_amount AS remaining, su.name AS supplier_name
            FROM purchases pu
            LEFT JOIN suppliers su ON su.id = pu.supplier_id
            WHERE pu.id = ?
        `).get(id);
        if (!purchase) throw new Error("فاتورة الشراء غير موجودة");
        purchase.items = db.prepare(`
            SELECT pi.product_id,
                COALESCE(pi.display_quantity, pi.quantity) AS quantity,
                COALESCE(pi.display_unit_cost, pi.unit_cost) AS unit_cost,
                COALESCE(pi.display_list_price, pi.list_price) AS list_price,
                pi.plumbing_discount_percent, pi.total_amount AS total,
                p.name, COALESCE(pi.display_unit, p.unit) AS unit,
                l.name AS location_name
            FROM purchase_items pi
            JOIN products p ON p.id = pi.product_id
            JOIN locations l ON l.id = pi.location_id
            WHERE pi.purchase_id = ?
            ORDER BY pi.id
        `).all(id);
        purchase.location_name = purchase.items[0]?.location_name || "-";
        return purchase;
    });

    ipcMain.handle("purchases:delete", (_event, purchaseId, password) => {
        verifyDeletionPassword(db, password);
        return db.transaction(() => {
            const id = Number(purchaseId);
            const purchase = db.prepare("SELECT * FROM purchases WHERE id = ?").get(id);
            if (!purchase) throw new Error("فاتورة الشراء غير موجودة");
            if (db.prepare("SELECT 1 FROM purchase_returns WHERE purchase_id = ? LIMIT 1").get(id)) {
                throw new Error("لا يمكن حذف الفاتورة لوجود مرتجع مرتبط بها");
            }

            const items = db.prepare(`
                SELECT product_id, location_id, SUM(quantity) AS quantity
                FROM purchase_items WHERE purchase_id = ?
                GROUP BY product_id, location_id
            `).all(id);
            for (const item of items) {
                const stock = db.prepare(`
                    SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?
                `).get(item.product_id, item.location_id);
                if (!stock || Number(stock.quantity) + 0.000001 < Number(item.quantity)) {
                    throw new Error("لا يمكن حذف فاتورة الشراء: المخزون الحالي أقل من كميتها");
                }
            }

            const productItems = db.prepare(`
                SELECT product_id, SUM(quantity) AS quantity,
                    SUM(quantity * unit_cost) AS cost,
                    MIN(previous_purchase_price) AS previous_purchase_price,
                    COUNT(previous_purchase_price) AS previous_cost_count,
                    MIN(previous_purchase_price_manual) AS previous_purchase_price_manual,
                    COUNT(previous_purchase_price_manual) AS previous_manual_count,
                    MIN(previous_sale_price) AS previous_sale_price,
                    COUNT(previous_sale_price) AS previous_sale_price_count,
                    MIN(COALESCE(previous_ceramic_purchase_price_per_sqm, -1)) AS previous_ceramic_purchase_price_per_sqm,
                    COUNT(previous_ceramic_purchase_price_per_sqm) AS previous_ceramic_price_count,
                    COUNT(*) AS item_count
                FROM purchase_items WHERE purchase_id = ?
                GROUP BY product_id
            `).all(id);
            for (const item of productItems) {
                const lastInvoiceMovement = db.prepare(`
                    SELECT MAX(id) AS id FROM stock_movements
                    WHERE product_id = ? AND reference_type = 'purchase' AND reference_id = ?
                `).get(item.product_id, id)?.id;
                if (!lastInvoiceMovement) {
                    throw new Error("لا يمكن التأكد من أثر فاتورة الشراء على المخزون؛ لم يتم حذفها");
                }
                if (db.prepare(`
                    SELECT 1 FROM stock_movements
                    WHERE product_id = ? AND id > ?
                    LIMIT 1
                `).get(item.product_id, lastInvoiceMovement)) {
                    throw new Error("لا يمكن حذف الفاتورة بأمان بعد وجود حركة لاحقة لأحد أصنافها");
                }
                const product = db.prepare(`
                    SELECT purchase_price, sale_price, updated_at FROM products WHERE id = ?
                `).get(item.product_id);
                if (product.updated_at > purchase.created_at) {
                    throw new Error("تم تعديل بيانات تكلفة أحد الأصناف بعد الفاتورة؛ لا يمكن عكس التكلفة بأمان");
                }
            }

            for (const item of items) {
                db.prepare(`
                    UPDATE stock SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE product_id = ? AND location_id = ?
                `).run(item.quantity, item.product_id, item.location_id);
                addStockMovement.run(
                    item.product_id,
                    item.location_id,
                    "adjustment",
                    -Number(item.quantity),
                    "purchase_delete",
                    id,
                    `حذف فاتورة الشراء ${purchase.invoice_number}`
                );
            }

            for (const item of productItems) {
                let previousCost = Number(item.previous_purchase_price || 0);
                let previousManual = item.previous_purchase_price_manual;
                if (Number(item.previous_cost_count) !== Number(item.item_count)) {
                    const currentStock = Number(db.prepare(`
                        SELECT COALESCE(SUM(quantity), 0) AS quantity FROM stock WHERE product_id = ?
                    `).get(item.product_id).quantity);
                    const previousStock = currentStock + Number(item.quantity);
                    previousCost = currentStock > 0
                        ? Math.max(0, (
                            Number(db.prepare("SELECT purchase_price FROM products WHERE id = ?")
                                .get(item.product_id).purchase_price) * previousStock - Number(item.cost)
                        ) / currentStock)
                        : 0;
                    previousManual = null;
                }
                if (Number(item.previous_manual_count) !== Number(item.item_count)) {
                    previousManual = null;
                }
                const previousSalePrice = Number(item.previous_sale_price_count) === Number(item.item_count)
                    ? Number(item.previous_sale_price)
                    : null;
                const restoreCeramicPrice = Number(item.previous_ceramic_price_count) === Number(item.item_count);
                const previousCeramicPrice = Number(item.previous_ceramic_purchase_price_per_sqm) < 0
                    ? null : Number(item.previous_ceramic_purchase_price_per_sqm);
                db.prepare(`
                    UPDATE products SET purchase_price = ?,
                        purchase_price_manual = COALESCE(?, purchase_price_manual),
                        sale_price = COALESCE(?, sale_price),
                        ceramic_purchase_price_per_sqm = CASE WHEN ? = 1 THEN ? ELSE ceramic_purchase_price_per_sqm END,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(previousCost, previousManual, previousSalePrice, restoreCeramicPrice ? 1 : 0, previousCeramicPrice, item.product_id);
            }

            db.prepare(`
                DELETE FROM supplier_transactions
                WHERE reference_type = 'purchase' AND reference_id = ?
            `).run(id);
            db.prepare(`
                DELETE FROM cash_transactions
                WHERE reference_type = 'purchase' AND reference_id = ?
            `).run(id);
            db.prepare("DELETE FROM purchases WHERE id = ?").run(id);
            return { success: true };
        })();
    });

    ipcMain.handle("purchases:create", (_event, purchase) => {
        if (!purchase || !Array.isArray(purchase.items) || purchase.items.length === 0) {
            throw new Error("أضف صنفًا واحدًا على الأقل للفاتورة");
        }
        return db.transaction(() => {
            const location = getLocation(purchase.location_id);
            if (purchase.supplier_name !== undefined && purchase.supplier_name !== null &&
                typeof purchase.supplier_name !== "string") {
                throw new Error("اسم المورد غير صحيح");
            }
            const supplierNameInput = purchase.supplier_name?.trim().replace(/\s+/gu, " ") || "";
            let supplierId = purchase.supplier_id ? Number(purchase.supplier_id) : null;
            if (supplierNameInput) {
                const existingSupplier = db.prepare(`
                    SELECT id, is_active FROM suppliers
                    WHERE name = ? COLLATE NOCASE
                    ORDER BY is_active DESC, id
                    LIMIT 1
                `).get(supplierNameInput);
                if (existingSupplier) {
                    supplierId = Number(existingSupplier.id);
                    if (!Number(existingSupplier.is_active)) {
                        db.prepare(`
                            UPDATE suppliers SET is_active = 1, updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        `).run(supplierId);
                    }
                } else {
                    const result = db.prepare(`
                        INSERT INTO suppliers (name, is_active) VALUES (?, 1)
                    `).run(supplierNameInput);
                    supplierId = Number(result.lastInsertRowid);
                }
            }
            if (supplierId && !db.prepare(
                "SELECT id FROM suppliers WHERE id = ? AND is_active = 1"
            ).get(supplierId)) {
                throw new Error("المورد غير موجود أو غير نشط");
            }

            const items = purchase.items.map((item) => {
                const productId = Number(item.product_id);
                const product = db.prepare(`
                    SELECT p.id, p.name, p.unit, p.tile_length_cm, p.tile_width_cm, p.tiles_per_carton,
                        p.purchase_price, p.purchase_price_manual, p.ceramic_purchase_price_per_sqm,
                        p.sale_price, p.company_discount_percent, c.name AS category_name
                    FROM products p
                    LEFT JOIN categories c ON c.id = p.category_id
                    WHERE p.id = ? AND p.is_active = 1
                `).get(productId);
                if (!product) throw new Error("أحد المنتجات غير موجود أو غير نشط");

                let quantity = finiteNumber(item.quantity, `كمية ${product.name}`, { min: Number.MIN_VALUE });
                const isPlumbing = String(product.category_name || "").trim() === "سباكة";
                const isCeramicMeter = item.pricing_mode === "ceramic_meter";
                let listPrice = null;
                let plumbingDiscountPercent = null;
                let unitCost;
                let salePrice = null;
                let displayQuantity = quantity;
                let displayUnit = String(item.unit || product.unit || "قطعة");
                let displayUnitCost = null;
                let displayListPrice = null;
                let cartonArea = null;

                if (isCeramicMeter) {
                    if (String(product.category_name || "").trim() !== "سيراميك") {
                        throw new Error(`إدخال السعر بالمتر المربع مخصص للسيراميك فقط: ${product.name}`);
                    }
                    const tileArea = (Number(product.tile_length_cm || 0) * Number(product.tile_width_cm || 0)) / 10000;
                    const tilesPerCarton = Number(product.tiles_per_carton || 0);
                    cartonArea = tileArea * tilesPerCarton;
                    if (!(tileArea > 0) || !(tilesPerCarton > 0) || !(cartonArea > 0)) {
                        throw new Error(`أكمل مقاس البلاطة وعدد البلاطات بالكرتونة للصنف ${product.name} قبل الشراء بالمتر المربع`);
                    }
                    displayUnit = "متر مربع";
                    displayUnitCost = finiteNumber(item.unit_cost, `سعر الجملة بالمتر المربع ${product.name}`);
                    displayListPrice = finiteNumber(item.sale_price, `سعر القطاعي بالمتر المربع ${product.name}`);
                    if (displayUnitCost <= 0 || displayListPrice <= 0) {
                        throw new Error(`سعرا الجملة والقطاعي بالمتر المربع للصنف ${product.name} يجب أن يكونا أكبر من صفر`);
                    }
                    listPrice = displayListPrice;
                    quantity = displayQuantity / cartonArea;
                    unitCost = displayUnitCost * cartonArea;
                    salePrice = displayListPrice * cartonArea;
                } else if (item.pricing_mode === "discount") {
                    listPrice = finiteNumber(item.list_price, `سعر الليستة للصنف ${product.name}`);
                    if (listPrice <= 0) throw new Error(`سعر الليستة للصنف ${product.name} يجب أن يكون أكبر من صفر`);
                    plumbingDiscountPercent = finiteNumber(item.discount_percent, `نسبة الخصم للصنف ${product.name}`);
                    if (plumbingDiscountPercent < 0 || plumbingDiscountPercent > 100) {
                        throw new Error(`نسبة الخصم للصنف ${product.name} يجب أن تكون بين 0 و100`);
                    }
                    unitCost = Math.round(listPrice * (1 - plumbingDiscountPercent / 100) * 100) / 100;
                    salePrice = finiteNumber(item.sale_price ?? listPrice, `سعر البيع ${product.name}`);
                    if (salePrice <= 0) throw new Error(`سعر البيع للصنف ${product.name} يجب أن يكون أكبر من صفر`);
                } else if (item.pricing_mode === "manual") {
                    unitCost = finiteNumber(item.unit_cost, `سعر شراء ${product.name}`);
                    if (unitCost <= 0) throw new Error(`سعر الشراء للصنف ${product.name} يجب أن يكون أكبر من صفر`);
                    salePrice = finiteNumber(item.sale_price, `سعر البيع ${product.name}`);
                    if (salePrice <= 0) throw new Error(`سعر البيع للصنف ${product.name} يجب أن يكون أكبر من صفر`);
                    listPrice = salePrice;
                } else if (isPlumbing) {
                    // Keep compatibility with invoices created by the previous plumbing-only form.
                    listPrice = finiteNumber(item.list_price ?? item.unit_cost, `سعر اللستة للصنف ${product.name}`);
                    if (listPrice <= 0) throw new Error(`سعر اللستة للصنف ${product.name} يجب أن يكون أكبر من صفر`);
                    plumbingDiscountPercent = finiteNumber(
                        item.plumbing_discount_percent ?? product.company_discount_percent ?? 0,
                        `نسبة خصم السباكة للصنف ${product.name}`
                    );
                    if (plumbingDiscountPercent < 0 || plumbingDiscountPercent > 100) {
                        throw new Error(`نسبة الخصم للصنف ${product.name} يجب أن تكون بين 0 و100`);
                    }
                    unitCost = Math.round(listPrice * (1 - plumbingDiscountPercent / 100) * 100) / 100;
                } else {
                    unitCost = finiteNumber(item.unit_cost, `سعر شراء ${product.name}`);
                    if (item.sale_price !== undefined && item.sale_price !== null && String(item.sale_price).trim() !== "") {
                        salePrice = finiteNumber(item.sale_price, `سعر بيع ${product.name}`);
                        if (salePrice <= 0) throw new Error(`سعر البيع للصنف ${product.name} يجب أن يكون أكبر من صفر`);
                    }
                }

                return {
                    product,
                    productId,
                    quantity,
                    unitCost,
                    isPlumbing,
                    listPrice,
                    plumbingDiscountPercent,
                    salePrice,
                    displayQuantity,
                    displayUnit,
                    displayUnitCost,
                    displayListPrice,
                    cartonArea,
                    total: quantity * unitCost
                };
            });

            const subtotal = items.reduce((sum, item) => sum + item.total, 0);
            const discount = finiteNumber(purchase.discount_amount || 0, "الخصم");
            if (discount > subtotal) throw new Error("الخصم أكبر من إجمالي الفاتورة");
            const total = subtotal - discount;
            const paid = finiteNumber(purchase.paid_amount || 0, "المبلغ المدفوع");
            if (paid > total) throw new Error("المبلغ المدفوع أكبر من إجمالي الفاتورة");
            const remaining = total - paid;
            const nextInvoiceId = db.prepare(
                "SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM purchases"
            ).get().nextId;
            const invoiceNumber = `B-${String(nextInvoiceId).padStart(6, "0")}`;
            const result = db.prepare(`
                INSERT INTO purchases
                    (invoice_number, supplier_id, purchase_type, subtotal, discount_amount,
                     total_amount, paid_amount, remaining_amount, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                invoiceNumber,
                supplierId,
                remaining > 0 ? (paid > 0 ? "mixed" : "credit") : "cash",
                subtotal,
                discount,
                total,
                paid,
                remaining,
                purchase.notes?.trim() || null
            );
            const purchaseId = Number(result.lastInsertRowid);

            const insertItem = db.prepare(`
                INSERT INTO purchase_items
                    (purchase_id, product_id, location_id, quantity, unit_cost, total_amount,
                     previous_purchase_price, previous_purchase_price_manual, list_price,
                     plumbing_discount_percent, previous_sale_price, display_quantity,
                     display_unit, display_unit_cost, display_list_price,
                     previous_ceramic_purchase_price_per_sqm)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const productTotals = new Map();
            for (const item of items) {
                const productTotal = productTotals.get(item.productId) || {
                    quantity: 0,
                    total: 0,
                    previousCost: Number(item.product.purchase_price),
                    cartonArea: item.cartonArea
                };
                productTotal.quantity += item.quantity;
                productTotal.total += item.total;
                productTotals.set(item.productId, productTotal);
                ensureStockRow.run(item.productId, location.id);
                insertItem.run(
                    purchaseId,
                    item.productId,
                    location.id,
                    item.quantity,
                    item.unitCost,
                    item.total,
                    Number(item.product.purchase_price),
                    Number(item.product.purchase_price_manual || 0),
                    item.listPrice,
                    item.plumbingDiscountPercent,
                    item.salePrice === null ? null : Number(item.product.sale_price),
                    item.displayQuantity,
                    item.displayUnit,
                    item.displayUnitCost,
                    item.displayListPrice,
                    item.product.ceramic_purchase_price_per_sqm == null
                        ? -1 : Number(item.product.ceramic_purchase_price_per_sqm)
                );
                db.prepare(`
                    UPDATE stock SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
                    WHERE product_id = ? AND location_id = ?
                `).run(item.quantity, item.productId, location.id);
                addStockMovement.run(
                    item.productId,
                    location.id,
                    "purchase",
                    item.quantity,
                    "purchase",
                    purchaseId,
                    `فاتورة شراء ${invoiceNumber}`
                );
            }
            const salePrices = new Map();
            for (const item of items) {
                if (item.salePrice !== null) salePrices.set(item.productId, item.salePrice);
            }

            const costFactor = subtotal > 0 ? total / subtotal : 1;
            for (const [productId, productTotal] of productTotals) {
                const latestNetCost = productTotal.quantity > 0
                    ? productTotal.total * costFactor / productTotal.quantity
                    : productTotal.previousCost;
                const ceramicItem = items.find((entry) => entry.productId === productId && entry.cartonArea > 0);
                const ceramicPricePerSqm = ceramicItem ? latestNetCost / ceramicItem.cartonArea : null;
                db.prepare(`
                    UPDATE products SET purchase_price = ?, purchase_price_manual = 1,
                        sale_price = COALESCE(?, sale_price),
                        ceramic_purchase_price_per_sqm = CASE WHEN ? IS NULL THEN ceramic_purchase_price_per_sqm ELSE ? END,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(latestNetCost, salePrices.has(productId) ? salePrices.get(productId) : null,
                    ceramicPricePerSqm, ceramicPricePerSqm, productId);
            }

            if (supplierId) {
                db.prepare(`
                    INSERT INTO supplier_transactions
                        (supplier_id, transaction_type, reference_type, reference_id, debit, credit, notes)
                    VALUES (?, 'purchase', 'purchase', ?, 0, ?, ?)
                `).run(supplierId, purchaseId, total, `فاتورة شراء ${invoiceNumber}`);
                if (paid > 0) {
                    db.prepare(`
                        INSERT INTO supplier_transactions
                            (supplier_id, transaction_type, reference_type, reference_id, debit, credit, notes)
                        VALUES (?, 'payment', 'purchase', ?, ?, 0, ?)
                    `).run(supplierId, purchaseId, paid, `دفع على فاتورة ${invoiceNumber}`);
                }
            }

            if (paid > 0) {
                const requestedCashAccountId = Number(purchase.cash_account_id || 0);
                const account = requestedCashAccountId > 0
                    ? db.prepare("SELECT id FROM cash_accounts WHERE id = ? AND is_active = 1").get(requestedCashAccountId)
                    : db.prepare("SELECT id FROM cash_accounts WHERE name = 'الخزنة الرئيسية' AND is_active = 1").get();
                if (!account) throw new Error("الخزنة الرئيسية غير موجودة");
                db.prepare(`
                    INSERT INTO purchase_payments (purchase_id, amount, payment_method)
                    VALUES (?, ?, 'cash')
                `).run(purchaseId, paid);
                db.prepare(`
                    INSERT INTO cash_transactions
                        (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
                    VALUES (?, 'purchase', 'out', ?, 'purchase', ?, ?)
                `).run(account.id, paid, purchaseId, `سداد فاتورة شراء ${invoiceNumber}`);
            }
            const supplierName = supplierId
                ? db.prepare("SELECT name FROM suppliers WHERE id = ?").get(supplierId)?.name || null
                : null;
            return {
                success: true, purchaseId, invoiceNumber, supplierName,
                subtotal, discount, total, paid, remaining
            };
        })();
    });

    ipcMain.handle("stock:getOverview", () => db.prepare(`
        SELECT p.id, p.name, p.internal_code, p.unit, p.minimum_stock AS min_stock,
            p.purchase_price, p.sale_price, c.name AS category_name,
            COALESCE(SUM(s.quantity), 0) AS total_quantity,
            COALESCE(SUM(CASE WHEN l.name = 'المعرض' THEN s.quantity ELSE 0 END), 0) AS showroom_quantity,
            COALESCE(SUM(CASE WHEN l.name = 'المخزن' THEN s.quantity ELSE 0 END), 0) AS warehouse_quantity
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN stock s ON s.product_id = p.id
        LEFT JOIN locations l ON l.id = s.location_id
        WHERE p.is_active = 1
        GROUP BY p.id
        ORDER BY p.name
    `).all());

    ipcMain.handle("stock:getMovements", () => db.prepare(`
        SELECT sm.*, p.name AS product_name, p.internal_code, p.unit, l.name AS location_name
        FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        JOIN locations l ON l.id = sm.location_id
        ORDER BY sm.id DESC
        LIMIT 100
    `).all());

    ipcMain.handle("stock:transfer", (_event, transfer) => {
        if (!transfer || !Array.isArray(transfer.items) || transfer.items.length === 0) {
            throw new Error("أضف صنفًا واحدًا على الأقل للتحويل");
        }
        return db.transaction(() => {
            const from = getLocation(transfer.from_location_id);
            const to = getLocation(transfer.to_location_id);
            if (from.id === to.id) throw new Error("اختر مكانين مختلفين للتحويل");
            const items = transfer.items.map((item) => {
                const productId = Number(item.product_id);
                if (!db.prepare("SELECT id FROM products WHERE id = ? AND is_active = 1").get(productId)) {
                    throw new Error("أحد المنتجات غير موجود أو غير نشط");
                }
                return {
                    productId,
                    quantity: finiteNumber(item.quantity, "كمية التحويل", { min: Number.MIN_VALUE })
                };
            });
            const nextTransferId = db.prepare(
                "SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM stock_transfers"
            ).get().nextId;
            const transferNumber = `T-${String(nextTransferId).padStart(6, "0")}`;
            const result = db.prepare(`
                INSERT INTO stock_transfers
                    (transfer_number, from_location_id, to_location_id, notes)
                VALUES (?, ?, ?, ?)
            `).run(transferNumber, from.id, to.id, transfer.notes?.trim() || null);
            const transferId = Number(result.lastInsertRowid);
            for (const item of items) {
                ensureStockRow.run(item.productId, from.id);
                ensureStockRow.run(item.productId, to.id);
                const moved = db.prepare(`
                    UPDATE stock SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE product_id = ? AND location_id = ? AND quantity >= ?
                `).run(item.quantity, item.productId, from.id, item.quantity);
                if (moved.changes !== 1) throw new Error("الكمية المطلوبة أكبر من المخزون المتاح");
                db.prepare(`
                    UPDATE stock SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
                    WHERE product_id = ? AND location_id = ?
                `).run(item.quantity, item.productId, to.id);
                db.prepare(`
                    INSERT INTO stock_transfer_items (transfer_id, product_id, quantity)
                    VALUES (?, ?, ?)
                `).run(transferId, item.productId, item.quantity);
                addStockMovement.run(item.productId, from.id, "transfer", -item.quantity, "transfer", transferId, `تحويل ${transferNumber} إلى ${to.name}`);
                addStockMovement.run(item.productId, to.id, "transfer", item.quantity, "transfer", transferId, `تحويل ${transferNumber} من ${from.name}`);
            }
            return { success: true, transferId, transferNumber };
        })();
    });

    ipcMain.handle("stock:adjust", (_event, adjustment) => db.transaction(() => {
        const productId = Number(adjustment?.product_id);
        if (!db.prepare("SELECT id, name FROM products WHERE id = ? AND is_active = 1").get(productId)) {
            throw new Error("المنتج غير موجود أو غير نشط");
        }
        const location = getLocation(adjustment.location_id);
        const targetQuantity = finiteNumber(adjustment.quantity, "الرصيد الفعلي");
        ensureStockRow.run(productId, location.id);
        const current = db.prepare(`
            SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?
        `).get(productId, location.id).quantity;
        const delta = targetQuantity - Number(current);
        if (Math.abs(delta) < 0.000001) throw new Error("الرصيد مطابق للموجود بالفعل");
        db.prepare(`
            UPDATE stock SET quantity = ?, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = ? AND location_id = ?
        `).run(targetQuantity, productId, location.id);
        addStockMovement.run(
            productId,
            location.id,
            "adjustment",
            delta,
            "adjustment",
            null,
            adjustment.notes?.trim() || "تسوية جرد"
        );
        return { success: true, difference: delta };
    })());

    for (const entity of ["customers", "suppliers"]) {
        const invoiceTable = entity === "customers" ? "sales" : "purchases";
        const contactColumn = entity === "customers" ? "customer_id" : "supplier_id";
        ipcMain.handle(`${entity}:getOutstanding`, () => {
            if (entity === "customers") {
                const customers = db.prepare(`
                    SELECT c.id, c.name, c.phone, c.opening_balance,
                           c.opening_balance + COALESCE(SUM(ct.debit - ct.credit), 0) AS total_balance
                    FROM customers c
                    LEFT JOIN customer_transactions ct ON ct.customer_id = c.id
                    WHERE c.is_active = 1
                    GROUP BY c.id
                    HAVING total_balance > 0.000001
                `).all();
                const list = [];
                for (const row of customers) {
                    const totalBal = Number(row.total_balance || 0);
                    if (totalBal > 0.000001) {
                        list.push({
                            id: `merged-${row.id}`,
                            invoice_number: "إجمالي مديونية",
                            contact_id: row.id,
                            contact_name: row.name,
                            contact_phone: row.phone || "-",
                            total: Math.round(totalBal * 100) / 100,
                            paid: 0,
                            remaining: Math.round(totalBal * 100) / 100,
                            created_at: new Date().toISOString(),
                            due_date: null,
                            is_merged: true
                        });
                    }
                }
                return list;
            } else {
                return db.prepare(`
                    SELECT ${invoiceTable}.id, ${invoiceTable}.invoice_number,
                        ${contactColumn} AS contact_id,
                        c.name AS contact_name, ${invoiceTable}.total_amount AS total,
                        ${invoiceTable}.paid_amount AS paid,
                        ${invoiceTable}.remaining_amount AS remaining, ${invoiceTable}.created_at,
                        NULL AS due_date
                    FROM ${invoiceTable}
                    JOIN ${entity} c ON c.id = ${invoiceTable}.${contactColumn}
                    WHERE ${invoiceTable}.remaining_amount > 0
                        AND ${invoiceTable}.status = 'completed'
                    ORDER BY ${invoiceTable}.id DESC
                    LIMIT 500
                `).all();
            }
        });

        const balanceExpression = entity === "customers"
            ? "opening_balance + COALESCE(SUM(ct.debit - ct.credit), 0)"
            : "opening_balance + COALESCE(SUM(ct.credit - ct.debit), 0)";
        ipcMain.handle(`${entity}:getAll`, () => db.prepare(`
            SELECT c.*, ${balanceExpression} AS balance
            FROM ${entity} c
            LEFT JOIN ${entity === "customers" ? "customer" : "supplier"}_transactions ct
                ON ct.${entity === "customers" ? "customer" : "supplier"}_id = c.id
            WHERE c.is_active = 1
            GROUP BY c.id
            ORDER BY c.name
        `).all());
    }

    ipcMain.handle("customers:getPayables", () => {
        // 1. العملاء الذين لهم رصيد دائن حقيقي (رصيدهم الكلي سالب)
        const creditors = db.prepare(`
            SELECT c.id, c.name, c.phone, c.opening_balance,
                   (c.opening_balance + COALESCE(SUM(ct.debit - ct.credit), 0)) AS balance,
                   (SELECT ct2.notes FROM customer_transactions ct2 WHERE ct2.customer_id = c.id ORDER BY ct2.id DESC LIMIT 1) AS last_note,
                   (SELECT ct2.created_at FROM customer_transactions ct2 WHERE ct2.customer_id = c.id ORDER BY ct2.id DESC LIMIT 1) AS last_date,
                   (SELECT s.invoice_number 
                    FROM customer_transactions ct3 
                    JOIN sales_returns sr ON sr.id = ct3.reference_id 
                    JOIN sales s ON s.id = sr.sale_id
                    WHERE ct3.customer_id = c.id AND ct3.reference_type = 'sales_return' 
                    ORDER BY ct3.id DESC LIMIT 1) AS return_invoice_number
            FROM customers c
            LEFT JOIN customer_transactions ct ON ct.customer_id = c.id
            WHERE c.is_active = 1
            GROUP BY c.id
            HAVING balance < -0.000001
            ORDER BY balance ASC
        `).all();

        const seenCustomerIds = new Set();
        const list = [];

        for (const row of creditors) {
            const cid = Number(row.id);
            seenCustomerIds.add(cid);
            const balanceVal = Number(row.balance || 0);
            list.push({
                type: "customer_balance",
                id: `customer-${cid}`,
                customer_id: cid,
                customer_name: row.name,
                phone: row.phone || "-",
                invoice_number: row.return_invoice_number || "-",
                amount: Math.round(Math.abs(balanceVal) * 100) / 100,
                reason: row.last_note || "رصيد دائن مستحق للعميل",
                date: row.last_date || null
            });
        }

        // 2. الفواتير ذات المرتجعات للعملاء النقديين فقط (بدون حساب عميل مسجل)
        const returnInvoices = db.prepare(`
            SELECT s.id, s.invoice_number, s.customer_id, c.name AS customer_name, c.phone AS customer_phone,
                   s.total_amount, s.paid_amount, s.created_at,
                   COALESCE((SELECT SUM(total_amount) FROM sales_returns WHERE sale_id = s.id), 0) AS return_total,
                   (s.total_amount - COALESCE((SELECT SUM(total_amount) FROM sales_returns WHERE sale_id = s.id), 0) - s.paid_amount + COALESCE((SELECT SUM(cash_refund_amount) FROM sales_returns WHERE sale_id = s.id), 0)) AS net_remaining
            FROM sales s
            LEFT JOIN customers c ON c.id = s.customer_id
            WHERE s.status = 'completed'
              AND (s.customer_id IS NULL OR s.customer_id = 0)
              AND COALESCE((SELECT SUM(total_amount) FROM sales_returns WHERE sale_id = s.id), 0) > 0
              AND (s.total_amount - COALESCE((SELECT SUM(total_amount) FROM sales_returns WHERE sale_id = s.id), 0) - s.paid_amount + COALESCE((SELECT SUM(cash_refund_amount) FROM sales_returns WHERE sale_id = s.id), 0)) < -0.000001
            ORDER BY s.id DESC
            LIMIT 100
        `).all();

        for (const row of returnInvoices) {
            const cid = row.customer_id ? Number(row.customer_id) : null;
            if (cid && seenCustomerIds.has(cid)) continue;
            const netRem = Number(row.net_remaining || 0);
            list.push({
                type: "invoice_return",
                id: `sale-${row.id}`,
                customer_id: cid,
                customer_name: row.customer_name || "عميل نقدي",
                phone: row.customer_phone || "-",
                invoice_number: row.invoice_number,
                amount: Math.round(Math.abs(netRem) * 100) / 100,
                reason: `مرتجع على الفاتورة ${row.invoice_number}`,
                date: row.created_at || null
            });
        }

        return list;
    });

    ipcMain.handle("contacts:refundCustomer", (_event, customerId, amount, notes = "", invoiceNumber = "") => {
        const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
        const refundAmount = roundMoney(finiteNumber(amount, "مبلغ الرد", { min: 0.01 }));
        return db.transaction(() => {
            const id = Number(customerId) > 0 ? Number(customerId) : 0;
            const customer = id > 0 ? db.prepare("SELECT id, name, opening_balance FROM customers WHERE id = ?").get(id) : null;
            if (id > 0 && !customer) throw new Error("العميل غير موجود");
            const customerName = customer ? customer.name : "عميل نقدي";

            const account = db.prepare(`
                SELECT id FROM cash_accounts WHERE name = 'الخزنة الرئيسية' AND is_active = 1
            `).get() || db.prepare("SELECT id FROM cash_accounts WHERE is_active = 1 LIMIT 1").get();
            if (!account) throw new Error("الخزنة الرئيسية غير موجودة أو غير نشطة");

            const noteDesc = notes ? String(notes).trim() : `رد نقدية للعميل ${customerName}`;

            // الفاتورة المرتبطة (اختيارية للعميل المسجل، ضرورية للعميل النقدي)
            const invoiceNo = String(invoiceNumber || "").trim();
            let sale = invoiceNo && invoiceNo !== "-"
                ? db.prepare("SELECT id, customer_id, total_amount, paid_amount FROM sales WHERE invoice_number = ?").get(invoiceNo)
                : null;
            if (sale && id > 0 && sale.customer_id && Number(sale.customer_id) !== id) sale = null;

            // 1) نتأكد من المستحق فعلًا للعميل في قاعدة البيانات (مش من اللي الشاشة بعتته)،
            //    عشان ضغطتين أو شاشة قديمة ما يصرفوش المبلغ مرتين.
            let owed;
            if (id > 0) {
                const row = db.prepare(`
                    SELECT COALESCE(SUM(debit - credit), 0) AS movement FROM customer_transactions WHERE customer_id = ?
                `).get(id);
                owed = roundMoney(-(Number(customer.opening_balance || 0) + Number(row.movement || 0)));
            } else {
                if (!sale) throw new Error("حدد فاتورة العميل النقدي لصرف الرد");
                const totals = db.prepare(`
                    SELECT COALESCE(SUM(total_amount), 0) AS returned, COALESCE(SUM(cash_refund_amount), 0) AS refunded
                    FROM sales_returns WHERE sale_id = ?
                `).get(sale.id);
                owed = roundMoney(
                    Number(sale.paid_amount || 0) - (Number(sale.total_amount || 0) - Number(totals.returned || 0)) - Number(totals.refunded || 0)
                );
            }
            if (owed <= 0.000001) throw new Error("لا يوجد مبلغ مستحق للعميل لصرفه");
            if (refundAmount > owed + 0.005) {
                throw new Error(`مبلغ الرد أكبر من المستحق للعميل (${owed} ج.م). حدّث الصفحة وحاول تاني.`);
            }

            // 2) نربط الصرف بسجلات المرتجع (cash_refund_amount) بدل ما نعدّل paid_amount للفاتورة.
            //    المدفوع التاريخي يفضل زي ما هو، والفاتورة بتعرض الرد النقدي منفصل.
            let toAllocate = refundAmount;
            const openReturns = db.prepare(`
                SELECT id, total_amount, COALESCE(cash_refund_amount, 0) AS cash_refund
                FROM sales_returns
                WHERE (total_amount - COALESCE(cash_refund_amount, 0)) > 0.000001
                  AND ((? > 0 AND customer_id = ?) OR sale_id = ?)
                ORDER BY CASE WHEN sale_id = ? THEN 0 ELSE 1 END, id ASC
            `).all(id, id, sale ? sale.id : -1, sale ? sale.id : -1);
            for (const ret of openReturns) {
                if (toAllocate <= 0.000001) break;
                const take = roundMoney(Math.min(Number(ret.total_amount) - Number(ret.cash_refund), toAllocate));
                if (take <= 0) continue;
                db.prepare(`
                    UPDATE sales_returns
                    SET cash_refund_amount = cash_refund_amount + ?,
                        balance_credit_amount = MAX(0, total_amount - (cash_refund_amount + ?))
                    WHERE id = ?
                `).run(take, take, ret.id);
                toAllocate = roundMoney(toAllocate - take);
            }

            // 3) حساب العميل: الرد النقدي يقلّل الرصيد الدائن (مدين)
            if (id > 0) {
                db.prepare(`
                    INSERT INTO customer_transactions
                        (customer_id, transaction_type, reference_type, reference_id, debit, credit, notes)
                    VALUES (?, 'refund', 'cash_refund', ?, ?, 0, ?)
                `).run(id, sale ? sale.id : null, refundAmount, noteDesc);
            }

            // 4) الخزنة
            db.prepare(`
                INSERT INTO cash_transactions
                    (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
                VALUES (?, 'customer_refund', 'out', ?, ?, ?, ?)
            `).run(
                account.id,
                refundAmount,
                id > 0 ? "customer" : "sale",
                id > 0 ? id : (sale ? sale.id : null),
                noteDesc
            );

            return {
                success: true,
                customerId: id,
                refundedAmount: refundAmount,
                remainingOwed: roundMoney(owed - refundAmount)
            };
        })();
    });

    ipcMain.handle("contacts:recordPayment", (_event, entity, invoiceId, amount) => {
        if (!["customers", "suppliers"].includes(entity)) throw new Error("نوع الحساب غير صحيح");
        const paidAmount = finiteNumber(amount, "مبلغ السداد", { min: Number.MIN_VALUE });
        return db.transaction(() => {
            const isCustomer = entity === "customers";
            const invoiceTable = isCustomer ? "sales" : "purchases";
            const contactColumn = isCustomer ? "customer_id" : "supplier_id";
            const paymentTable = isCustomer ? "sale_payments" : "purchase_payments";

            if (isCustomer && typeof invoiceId === "string" && invoiceId.startsWith("merged-")) {
                const customerId = Number(invoiceId.replace("merged-", ""));
                const customer = db.prepare("SELECT id, name, opening_balance FROM customers WHERE id = ?").get(customerId);
                if (!customer) throw new Error("العميل غير موجود");
                const openInvoices = db.prepare(`
                    SELECT id, remaining_amount FROM sales
                    WHERE customer_id = ? AND status = 'completed' AND remaining_amount > 0.000001
                    AND (is_hidden = 0 OR is_hidden IS NULL)
                    ORDER BY id ASC
                `).all(customerId);
                let remainingPayment = paidAmount;
                const account = db.prepare(`SELECT id FROM cash_accounts WHERE name = 'الخزنة الرئيسية' AND is_active = 1`).get();
                if (!account) throw new Error("الخزنة الرئيسية غير موجودة");
                for (const inv of openInvoices) {
                    if (remainingPayment <= 0.000001) break;
                    const take = Math.min(remainingPayment, Number(inv.remaining_amount));
                    if (take <= 0) continue;
                    db.prepare(`UPDATE sales SET paid_amount = paid_amount + ?, remaining_amount = remaining_amount - ? WHERE id = ?`).run(take, take, inv.id);
                    db.prepare(`INSERT INTO sale_payments (sale_id, amount, payment_method) VALUES (?, ?, 'cash')`).run(inv.id, take);
                    db.prepare(`INSERT INTO customer_transactions (customer_id, transaction_type, reference_type, reference_id, debit, credit, notes) VALUES (?, 'payment', 'sale', ?, 0, ?, ?)`).run(customerId, inv.id, take, `تحصيل على فاتورة رقم ${inv.id}`);
                    remainingPayment = Math.round((remainingPayment - take) * 100) / 100;
                }
                if (remainingPayment > 0.000001) {
                    db.prepare(`INSERT INTO customer_transactions (customer_id, transaction_type, reference_type, reference_id, debit, credit, notes) VALUES (?, 'payment', 'opening_balance', NULL, 0, ?, ?)`).run(customerId, remainingPayment, `تحصيل من رصيد قديم / افتتاحي للعميل ${customer.name}`);
                }
                db.prepare(`INSERT INTO cash_transactions (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description) VALUES (?, 'payment', 'in', ?, 'customer', ?, ?)`).run(account.id, paidAmount, customerId, `تحصيل دفعة من العميل ${customer.name}`);
                return { success: true, invoiceId: `merged-${customerId}`, remaining: 0 };
            }
if (isCustomer && typeof invoiceId === "string" && invoiceId.startsWith("opening-")) {
                const customerId = Number(invoiceId.replace("opening-", ""));
                const customer = db.prepare("SELECT id, name, opening_balance FROM customers WHERE id = ?").get(customerId);
                if (!customer) throw new Error("العميل غير موجود");

                const balanceRow = db.prepare(`
                    SELECT c.opening_balance + COALESCE(SUM(ct.debit - ct.credit), 0) AS total_balance,
                           COALESCE((SELECT SUM(remaining_amount) FROM sales WHERE customer_id = c.id AND status = 'completed' AND (is_hidden = 0 OR is_hidden IS NULL)), 0) AS invoices_remaining
                    FROM customers c
                    LEFT JOIN customer_transactions ct ON ct.customer_id = c.id
                    WHERE c.id = ?
                    GROUP BY c.id
                `).get(customerId);
                const totalBal = Number(balanceRow?.total_balance || 0);
                const invRem = Number(balanceRow?.invoices_remaining || 0);
                const openingRem = Math.round(Math.max(0, totalBal - invRem) * 100) / 100;
                if (paidAmount > openingRem + 0.000001) {
                    throw new Error("مبلغ السداد أكبر من الرصيد القديم المتبقي");
                }

                const account = db.prepare(`
                    SELECT id FROM cash_accounts WHERE name = 'الخزنة الرئيسية' AND is_active = 1
                `).get();
                if (!account) throw new Error("الخزنة الرئيسية غير موجودة");

                db.prepare(`
                    INSERT INTO customer_transactions
                        (customer_id, transaction_type, reference_type, reference_id, debit, credit, notes)
                    VALUES (?, 'payment', 'opening_balance', NULL, 0, ?, ?)
                `).run(customerId, paidAmount, `تحصيل من رصيد قديم / افتتاحي للعميل ${customer.name}`);

                db.prepare(`
                    INSERT INTO cash_transactions
                        (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
                    VALUES (?, 'payment', 'in', ?, 'customer_opening', ?, ?)
                `).run(account.id, paidAmount, customerId, `تحصيل رصيد قديم من العميل ${customer.name}`);

                return {
                    success: true,
                    invoiceId: `opening-${customerId}`,
                    remaining: openingRem - paidAmount
                };
            }

            if (isCustomer) invoiceId = resolveParentId(db, invoiceId);
            const invoice = db.prepare(`
                SELECT id, ${contactColumn} AS contact_id, invoice_number,
                    remaining_amount, paid_amount
                FROM ${invoiceTable}
                WHERE id = ? AND status = 'completed'
            `).get(Number(invoiceId));
            if (!invoice) throw new Error("الفاتورة غير موجودة");
            if (paidAmount > Number(invoice.remaining_amount) + 0.000001) {
                throw new Error("مبلغ السداد أكبر من المتبقي على الفاتورة");
            }
            const account = db.prepare(`
                SELECT id FROM cash_accounts WHERE name = 'الخزنة الرئيسية' AND is_active = 1
            `).get();
            if (!account) throw new Error("الخزنة الرئيسية غير موجودة");

            const paymentUpdate = db.prepare(`
                UPDATE ${invoiceTable}
                SET paid_amount = paid_amount + ?,
                    remaining_amount = MAX(0, remaining_amount - ?),
                    ${isCustomer ? "sale_type = CASE WHEN sale_type = 'plumbing_order' THEN sale_type WHEN remaining_amount - ? <= 0.000001 THEN 'cash' ELSE 'credit' END" : "purchase_type = CASE WHEN remaining_amount - ? <= 0.000001 THEN 'cash' ELSE 'credit' END"}
                    ${isCustomer ? ", updated_at = CURRENT_TIMESTAMP" : ""}
                WHERE id = ? AND remaining_amount >= ?
            `).run(
                paidAmount,
                paidAmount,
                paidAmount,
                invoice.id,
                paidAmount
            );
            if (paymentUpdate.changes !== 1) throw new Error("تعذر تحديث رصيد الفاتورة؛ لم يتم تسجيل التحصيل");
            db.prepare(`
                INSERT INTO ${paymentTable} (${isCustomer ? "sale_id" : "purchase_id"}, amount, payment_method)
                VALUES (?, ?, 'cash')
            `).run(invoice.id, paidAmount);
            if (isCustomer) {
                const groupInfo = getInvoiceMetadata(invoice);
                if (groupInfo && groupInfo.kind === 'parent' && Array.isArray(groupInfo.sectionIds) && groupInfo.sectionIds.length > 0) {
                    let unallocated = paidAmount;
                    const placeholders = groupInfo.sectionIds.map(() => '?').join(',');
                    const sections = db.prepare("SELECT id, remaining_amount, paid_amount FROM sales WHERE id IN (" + placeholders + ") ORDER BY id ASC").all(...groupInfo.sectionIds);
                    for (const sec of sections) {
                        if (unallocated <= 0.000001) break;
                        const secRem = Number(sec.remaining_amount || 0);
                        if (secRem > 0.000001) {
                            const alloc = Math.min(secRem, unallocated);
                            const newSecPaid = Number(sec.paid_amount || 0) + alloc;
                            const newSecRem = Math.max(0, secRem - alloc);
                            db.prepare("UPDATE sales SET paid_amount = ?, remaining_amount = ?, is_hidden = 1, status = 'consolidated', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newSecPaid, newSecRem, sec.id);
                            unallocated -= alloc;
                        }
                    }
                }
            }
            db.prepare(`
                INSERT INTO ${isCustomer ? "customer_transactions" : "supplier_transactions"}
                    (${isCustomer ? "customer_id" : "supplier_id"}, transaction_type,
                     reference_type, reference_id, debit, credit, notes)
                VALUES (?, 'payment', ?, ?, ?, ?, ?)
            `).run(
                invoice.contact_id,
                isCustomer ? "sale" : "purchase",
                invoice.id,
                isCustomer ? 0 : paidAmount,
                isCustomer ? paidAmount : 0,
                `سداد على الفاتورة ${invoice.invoice_number}`
            );
            db.prepare(`
                INSERT INTO cash_transactions
                    (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
                VALUES (?, 'payment', ?, ?, ?, ?, ?)
            `).run(
                account.id,
                isCustomer ? "in" : "out",
                paidAmount,
                isCustomer ? "sale" : "purchase",
                invoice.id,
                `${isCustomer ? "تحصيل" : "سداد"} الفاتورة ${invoice.invoice_number}`
            );
            return {
                success: true,
                invoiceId: invoice.id,
                remaining: Number(invoice.remaining_amount) - paidAmount
            };
        })();
    });

    ipcMain.handle("contacts:save", (_event, entity, id, contact) => {
        if (!["customers", "suppliers"].includes(entity)) throw new Error("نوع الحساب غير صحيح");
        const name = requiredText(contact?.name, "الاسم");
        const openingBalance = finiteNumber(contact?.opening_balance || 0, "الرصيد الافتتاحي");
        if (id) {
            const existing = db.prepare(`SELECT id FROM ${entity} WHERE id = ?`).get(Number(id));
            if (!existing) throw new Error("الحساب غير موجود");
            db.prepare(`
                UPDATE ${entity} SET name = ?, phone = ?, address = ?, opening_balance = ?, notes = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(name, contact.phone?.trim() || null, contact.address?.trim() || null, openingBalance, contact.notes?.trim() || null, Number(id));
            return { success: true, id: Number(id) };
        }
        const result = db.prepare(`
            INSERT INTO ${entity} (name, phone, address, opening_balance, notes, is_active)
            VALUES (?, ?, ?, ?, ?, 1)
        `).run(name, contact.phone?.trim() || null, contact.address?.trim() || null, openingBalance, contact.notes?.trim() || null);
        return { success: true, id: Number(result.lastInsertRowid) };
    });

    ipcMain.handle("cash:getAccounts", () => db.prepare(`
        SELECT id, name FROM cash_accounts
        WHERE is_active = 1
        ORDER BY CASE WHEN name = 'الخزنة الرئيسية' THEN 0 ELSE 1 END, id
    `).all());
    ipcMain.handle("cash:getSummary", (event) => {
        requireFinanceSession(event);
        return db.prepare(`
        SELECT ca.id, ca.name, ca.opening_balance,
            ca.opening_balance + COALESCE(SUM(
                CASE WHEN ct.direction = 'in' THEN ct.amount ELSE -ct.amount END
            ), 0) AS balance
        FROM cash_accounts ca
        LEFT JOIN cash_transactions ct ON ct.cash_account_id = ca.id
        WHERE ca.is_active = 1
        GROUP BY ca.id
        ORDER BY ca.id
    `).all();
    });

    ipcMain.handle("cash:getTransactions", (event) => {
        requireFinanceSession(event);
        return db.prepare(`
        SELECT ct.*, ca.name AS account_name,
            CASE
                WHEN ct.transaction_type IN ('manual_income', 'manual_expense')
                 AND ct.reference_type IS NULL
                 AND ct.reference_id IS NULL
                THEN 1 ELSE 0
            END AS can_delete
        FROM cash_transactions ct
        JOIN cash_accounts ca ON ca.id = ct.cash_account_id
        ORDER BY ct.id DESC
        LIMIT 200
    `).all();
    });

    ipcMain.handle("cash:getExpenseCategories", () => db.prepare(`
        SELECT id, name FROM expense_categories WHERE is_active = 1 ORDER BY name
    `).all());

    ipcMain.handle("cash:getExpenses", () => db.prepare(`
        SELECT
            e.id,
            e.amount,
            e.description,
            e.created_at,
            ca.name AS account_name,
            ec.name AS category_name,
            CASE
                WHEN e.reference_type = 'cash_transaction'
                    AND e.reference_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM cash_transactions ct
                        WHERE ct.id = e.reference_id
                          AND ct.cash_account_id = e.cash_account_id
                          AND ct.transaction_type = 'manual_expense'
                          AND ct.direction = 'out'
                          AND ABS(ct.amount - e.amount) < 0.005
                    )
                THEN 1 ELSE 0
            END AS can_delete
        FROM expenses e
        LEFT JOIN cash_accounts ca ON ca.id = e.cash_account_id
        LEFT JOIN expense_categories ec ON ec.id = e.expense_category_id
        ORDER BY e.id DESC
    `).all());

    ipcMain.handle("cash:deleteExpense", (_event, expenseId, password) => {
        verifyDeletionPassword(db, password);
        return db.transaction(() => {
        const id = Number(expenseId);

        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new Error("رقم المصروف غير صحيح");
        }

        const expense = db.prepare(`
            SELECT id, cash_account_id, amount, reference_type, reference_id
            FROM expenses
            WHERE id = ?
        `).get(id);

        if (!expense) {
            throw new Error("المصروف غير موجود");
        }

        if (
            expense.reference_type !== "cash_transaction" ||
            !expense.reference_id ||
            !expense.cash_account_id
        ) {
            throw new Error("لا يمكن حذف هذا المصروف من الصفحة الحالية");
        }

        const transaction = db.prepare(`
            SELECT id, cash_account_id, transaction_type, direction, amount
            FROM cash_transactions
            WHERE id = ? AND cash_account_id = ?
        `).get(
            Number(expense.reference_id),
            Number(expense.cash_account_id)
        );

        if (
            !transaction ||
            transaction.transaction_type !== "manual_expense" ||
            transaction.direction !== "out"
        ) {
            throw new Error("حركة الخزنة المرتبطة غير صالحة؛ لم يتم حذف شيء");
        }

        if (Math.abs(Number(transaction.amount) - Number(expense.amount)) > 0.009) {
            throw new Error("المبلغ لا يطابق حركة الخزنة؛ لم يتم حذف شيء");
        }

        const linkedCount = db.prepare(`
            SELECT COUNT(*) AS count
            FROM expenses
            WHERE reference_type = 'cash_transaction'
              AND reference_id = ?
        `).get(Number(transaction.id));

        if (Number(linkedCount.count) !== 1) {
            throw new Error("الحركة مرتبطة بسجلات أخرى؛ لم يتم حذف شيء");
        }

        const deletedExpense = db.prepare(`
            DELETE FROM expenses
            WHERE id = ?
              AND reference_type = 'cash_transaction'
              AND reference_id = ?
        `).run(id, Number(transaction.id));

        if (deletedExpense.changes !== 1) {
            throw new Error("تعذر حذف سجل المصروف");
        }

        const deletedTransaction = db.prepare(`
            DELETE FROM cash_transactions
            WHERE id = ?
              AND cash_account_id = ?
              AND transaction_type = 'manual_expense'
              AND direction = 'out'
        `).run(Number(transaction.id), Number(transaction.cash_account_id));

        if (deletedTransaction.changes !== 1) {
            throw new Error("تعذر حذف حركة الخزنة");
        }

        return {
            success: true,
            restoredAmount: Number(expense.amount)
        };
        })();
    });

    ipcMain.handle("cash:deleteManualTransaction", (event, transactionId) => {
        requireFinanceSession(event);
        return db.transaction(() => {
        const id = Number(transactionId);

        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new Error("رقم الحركة غير صحيح");
        }

        const tx = db.prepare(`
            SELECT *
            FROM cash_transactions
            WHERE id = ?
        `).get(id);

        if (!tx) {
            throw new Error("الحركة النقدية غير موجودة");
        }

        if (
            !["manual_income", "manual_expense"].includes(tx.transaction_type) ||
            tx.reference_type != null ||
            tx.reference_id != null
        ) {
            throw new Error("لا يمكن حذف حركة مرتبطة بفاتورة أو عملية أخرى من صفحة الخزنة");
        }

        const linkedExpenses = db.prepare(`
            SELECT id, cash_account_id, amount
            FROM expenses
            WHERE reference_type = 'cash_transaction'
              AND reference_id = ?
        `).all(id);

        if (tx.transaction_type === "manual_expense") {
            if (
                linkedExpenses.length !== 1 ||
                Number(linkedExpenses[0].cash_account_id) !== Number(tx.cash_account_id) ||
                Math.abs(Number(linkedExpenses[0].amount) - Number(tx.amount)) > 0.009
            ) {
                throw new Error("تعذر مطابقة المصروف مع حركة الخزنة؛ لم يتم حذف شيء");
            }

            db.prepare(`
                DELETE FROM expenses WHERE id = ?
            `).run(Number(linkedExpenses[0].id));
        } else if (linkedExpenses.length !== 0) {
            throw new Error("الحركة مرتبطة بسجل مصروف؛ لم يتم حذف شيء");
        }

        const result = db.prepare(`
            DELETE FROM cash_transactions
            WHERE id = ?
              AND transaction_type IN ('manual_income', 'manual_expense')
              AND reference_type IS NULL
              AND reference_id IS NULL
        `).run(id);

        if (result.changes !== 1) {
            throw new Error("تعذر حذف الحركة النقدية");
        }

        return { success: true, deletedAmount: Number(tx.amount) };
        })();
    });

    ipcMain.handle("cash:addExpense", (_event, entry) => db.transaction(() => {
        const amount = finiteNumber(entry?.amount, "المبلغ", { min: Number.MIN_VALUE });
        const account = db.prepare("SELECT id FROM cash_accounts WHERE id = ? AND is_active = 1")
            .get(Number(entry?.account_id));
        if (!account) throw new Error("الخزنة غير موجودة أو غير نشطة");
        const description = requiredText(entry?.description, "البيان");
        const categoryId = entry?.expense_category_id ? Number(entry.expense_category_id) : null;
        if (categoryId && !db.prepare("SELECT id FROM expense_categories WHERE id = ? AND is_active = 1").get(categoryId)) {
            throw new Error("بند المصروف غير موجود");
        }
        const result = db.prepare(`
            INSERT INTO cash_transactions
                (cash_account_id, transaction_type, direction, amount, description)
            VALUES (?, 'manual_expense', 'out', ?, ?)
        `).run(account.id, amount, description);
        db.prepare(`
            INSERT INTO expenses (expense_category_id, cash_account_id, amount, description, reference_type, reference_id)
            VALUES (?, ?, ?, ?, 'cash_transaction', ?)
        `).run(categoryId, account.id, amount, description, Number(result.lastInsertRowid));
        return { success: true, transactionId: Number(result.lastInsertRowid) };
    })());

    ipcMain.handle("cash:addTransaction", (event, entry) => {
        requireFinanceSession(event);
        return db.transaction(() => {
        const direction = entry?.direction;
        if (!["in", "out"].includes(direction)) throw new Error("نوع الحركة غير صحيح");
        const amount = finiteNumber(entry.amount, "المبلغ", { min: Number.MIN_VALUE });
        const account = db.prepare(`
            SELECT id FROM cash_accounts WHERE id = ? AND is_active = 1
        `).get(Number(entry.account_id));
        if (!account) throw new Error("الخزنة غير موجودة أو غير نشطة");
        const description = requiredText(entry.description, "البيان");
        const result = db.prepare(`
            INSERT INTO cash_transactions
                (cash_account_id, transaction_type, direction, amount, description)
            VALUES (?, ?, ?, ?, ?)
        `).run(account.id, direction === "in" ? "manual_income" : "manual_expense", direction, amount, description);
        if (direction === "out") {
            const categoryId = entry.expense_category_id ? Number(entry.expense_category_id) : null;
            if (categoryId && !db.prepare(
                "SELECT id FROM expense_categories WHERE id = ? AND is_active = 1"
            ).get(categoryId)) throw new Error("بند المصروف غير موجود");
            db.prepare(`
                INSERT INTO expenses (expense_category_id, cash_account_id, amount, description, reference_type, reference_id)
                VALUES (?, ?, ?, ?, 'cash_transaction', ?)
            `).run(categoryId, account.id, amount, description, Number(result.lastInsertRowid));
        }
        return { success: true, transactionId: Number(result.lastInsertRowid) };
        })();
    });

    // Printable cash statement for the same date range selected in Reports.
    ipcMain.handle("cash:getStatement", (event, range = {}) => {
        requireFinanceSession(event);
        const today = new Date().toISOString().slice(0, 10);
        const from = range.from || today;
        const to = range.to || today;
        const validDate = (value) => {
            if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
            const date = new Date(`${value}T00:00:00.000Z`);
            return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
        };
        if (!validDate(from) || !validDate(to) || from > to) {
            throw new Error("نطاق التاريخ غير صحيح");
        }

        const accounts = db.prepare(`
            SELECT ca.id, ca.name,
                COALESCE(ca.opening_balance, 0) + COALESCE((
                    SELECT SUM(CASE WHEN prior_ct.direction = 'in'
                        THEN prior_ct.amount ELSE -prior_ct.amount END)
                    FROM cash_transactions prior_ct
                    WHERE prior_ct.cash_account_id = ca.id
                      AND date(prior_ct.created_at, 'localtime') < ?
                ), 0) AS opening_balance,
                COALESCE((
                    SELECT SUM(period_ct.amount)
                    FROM cash_transactions period_ct
                    WHERE period_ct.cash_account_id = ca.id
                      AND date(period_ct.created_at, 'localtime') BETWEEN ? AND ?
                      AND period_ct.direction = 'in'
                ), 0) AS total_in,
                COALESCE((
                    SELECT SUM(period_ct.amount)
                    FROM cash_transactions period_ct
                    WHERE period_ct.cash_account_id = ca.id
                      AND date(period_ct.created_at, 'localtime') BETWEEN ? AND ?
                      AND period_ct.direction = 'out'
                ), 0) AS total_out
            FROM cash_accounts ca
            ORDER BY CASE WHEN ca.name = 'الخزنة الرئيسية' THEN 0 ELSE 1 END, ca.id
        `).all(from, from, to, from, to).map((account) => ({
            ...account,
            id: Number(account.id),
            opening_balance: Number(account.opening_balance || 0),
            total_in: Number(account.total_in || 0),
            total_out: Number(account.total_out || 0),
            closing_balance: Number(account.opening_balance || 0)
                + Number(account.total_in || 0) - Number(account.total_out || 0)
        }));

        const transactions = db.prepare(`
            SELECT ct.id, ct.cash_account_id, ca.name AS account_name,
                ct.transaction_type, ct.direction, ct.amount,
                ct.reference_type, ct.reference_id, ct.description, ct.created_at
            FROM cash_transactions ct
            JOIN cash_accounts ca ON ca.id = ct.cash_account_id
            WHERE date(ct.created_at, 'localtime') BETWEEN ? AND ?
            ORDER BY datetime(ct.created_at), ct.id
        `).all(from, to).map((transaction) => ({
            ...transaction,
            id: Number(transaction.id),
            cash_account_id: Number(transaction.cash_account_id),
            amount: Number(transaction.amount || 0)
        }));

        return { from, to, accounts, transactions };
    });
    ipcMain.handle("reports:getSummary", (event, range = {}) => {
        requireFinanceSession(event);
        const today = new Date().toISOString().slice(0, 10);
        const from = range.from || today;
        const to = range.to || today;
        const validDate = (value) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
            const date = new Date(`${value}T00:00:00.000Z`);
            return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
        };
        if (!validDate(from) || !validDate(to) || from > to) {
            throw new Error("نطاق التاريخ غير صحيح");
        }
        const sales = db.prepare(`
            SELECT COUNT(*) AS count,
                COALESCE(SUM(s.total_amount), 0) - COALESCE((
                    SELECT SUM(sr.total_amount)
                    FROM sales_returns sr
                    WHERE date(sr.created_at, 'localtime') BETWEEN ? AND ?
                ), 0) AS total,
                0 AS paid,
                COALESCE(SUM(remaining_amount), 0) AS remaining,
                COALESCE(SUM(
                    (SELECT COALESCE(SUM(si.total_amount - si.purchase_price * si.quantity), 0)
                     FROM sale_items si WHERE si.sale_id = s.id)
                    - COALESCE(s.plumbing_discount_amount, 0)
                    - COALESCE(s.trader_discount_amount, 0)
                    - COALESCE(s.general_discount_amount, 0)
                ), 0) - COALESCE((
                    SELECT SUM(sri.total_amount - sri.quantity * COALESCE(si.purchase_price, p.purchase_price, 0))
                    FROM sales_returns sr
                    JOIN sales_return_items sri ON sri.return_id = sr.id
                    LEFT JOIN sale_items si ON si.id = sri.sale_item_id
                    LEFT JOIN products p ON p.id = sri.product_id
                    WHERE date(sr.created_at, 'localtime') BETWEEN ? AND ?
                ), 0) AS profit
            FROM sales s
            WHERE date(s.created_at, 'localtime') BETWEEN ? AND ?
                AND s.status IN ('completed', 'consolidated')
                AND NOT (substr(COALESCE(s.notes, ''), 1, ${invoiceGroupPrefix.length}) = '${invoiceGroupPrefix}' AND json_extract(substr(s.notes, ${invoiceGroupPrefix.length + 1}), '$.kind') = 'parent')
        `).get(from, to, from, to, from, to);
        const quickSales = db.prepare(`
            SELECT COUNT(DISTINCT qt.id) AS count, COALESCE(SUM(qi.total_amount), 0) AS total,
                COALESCE(SUM((qi.unit_price - qi.purchase_price) * qi.quantity), 0) AS profit
            FROM quick_transactions qt LEFT JOIN quick_transaction_items qi ON qi.transaction_id = qt.id
            WHERE qt.transaction_type = 'sale' AND date(qt.created_at, 'localtime') BETWEEN ? AND ?
        `).get(from, to);
        const quickReturns = db.prepare(`
            SELECT COALESCE(SUM(qi.total_amount), 0) AS total,
                COALESCE(SUM((qi.unit_price - qi.purchase_price) * qi.quantity), 0) AS profit
            FROM quick_transactions qt LEFT JOIN quick_transaction_items qi ON qi.transaction_id = qt.id
            WHERE qt.transaction_type = 'return' AND date(qt.created_at, 'localtime') BETWEEN ? AND ?
        `).get(from, to);
        sales.count = Number(sales.count || 0) + Number(quickSales.count || 0);
        sales.total = Number(sales.total || 0) + Number(quickSales.total || 0) - Number(quickReturns.total || 0);
        sales.profit = Number(sales.profit || 0) + Number(quickSales.profit || 0) - Number(quickReturns.profit || 0);

        // The parent is omitted above to avoid counting the sections twice.
        // Restore only the direct parent amount and its own item cost.
        const groupedParents = db.prepare(`
            SELECT s.id, s.total_amount, s.remaining_amount, s.notes
            FROM sales s
            WHERE date(s.created_at, 'localtime') BETWEEN ? AND ?
                AND s.status IN ('completed', 'consolidated')
                AND substr(COALESCE(s.notes, ''), 1, ${invoiceGroupPrefix.length}) = '${invoiceGroupPrefix}'
        `).all(from, to);
        for (const parent of groupedParents) {
            const groupInfo = getInvoiceMetadata(parent);
            if (!groupInfo || groupInfo.kind !== 'parent' || !Array.isArray(groupInfo.sectionIds) || !groupInfo.sectionIds.length) continue;
            const marks = groupInfo.sectionIds.map(() => '?').join(',');
            const sectionTotals = db.prepare(`
                SELECT COALESCE(SUM(total_amount), 0) AS total,
                       COALESCE(SUM(remaining_amount), 0) AS remaining
                FROM sales WHERE id IN (${marks})
            `).get(...groupInfo.sectionIds);
            const directAmount = Number(parent.total_amount || 0) - Number(sectionTotals.total || 0);
            sales.total += directAmount;
            sales.remaining += Number(parent.remaining_amount || 0) - Number(sectionTotals.remaining || 0);
            const directCost = Number(db.prepare(`
                SELECT COALESCE(SUM(purchase_price * quantity), 0) AS cost
                FROM sale_items WHERE sale_id = ?
            `).get(parent.id)?.cost || 0);
            sales.profit += directAmount - directCost;
        }

        // Report receipts by the date cash actually entered the register.
        sales.paid = Number(db.prepare(`
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM cash_transactions
            WHERE date(created_at, 'localtime') BETWEEN ? AND ?
              AND direction = 'in'
              AND ((reference_type = 'sale' AND transaction_type IN ('sale', 'payment'))
                OR (reference_type = 'quick_transaction' AND transaction_type = 'quick_sale'))
        `).get(from, to)?.total || 0);
        const purchases = db.prepare(`
            SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS total,
                0 AS paid,
                COALESCE(SUM(remaining_amount), 0) AS remaining
            FROM purchases WHERE date(created_at, 'localtime') BETWEEN ? AND ? AND status = 'completed'
        `).get(from, to);
        purchases.paid = Number(db.prepare(`
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM cash_transactions
            WHERE date(created_at, 'localtime') BETWEEN ? AND ?
              AND direction = 'out' AND reference_type = 'purchase' AND transaction_type IN ('purchase', 'payment')
        `).get(from, to)?.total || 0);
        const expenses = db.prepare(`
            SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
            WHERE date(created_at, 'localtime') BETWEEN ? AND ?
        `).get(from, to);
        const stock = db.prepare(`
            SELECT
                COALESCE(SUM(s.quantity * p.purchase_price), 0) AS value,
                COALESCE(SUM(s.quantity * p.sale_price), 0) AS retailValue
            FROM stock s
            JOIN products p ON p.id = s.product_id
            WHERE p.is_active = 1
        `).get();

        return {
            from,
            to,
            sales,
            purchases,
            expenses: expenses.total,
            stockValue: stock.value,
            stockRetailValue: stock.retailValue
        };
    });

    ipcMain.handle("settings:getAll", () => {
        const values = Object.fromEntries(
            db.prepare(`
                SELECT setting_key, setting_value FROM settings
                WHERE setting_key NOT IN ('deletion_password_salt', 'deletion_password_hash', 'finance_password_salt', 'finance_password_hash')
            `).all().map((row) => [row.setting_key, row.setting_value])
        );
        values.deletion_password_configured = Boolean(
            db.prepare("SELECT 1 FROM settings WHERE setting_key = 'deletion_password_hash'").get()
        );
        values.finance_password_configured = Boolean(
            db.prepare("SELECT 1 FROM settings WHERE setting_key = 'finance_password_hash'").get()
        );
        const securityHashes = db.prepare(`
            SELECT setting_key, setting_value FROM settings
            WHERE setting_key IN ('finance_password_salt', 'finance_password_hash', 'deletion_password_salt', 'deletion_password_hash')
        `).all();
        const securityValues = Object.fromEntries(securityHashes.map((row) => [row.setting_key, row.setting_value]));
        const hasFinance = Boolean(securityValues.finance_password_hash && securityValues.finance_password_salt);
        const hasDeletion = Boolean(securityValues.deletion_password_hash && securityValues.deletion_password_salt);
        values.security_passwords_unified = (!hasFinance && !hasDeletion) || (
            hasFinance && hasDeletion &&
            securityValues.finance_password_hash === securityValues.deletion_password_hash &&
            securityValues.finance_password_salt === securityValues.deletion_password_salt
        );
        return values;
    });

    ipcMain.handle("settings:save", (_event, settings) => {
                const allowed = ["store_name", "store_phone", "store_address", "store_owner_name"];
        const entries = Object.entries(settings || {});
        if (entries.some(([key]) => !allowed.includes(key))) throw new Error("إعداد غير مسموح");
        const save = db.prepare(`
            INSERT INTO settings (setting_key, setting_value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(setting_key) DO UPDATE SET
                setting_value = excluded.setting_value,
                updated_at = CURRENT_TIMESTAMP
        `);
        db.transaction(() => {
            for (const [key, value] of entries) {
                save.run(key, String(value ?? "").trim());
            }
        })();
        return { success: true };
    });

    ipcMain.handle("security:setSharedPassword", (event, currentFinancePassword, currentDeletionPassword, newPassword) => {
        requireMainFrame(event);
        return setSharedSecurityPassword(db, currentFinancePassword, currentDeletionPassword, newPassword);
    });
    ipcMain.handle("finance:isConfigured", () => isFinancePasswordConfigured(db));
    ipcMain.handle("finance:verifyPassword", (event, password) => {
        requireMainFrame(event);
        verifyFinancePassword(db, password);
        const sender = event.sender;
        financeSessions.add(sender.id);
        if (!financeNavigationHooks.has(sender.id)) {
            financeNavigationHooks.add(sender.id);
            sender.on("did-start-navigation", (_navigationEvent, _url, _inPlace, isMainFrame) => {
                if (isMainFrame) financeSessions.delete(sender.id);
            });
            sender.once("destroyed", () => {
                financeSessions.delete(sender.id);
                financeNavigationHooks.delete(sender.id);
            });
        }
        return true;
    });
    ipcMain.handle("finance:lock", (event) => {
        requireMainFrame(event);
        financeSessions.delete(event.sender.id);
        return true;
    });

    ipcMain.handle('operations:getPendingReturnInvoices', async () => {
        try {
            return db.prepare(`
                SELECT
                    s.id AS sale_id,
                    s.invoice_number,
                    COALESCE(c.name, 'عميل نقدي') AS customer_name,
                    c.phone AS customer_phone,
                    s.total_amount,
                    s.paid_amount,
                    SUM(sr.total_amount - COALESCE(sr.cash_refund_amount, 0)) AS pending_refund_amount
                FROM sales_returns sr
                JOIN sales s ON s.id = sr.sale_id
                LEFT JOIN customers c ON c.id = s.customer_id
                GROUP BY s.id
                HAVING pending_refund_amount > 0
                ORDER BY sr.created_at DESC
            `).all();
        } catch(e) {
            console.error('getPendingReturnInvoices error:', e);
            return [];
        }
    });

    ipcMain.handle('sales:getPendingReturnInvoices', async () => {
        try {
            return db.prepare(`
                SELECT
                    s.id AS sale_id,
                    s.invoice_number,
                    COALESCE(c.name, 'عميل نقدي') AS customer_name,
                    c.phone AS customer_phone,
                    s.total_amount,
                    s.paid_amount,
                    SUM(sr.total_amount - COALESCE(sr.cash_refund_amount, 0)) AS pending_refund_amount
                FROM sales_returns sr
                JOIN sales s ON s.id = sr.sale_id
                LEFT JOIN customers c ON c.id = s.customer_id
                GROUP BY s.id
                HAVING pending_refund_amount > 0
                ORDER BY sr.created_at DESC
            `).all();
        } catch(e) {
            console.error('getPendingReturnInvoices error:', e);
            return [];
        }
    });
}

module.exports = registerOperations;
