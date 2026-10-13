const { setDeletionPassword, verifyDeletionPassword } = require("./deletion");

function registerOperations(ipcMain, db) {
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
            SELECT pi.product_id, pi.quantity, pi.unit_cost, pi.list_price,
                pi.plumbing_discount_percent, pi.total_amount AS total,
                p.name, p.unit, l.name AS location_name
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
                db.prepare(`
                    UPDATE products SET purchase_price = ?,
                        purchase_price_manual = COALESCE(?, purchase_price_manual),
                        sale_price = COALESCE(?, sale_price),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(previousCost, previousManual, previousSalePrice, item.product_id);
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
                    SELECT p.id, p.name, p.purchase_price, p.purchase_price_manual,
                        p.sale_price, p.company_discount_percent, c.name AS category_name
                    FROM products p
                    LEFT JOIN categories c ON c.id = p.category_id
                    WHERE p.id = ? AND p.is_active = 1
                `).get(productId);
                if (!product) throw new Error("أحد المنتجات غير موجود أو غير نشط");

                const quantity = finiteNumber(item.quantity, `كمية ${product.name}`, { min: Number.MIN_VALUE });
                const isPlumbing = String(product.category_name || "").trim() === "سباكة";
                let listPrice = null;
                let plumbingDiscountPercent = null;
                let unitCost;
                let salePrice = null;

                if (item.pricing_mode === "discount") {
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
                     plumbing_discount_percent, previous_sale_price)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const productTotals = new Map();
            for (const item of items) {
                const productTotal = productTotals.get(item.productId) || {
                    quantity: 0,
                    total: 0,
                    previousCost: Number(item.product.purchase_price)
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
                    item.salePrice === null ? null : Number(item.product.sale_price)
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
                db.prepare(`
                    UPDATE products SET purchase_price = ?, purchase_price_manual = 1,
                        sale_price = COALESCE(?, sale_price),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(latestNetCost, salePrices.has(productId) ? salePrices.get(productId) : null, productId);
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
        ipcMain.handle(`${entity}:getOutstanding`, () => db.prepare(`
            SELECT ${invoiceTable}.id, ${invoiceTable}.invoice_number,
                ${contactColumn} AS contact_id,
                c.name AS contact_name, ${invoiceTable}.total_amount AS total,
                ${invoiceTable}.paid_amount AS paid,
                ${invoiceTable}.remaining_amount AS remaining, ${invoiceTable}.created_at,
                ${entity === "customers" ? `${invoiceTable}.due_date` : "NULL AS due_date"}
            FROM ${invoiceTable}
            JOIN ${entity} c ON c.id = ${invoiceTable}.${contactColumn}
            WHERE ${invoiceTable}.remaining_amount > 0
                AND ${invoiceTable}.status = 'completed'
            ORDER BY ${entity === "customers" ? `CASE WHEN ${invoiceTable}.due_date IS NULL OR ${invoiceTable}.due_date = '' THEN 1 ELSE 0 END, ${invoiceTable}.due_date ASC,` : ""} ${invoiceTable}.id DESC
            ${entity === "customers" ? "" : "LIMIT 500"}
        `).all());

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

    ipcMain.handle("contacts:recordPayment", (_event, entity, invoiceId, amount) => {
        if (!["customers", "suppliers"].includes(entity)) throw new Error("نوع الحساب غير صحيح");
        const paidAmount = finiteNumber(amount, "مبلغ السداد", { min: Number.MIN_VALUE });
        return db.transaction(() => {
            const isCustomer = entity === "customers";
            const invoiceTable = isCustomer ? "sales" : "purchases";
            const contactColumn = isCustomer ? "customer_id" : "supplier_id";
            const paymentTable = isCustomer ? "sale_payments" : "purchase_payments";
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

            db.prepare(`
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
            db.prepare(`
                INSERT INTO ${paymentTable} (${isCustomer ? "sale_id" : "purchase_id"}, amount, payment_method)
                VALUES (?, ?, 'cash')
            `).run(invoice.id, paidAmount);
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
    ipcMain.handle("cash:getSummary", () => db.prepare(`
        SELECT ca.id, ca.name, ca.opening_balance,
            ca.opening_balance + COALESCE(SUM(
                CASE WHEN ct.direction = 'in' THEN ct.amount ELSE -ct.amount END
            ), 0) AS balance
        FROM cash_accounts ca
        LEFT JOIN cash_transactions ct ON ct.cash_account_id = ca.id
        WHERE ca.is_active = 1
        GROUP BY ca.id
        ORDER BY ca.id
    `).all());

    ipcMain.handle("cash:getTransactions", () => db.prepare(`
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
    `).all());

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

    ipcMain.handle("cash:deleteExpense", (_event, expenseId) => db.transaction(() => {
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
    })());

    ipcMain.handle("cash:deleteManualTransaction", (_event, transactionId) => db.transaction(() => {
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
    })());

    ipcMain.handle("cash:addTransaction", (_event, entry) => db.transaction(() => {
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
    })());

    // Printable cash statement for the same date range selected in Reports.
    ipcMain.handle("cash:getStatement", (_event, range = {}) => {
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
    ipcMain.handle("reports:getSummary", (_event, range = {}) => {
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
                COALESCE(SUM(paid_amount), 0) AS paid,
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
            WHERE date(s.created_at, 'localtime') BETWEEN ? AND ? AND s.status = 'completed'
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
        sales.total = Number(sales.total || 0) + Number(quickSales.total || 0) - Number(quickReturns.total || 0);
        sales.paid = Number(sales.paid || 0) + Number(quickSales.total || 0) - Number(quickReturns.total || 0);
        sales.profit = Number(sales.profit || 0) + Number(quickSales.profit || 0) - Number(quickReturns.profit || 0);
        const purchases = db.prepare(`
            SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS total,
                COALESCE(SUM(paid_amount), 0) AS paid,
                COALESCE(SUM(remaining_amount), 0) AS remaining
            FROM purchases WHERE date(created_at, 'localtime') BETWEEN ? AND ? AND status = 'completed'
        `).get(from, to);
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
                WHERE setting_key NOT IN ('deletion_password_salt', 'deletion_password_hash')
            `).all().map((row) => [row.setting_key, row.setting_value])
        );
        values.deletion_password_configured = Boolean(
            db.prepare("SELECT 1 FROM settings WHERE setting_key = 'deletion_password_hash'").get()
        );
        return values;
    });

    ipcMain.handle("settings:save", (_event, settings) => {
        const allowed = ["store_name", "store_phone", "store_address"];
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

    ipcMain.handle("settings:setDeletionPassword", (_event, currentPassword, newPassword) =>
        setDeletionPassword(db, currentPassword, newPassword)
    );
}

module.exports = registerOperations;
