const { app, BrowserWindow, dialog, ipcMain, screen } = require("electron");
const path = require("path");
const splashController = require("./src/splash-main");
let splashWindow = null;
let mainWindow = null;
let startupHasFailed = false;
let startupIsComplete = false;
let mainRendererReady = false;
let resolveMainReady;
let rejectMainReady;

function reportStartupProgress(progress, status) {
    splashController.progress(progress, status);
}

function showStartupError(error) {
    if (startupHasFailed) return;
    startupHasFailed = true;
    console.error("El-Sharq startup failed:", error);
    rejectMainReady?.(error instanceof Error ? error : new Error(String(error)));
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send("startup:error");
        splashWindow.show();
    }
}

app.on("el-sharq-startup-progress", ({ progress, status }) => {
    reportStartupProgress(progress, status);
});

ipcMain.on("startup:show-error", (event) => {
    if (event.sender !== splashWindow?.webContents) return;
    if (startupHasFailed) {
        splashWindow.show();
        splashWindow.focus();
    }
});

ipcMain.on("startup:failed", (event, message) => {
    if (event.sender !== splashWindow?.webContents) return;
    showStartupError(new Error(String(message || "Startup renderer failed")));
});

ipcMain.on("startup:main-ready", (event) => {
    if (event.sender === mainWindow?.webContents && !startupHasFailed) {
        mainRendererReady = true;
        if (resolveMainReady) {
            resolveMainReady();
            resolveMainReady = null;
        }
    }
});

ipcMain.on("startup:main-failed", (event, message) => {
    if (event.sender === mainWindow?.webContents) {
        const error = new Error(String(message || "Dashboard initialization failed"));
        rejectMainReady?.(error);
        rejectMainReady = null;
        showStartupError(error);
    }
});

ipcMain.on("startup:retry", (event) => {
    if (event.sender !== splashWindow?.webContents || !startupHasFailed) return;
    app.relaunch();
    app.exit(0);
});

ipcMain.on("startup:quit", (event) => {
    if (event.sender === splashWindow?.webContents) app.quit();
});

function initializeBackend() {
    const db = require("./src/database/database");
    const registerOperations = require("./src/database/operations");
    const { verifyDeletionPassword } = require("./src/database/deletion");
    registerOperations(ipcMain, db);

    ipcMain.handle("database:backup", async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
        title: "حفظ نسخة احتياطية من قاعدة بيانات الشرق",
        defaultPath: `el-sharq-backup-${stamp}.db`,
        filters: [{ name: "SQLite database", extensions: ["db"] }]
    });
    if (result.canceled) return { success: false, canceled: true };
    if (!result.filePath) throw new Error("لم يتم تحديد مكان حفظ النسخة الاحتياطية");
    await db.backup(result.filePath);
    return { success: true, filePath: result.filePath };
});

function nonNegativeNumber(value, label) {
    const number = Number(value ?? 0);
    if (!Number.isFinite(number) || number < 0) {
        throw new Error(`${label} غير صحيح`);
    }
    return number;
}

function isPlumbingPipe(name, categoryName) {
    return categoryName === "سباكة" && /^مواسير(?:\s|$)/u.test(String(name || "").trim());
}

function isRedexProduct(name) {
    return /ريدكس|redex/iu.test(String(name || ""));
}

function normalizeRedexProductCode(name, code) {
    const normalizedCode = String(code || "").trim();
    if (!isRedexProduct(name)) {
        return normalizedCode;
    }
    if (/^RD(?:-|$)/i.test(normalizedCode)) return `RD${normalizedCode.slice(2)}`;
    return `RD-${normalizedCode}`;
}

const migrateRedexProductCodes = db.transaction(() => {
    const redexProducts = db.prepare(`
        SELECT id, name, internal_code
        FROM products
        WHERE lower(name) LIKE '%redex%' OR name LIKE '%ريدكس%'
    `).all();
    const updateCode = db.prepare("UPDATE products SET internal_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    const findDuplicate = db.prepare("SELECT id FROM products WHERE internal_code = ? AND id != ?");

    for (const product of redexProducts) {
        const baseCode = normalizeRedexProductCode(product.name, product.internal_code);
        if (baseCode === product.internal_code) continue;

        let code = baseCode;
        let suffix = 1;
        while (findDuplicate.get(code, product.id)) {
            code = `${baseCode}-${suffix++}`;
        }
        updateCode.run(code, product.id);
    }
});
migrateRedexProductCodes();


// =========================
// GET LOCATIONS
// =========================

ipcMain.handle("locations:getAll", () => {
    return db.prepare(`SELECT id, name, type FROM locations WHERE is_active = 1 ORDER BY name`).all();
});

// =========================
// GET PRODUCTS
// =========================

ipcMain.handle("products:getAll", () => {

    const products = db.prepare(`
        SELECT
            p.id,
            p.name,
            p.internal_code,
            p.barcode,
            p.category_id,
            p.unit,
            p.purchase_price,
            p.purchase_price_manual,
            p.sale_price,
            p.minimum_stock AS min_stock,
            p.is_active AS active,
            p.tile_length_cm,
            p.tile_width_cm,
            p.tiles_per_carton,
            p.company_discount_percent,
            c.name AS category_name
        FROM products p
        LEFT JOIN categories c
            ON c.id = p.category_id
        ORDER BY p.id DESC
    `).all();

    // ضم المخزون
    for (const p of products) {
        const stockRows = db.prepare(`
            SELECT l.name AS loc_name, s.quantity
            FROM stock s
            JOIN locations l ON l.id = s.location_id
            WHERE s.product_id = ?
        `).all(p.id);
        p.stock = stockRows;
        for (const s of stockRows) {
            if (s.loc_name === "المعرض") p.showroom_quantity = s.quantity;
            if (s.loc_name === "المخزن") p.warehouse_quantity = s.quantity;
        }
    }

    return products;

});

ipcMain.handle("products:delete", (_event, productId, password) => {
    verifyDeletionPassword(db, password);
    return db.transaction(() => {
        const id = Number(productId);
        const product = db.prepare("SELECT id, name FROM products WHERE id = ?").get(id);
        if (!product) throw new Error("الصنف غير موجود");

        const references = [
            ["sale_items", "product_id"],
            ["purchase_items", "product_id"],
            ["sales_return_items", "product_id"],
            ["purchase_return_items", "product_id"],
            ["stock_movements", "product_id"],
            ["product_set_items", "product_id"]
        ];
        const hasHistory = references.some(([table, column]) =>
            db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`).get(id)
        );
        if (hasHistory) {
            db.prepare(`
                UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(id);
            return { success: true, archived: true, name: product.name };
        }

        db.prepare("DELETE FROM stock WHERE product_id = ?").run(id);
        db.prepare("DELETE FROM products WHERE id = ?").run(id);
        return { success: true, archived: false, name: product.name };
    })();
});

// =========================
// GET PRODUCT BY ID
// =========================

ipcMain.handle("products:getById", (_e, id) => {
    const p = db.prepare(`
        SELECT
            p.id,
            p.name,
            p.internal_code,
            p.barcode,
            p.category_id,
            p.unit,
            p.purchase_price,
            p.purchase_price_manual,
            p.sale_price,
            p.minimum_stock AS min_stock,
            p.is_active AS active,
            p.tile_length_cm,
            p.tile_width_cm,
            p.tiles_per_carton,
            p.company_discount_percent,
            c.name AS category_name
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = ?
    `).get(Number(id));

    if (!p) return null;

    const stockRows = db.prepare(`
        SELECT l.name AS loc_name, s.quantity
        FROM stock s
        JOIN locations l ON l.id = s.location_id
        WHERE s.product_id = ?
    `).all(p.id);
    p.stock = stockRows;
    for (const s of stockRows) {
        if (s.loc_name === "المعرض") p.showroom_quantity = s.quantity;
        if (s.loc_name === "المخزن") p.warehouse_quantity = s.quantity;
    }

    return p;
});


// =========================
// GET CATEGORIES
// =========================

ipcMain.handle("categories:getAll", () => {

    return db.prepare(`
        SELECT
            id,
            name
        FROM categories
        ORDER BY name
    `).all();

});


// =========================
// ADD PRODUCT
// =========================

ipcMain.handle("products:add", (event, product) => {

    const transaction = db.transaction(() => {

        if (!product.name || !product.name.trim()) {
            throw new Error("اسم المنتج مطلوب");
        }
        if (!product.internal_code || !product.internal_code.trim()) {
            throw new Error("كود المنتج مطلوب");
        }
        const internalCode = normalizeRedexProductCode(product.name, product.internal_code);
        const barcode = product.barcode?.trim() || null;

        const categoryId = Number(product.category_id);
        if (!Number.isInteger(categoryId) || categoryId <= 0) {
            throw new Error("القسم مطلوب");
        }

        // احسب اسم القسم عشان نطبق منطق السباكه
        const categoryRow = db.prepare(
            "SELECT name FROM categories WHERE id = ? AND is_active = 1"
        ).get(categoryId);
        if (!categoryRow) throw new Error("القسم غير موجود أو غير نشط");
        const categoryName = categoryRow.name;
        const unit = isPlumbingPipe(product.name, categoryName) ? "متر" : (product.unit || "قطعة");

        const salePrice = nonNegativeNumber(product.sale_price, "سعر البيع");

        // خصم الشركة للسباكه
        let companyDiscountPercent = 0;
        if (categoryName === "سباكة") {
            companyDiscountPercent = Math.max(0, Math.min(100, nonNegativeNumber(product.company_discount_percent, "خصم الشركة")));
        } else {
            companyDiscountPercent = nonNegativeNumber(product.company_discount_percent, "خصم الشركة");
        }

        // سعر الشراء: إما المُدخل أو المحسوب تلقائي للسباكه
        let purchasePrice = nonNegativeNumber(product.purchase_price, "سعر الشراء");
        if (categoryName === "سباكة" && !product.purchase_price_manual) {
            purchasePrice = salePrice * (1 - companyDiscountPercent / 100);
        }
        const purchasePriceManual = product.purchase_price_manual ? 1 : 0;
        const minStock = nonNegativeNumber(product.min_stock ?? product.minimum_stock, "الحد الأدنى للمخزون");
        const showroomQty = nonNegativeNumber(product.showroom_quantity, "كمية المعرض");
        const warehouseQty = nonNegativeNumber(product.warehouse_quantity, "كمية المخزن");

        // سيراميك
        let tileLengthCm = product.tile_length_cm ? nonNegativeNumber(product.tile_length_cm, "طول البلاطة") : null;
        let tileWidthCm = product.tile_width_cm ? nonNegativeNumber(product.tile_width_cm, "عرض البلاطة") : null;
        let tilesPerCarton = product.tiles_per_carton ? nonNegativeNumber(product.tiles_per_carton, "عدد البلاطات") : null;
        if (categoryName !== "سيراميك") {
            tileLengthCm = null;
            tileWidthCm = null;
            tilesPerCarton = null;
        }

        // =========================
        // CHECK DUPLICATE CODE
        // =========================

        const existing =
            db.prepare(`SELECT id FROM products WHERE internal_code = ?`).get(
                internalCode
            );

        if (existing) {
            throw new Error("كود المنتج مستخدم بالفعل");
        }
        if (barcode && db.prepare("SELECT id FROM products WHERE barcode = ?").get(barcode)) {
            throw new Error("الباركود مستخدم بالفعل");
        }

        // =========================
        // INSERT PRODUCT
        // =========================

        const result =
            db.prepare(`
                INSERT INTO products (
                    internal_code,
                    barcode,
                    name,
                    category_id,
                    unit,
                    purchase_price,
                    sale_price,
                    minimum_stock,
                    is_active,
                    tile_length_cm,
                    tile_width_cm,
                    tiles_per_carton,
                    company_discount_percent,
                    purchase_price_manual
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
            `).run(
                internalCode,
                barcode,
                product.name.trim(),
                categoryId,
                unit,
                purchasePrice,
                salePrice,
                minStock,
                tileLengthCm,
                tileWidthCm,
                tilesPerCarton,
                companyDiscountPercent,
                purchasePriceManual
            );

        const productId = result.lastInsertRowid;


        // =========================
        // GET LOCATIONS
        // =========================

        const locations =
            db.prepare(`
                SELECT
                    id,
                    name
                FROM locations
                WHERE name IN ('المعرض', 'المخزن')
            `).all();


        // =========================
        // INSERT INITIAL STOCK
        // =========================

        const insertStock =
            db.prepare(`
                INSERT INTO stock (
                    product_id,
                    location_id,
                    quantity
                )
                VALUES (?, ?, ?)
            `);


        for (const location of locations) {

            let quantity = 0;


            if (location.name === "المعرض") {

                quantity =
                    showroomQty;

            }


            if (location.name === "المخزن") {

                quantity =
                    warehouseQty;

            }


            insertStock.run(
                productId,
                location.id,
                quantity
            );
            if (quantity > 0) {
                db.prepare(`
                    INSERT INTO stock_movements
                        (product_id, location_id, movement_type, quantity, reference_type, reference_id, notes)
                    VALUES (?, ?, 'adjustment', ?, 'product', ?, 'رصيد افتتاحي')
                `).run(productId, location.id, quantity, productId);
            }

        }


        // =========================
        // RESULT
        // =========================

        return {
            success: true,
            productId
        };

    });

    return transaction();

});


// =========================
// UPDATE PRODUCT
// =========================

ipcMain.handle("products:update", (e, id, product) => {
    const transaction = db.transaction(() => {
        id = Number(id);
        const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
        if (!existing) throw new Error("المنتج غير موجود");

        if (!product.name || !product.name.trim()) throw new Error("اسم المنتج مطلوب");
        if (!product.internal_code || !product.internal_code.trim()) throw new Error("كود المنتج مطلوب");
        const internalCode = normalizeRedexProductCode(product.name, product.internal_code);
        const barcode = product.barcode?.trim() || null;

        const categoryId = Number(product.category_id);
        if (!Number.isInteger(categoryId) || categoryId <= 0) throw new Error("القسم مطلوب");

        const categoryRow = db.prepare(
            "SELECT name FROM categories WHERE id = ? AND is_active = 1"
        ).get(categoryId);
        if (!categoryRow) throw new Error("القسم غير موجود أو غير نشط");
        const categoryName = categoryRow.name;
        const unit = isPlumbingPipe(product.name, categoryName) ? "متر" : (product.unit || "قطعة");

        const salePrice = nonNegativeNumber(product.sale_price, "سعر البيع");

        // خصم الشركة للسباكه
        let companyDiscountPercent = 0;
        if (categoryName === "سباكة") {
            companyDiscountPercent = Math.max(0, Math.min(100, nonNegativeNumber(product.company_discount_percent, "خصم الشركة")));
        } else {
            companyDiscountPercent = nonNegativeNumber(product.company_discount_percent, "خصم الشركة");
        }

        // سعر الشراء
        let purchasePrice = nonNegativeNumber(product.purchase_price, "سعر الشراء");
        if (categoryName === "سباكة" && !product.purchase_price_manual) {
            purchasePrice = salePrice * (1 - companyDiscountPercent / 100);
        }
        const purchasePriceManual = product.purchase_price_manual ? 1 : 0;
        const minStock = nonNegativeNumber(product.min_stock ?? product.minimum_stock, "الحد الأدنى للمخزون");
        const showroomQty = nonNegativeNumber(product.showroom_quantity, "كمية المعرض");
        const warehouseQty = nonNegativeNumber(product.warehouse_quantity, "كمية المخزن");

        // سيراميك
        let tileLengthCm = product.tile_length_cm ? nonNegativeNumber(product.tile_length_cm, "طول البلاطة") : null;
        let tileWidthCm = product.tile_width_cm ? nonNegativeNumber(product.tile_width_cm, "عرض البلاطة") : null;
        let tilesPerCarton = product.tiles_per_carton ? nonNegativeNumber(product.tiles_per_carton, "عدد البلاطات") : null;
        if (categoryName !== "سيراميك") {
            tileLengthCm = null;
            tileWidthCm = null;
            tilesPerCarton = null;
        }

        // تكرار الكود
        const dup = db.prepare("SELECT id FROM products WHERE internal_code = ? AND id != ?").get(
            internalCode, id
        );
        if (dup) throw new Error("كود المنتج مستخدم بالفعل");
        if (barcode && db.prepare("SELECT id FROM products WHERE barcode = ? AND id != ?").get(barcode, id)) {
            throw new Error("الباركود مستخدم بالفعل");
        }

        db.prepare(`
            UPDATE products SET
                internal_code = ?,
                barcode = ?,
                name = ?,
                category_id = ?,
                unit = ?,
                purchase_price = ?,
                sale_price = ?,
                minimum_stock = ?,
                is_active = ?,
                tile_length_cm = ?,
                tile_width_cm = ?,
                tiles_per_carton = ?,
                company_discount_percent = ?,
                purchase_price_manual = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            internalCode,
            barcode,
            product.name.trim(),
            categoryId,
            unit,
            purchasePrice,
            salePrice,
            minStock,
            product.active === 0 || product.active === false ? 0 : 1,
            tileLengthCm,
            tileWidthCm,
            tilesPerCarton,
            companyDiscountPercent,
            purchasePriceManual,
            id
        );

        // تحديث المخزون (الكميات اللي في المعرض والمخزن)
        const locations = db.prepare("SELECT id, name FROM locations WHERE name IN ('المعرض','المخزن')").all();
        for (const loc of locations) {
            const qty = loc.name === "المعرض"
                ? showroomQty
                : warehouseQty;
            const srow = db.prepare("SELECT id, quantity FROM stock WHERE product_id = ? AND location_id = ?").get(id, loc.id);
            if (srow) {
                db.prepare("UPDATE stock SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(qty, srow.id);
                const difference = qty - Number(srow.quantity);
                if (difference !== 0) {
                    db.prepare(`
                        INSERT INTO stock_movements
                            (product_id, location_id, movement_type, quantity, reference_type, reference_id, notes)
                        VALUES (?, ?, 'adjustment', ?, 'product', ?, 'تسوية من تعديل بيانات المنتج')
                    `).run(id, loc.id, difference, id);
                }
            } else {
                db.prepare("INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)").run(id, loc.id, qty);
                if (qty > 0) {
                    db.prepare(`
                        INSERT INTO stock_movements
                            (product_id, location_id, movement_type, quantity, reference_type, reference_id, notes)
                        VALUES (?, ?, 'adjustment', ?, 'product', ?, 'رصيد افتتاحي')
                    `).run(id, loc.id, qty, id);
                }
            }
        }

        return { success: true, productId: id };
    });
    return transaction();
});


// =========================
// PRODUCT SETS HANDLERS (الأطقم)
// =========================

function normalizeProductSet(set, excludingId = null) {
    if (!set || typeof set !== "object") throw new Error("بيانات الطقم غير صحيحة");
    const name = set.name?.trim();
    const setCode = set.set_code?.trim() || null;
    if (!name) throw new Error("اسم الطقم مطلوب");
    const categoryId = Number(set.category_id);
    const category = db.prepare(`
        SELECT id, name FROM categories
        WHERE id = ? AND is_active = 1 AND name IN ('أدوات صحية', 'خلاطات')
    `).get(categoryId);
    if (!category) throw new Error("اختر قسمًا صالحًا للطقم");
    const salePrice = nonNegativeNumber(set.sale_price, "سعر البيع");
    if (setCode) {
        const duplicate = excludingId
            ? db.prepare("SELECT id FROM product_sets WHERE set_code = ? AND id != ?").get(setCode, excludingId)
            : db.prepare("SELECT id FROM product_sets WHERE set_code = ?").get(setCode);
        if (duplicate) throw new Error("كود الطقم مستخدم بالفعل");
    }
    if (!Array.isArray(set.items) || set.items.length === 0) {
        throw new Error("أضف مكونًا واحدًا على الأقل للطقم");
    }
    const combinedItems = new Map();
    for (const item of set.items) {
        const productId = Number(item.product_id);
        const product = db.prepare(`
            SELECT p.id FROM products p
            JOIN categories c ON c.id = p.category_id
            WHERE p.id = ? AND p.is_active = 1
                AND c.name IN ('أدوات صحية', 'خلاطات')
        `).get(productId);
        if (!product) throw new Error("أحد مكونات الطقم غير موجود أو غير نشط");
        const quantity = Number(item.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("كمية مكون الطقم غير صحيحة");
        combinedItems.set(productId, (combinedItems.get(productId) || 0) + quantity);
    }
    return {
        name,
        setCode,
        categoryId,
        salePrice,
        description: set.description?.trim() || null,
        items: [...combinedItems].map(([product_id, quantity]) => ({ product_id, quantity }))
    };
}

ipcMain.handle("productSets:getAll", () => {
    const sets = db.prepare(`
        SELECT ps.*, c.name AS category_name
        FROM product_sets ps
        LEFT JOIN categories c ON c.id = ps.category_id
        ORDER BY ps.id DESC
    `).all();
    for (const s of sets) {
        s.items = db.prepare(`
            SELECT psi.id, psi.product_id, psi.quantity, p.name AS product_name, p.sale_price
            FROM product_set_items psi
            JOIN products p ON p.id = psi.product_id
            WHERE psi.set_id = ?
        `).all(s.id);
    }
    return sets;
});

ipcMain.handle("productSets:getSanitaryProducts", () => {
    return db.prepare(`
        SELECT p.id, p.name, p.internal_code, p.sale_price, p.unit, c.name AS category_name
        FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE c.name IN ('أدوات صحية', 'خلاطات')
          AND p.is_active = 1
        ORDER BY c.name, p.name
    `).all();
});

ipcMain.handle("productSets:add", (_e, set) => {
    const transaction = db.transaction(() => {
        const normalized = normalizeProductSet(set);
        const result = db.prepare(`
            INSERT INTO product_sets (set_code, name, category_id, sale_price, description)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            normalized.setCode,
            normalized.name,
            normalized.categoryId,
            normalized.salePrice,
            normalized.description
        );
        const setId = Number(result.lastInsertRowid);
        const ins = db.prepare(`
            INSERT INTO product_set_items (set_id, product_id, quantity) VALUES (?, ?, ?)
        `);
        for (const item of normalized.items) {
            ins.run(setId, item.product_id, item.quantity);
        }
        return { success: true, setId };
    });
    return transaction();
});

ipcMain.handle("productSets:update", (_e, id, set) => {
    const transaction = db.transaction(() => {
        id = Number(id);
        if (!db.prepare("SELECT id FROM product_sets WHERE id = ?").get(id)) {
            throw new Error("الطقم غير موجود");
        }
        const normalized = normalizeProductSet(set, id);
        db.prepare(`
            UPDATE product_sets
            SET set_code = ?, name = ?, category_id = ?, sale_price = ?,
                description = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(normalized.setCode, normalized.name, normalized.categoryId, normalized.salePrice, normalized.description, id);
        db.prepare("DELETE FROM product_set_items WHERE set_id = ?").run(id);
        const insertItem = db.prepare(`
            INSERT INTO product_set_items (set_id, product_id, quantity) VALUES (?, ?, ?)
        `);
        for (const item of normalized.items) {
            insertItem.run(id, item.product_id, item.quantity);
        }
        return { success: true, setId: id };
    });
    return transaction();
});

ipcMain.handle("productSets:setActive", (_e, id, active) => {
    const result = db.prepare(`
        UPDATE product_sets SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(active ? 1 : 0, Number(id));
    if (result.changes !== 1) throw new Error("الطقم غير موجود");
    return { success: true };
});


// =========================
// SALES: القائمة + الحصول على فاتورة + تعديل
// =========================

ipcMain.handle("sales:getAll", (_e, filter = "normal") => {
    // filter: 'normal' = المبيعات العادية (cash/credit)، 'plumbing_order' = طلبيه سباكه، 'all' = الكل
    let rows;
    const baseSelect = `
            SELECT
                s.*,
                s.total_amount AS total,
                s.paid_amount AS paid,
                s.remaining_amount AS remaining,
                c.name AS customer_name
            FROM sales s
            LEFT JOIN customers c ON c.id = s.customer_id
    `;
    if (filter === "all") {
        rows = db.prepare(baseSelect + `
            ORDER BY s.id DESC
            LIMIT 100
        `).all();
    } else if (filter === "plumbing_order") {
        rows = db.prepare(baseSelect + `
            WHERE s.sale_type = 'plumbing_order'
            ORDER BY s.id DESC
            LIMIT 100
        `).all();
    } else {
        rows = db.prepare(baseSelect + `
            WHERE (s.sale_type IS NULL OR s.sale_type != 'plumbing_order')
            ORDER BY s.id DESC
            LIMIT 100
        `).all();
    }
    return rows;
});

ipcMain.handle("sales:getById", (_e, id) => {
    id = Number(id);
    const sale = db.prepare(`
        SELECT
            s.*,
            s.total_amount AS total,
            s.paid_amount AS paid,
            s.remaining_amount AS remaining,
            c.name AS customer_name,
            l.name AS location_name
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        LEFT JOIN locations l ON l.id = s.location_id
        WHERE s.id = ?
    `).get(id);
    if (!sale) return null;
    sale.items = db.prepare(`
        SELECT
            si.*,
            si.total_amount AS total,
            si.unit_price AS unitPrice,
            si.purchase_price AS purchasePrice,
            p.name AS product_name,
            CASE WHEN cat.name IS NOT NULL AND cat.name != '' THEN cat.name || ' ' || p.name ELSE p.name END AS name,
            p.unit AS product_unit,
            p.unit AS unit,
            cat.name AS category_name,
            p.tiles_per_carton,
            p.tile_length_cm,
            p.tile_width_cm
        FROM sale_items si
        JOIN products p ON p.id = si.product_id
        LEFT JOIN categories cat ON cat.id = p.category_id
        WHERE si.sale_id = ?
    `).all(id);
    sale.payments = db.prepare(`
        SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY id
    `).all(id);
    return sale;
});

ipcMain.handle("sales:delete", (_event, saleId, password) => {
    verifyDeletionPassword(db, password);
    return db.transaction(() => {
        const id = Number(saleId);
        const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(id);
        if (!sale) throw new Error("فاتورة البيع غير موجودة");
        if (db.prepare("SELECT 1 FROM sales_returns WHERE sale_id = ? LIMIT 1").get(id)) {
            throw new Error("لا يمكن حذف الفاتورة لوجود مرتجع مرتبط بها");
        }

        const items = db.prepare(`
            SELECT product_id, location_id, SUM(quantity) AS quantity
            FROM sale_items WHERE sale_id = ?
            GROUP BY product_id, location_id
        `).all(id);
        for (const item of items) {
            const stock = db.prepare(`
                SELECT id FROM stock WHERE product_id = ? AND location_id = ?
            `).get(item.product_id, item.location_id);
            if (!stock) throw new Error("تعذر إرجاع كمية الفاتورة إلى المخزون");
        }

        for (const item of items) {
            db.prepare(`
                UPDATE stock SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
                WHERE product_id = ? AND location_id = ?
            `).run(item.quantity, item.product_id, item.location_id);
            db.prepare(`
                INSERT INTO stock_movements
                    (product_id, location_id, movement_type, quantity, reference_type, reference_id, notes)
                VALUES (?, ?, 'return', ?, 'sale_delete', ?, ?)
            `).run(
                item.product_id,
                item.location_id,
                item.quantity,
                id,
                `حذف فاتورة البيع ${sale.invoice_number}`
            );
        }

        db.prepare(`
            DELETE FROM customer_transactions
            WHERE reference_type = 'sale' AND reference_id = ?
        `).run(id);
        db.prepare(`
            DELETE FROM cash_transactions
            WHERE reference_type = 'sale' AND reference_id = ?
        `).run(id);
        db.prepare("DELETE FROM sales WHERE id = ?").run(id);
        return { success: true };
    })();
});

// =========================
// SAVE SALE
// =========================

ipcMain.handle("sales:create", (event, sale) => {

    const transaction = db.transaction(() => {

        // =========================
        // VALIDATION
        // =========================

        if (
            !sale ||
            !Array.isArray(sale.items) ||
            sale.items.length === 0
        ) {
            throw new Error(
                "يجب إضافة صنف واحد على الأقل للفاتورة"
            );
        }


        const location =
            sale.location === "المخزن"
                ? "المخزن"
                : "المعرض";


        const customerName =
            sale.customer_name?.trim() || null;


        const notes =
            sale.notes?.trim() || null;


        const plumbingDiscountPercent =
            Math.max(
                0,
                Math.min(
                    100,
                    Number(
                        sale.plumbing_discount_percent || 0
                    )
                )
            );


        // =========================
        // GET LOCATION
        // =========================

        const locationRow =
            db.prepare(`
                SELECT id
                FROM locations
                WHERE name = ?
            `).get(location);


        if (!locationRow) {

            throw new Error(
                "مكان البيع غير موجود"
            );

        }


        // =========================
        // CALCULATE TOTALS
        // =========================

        let subtotal = 0;

        let plumbingSubtotal = 0;

        const preparedItems = [];


        for (const item of sale.items) {

            const productId =
                Number(item.product_id);

            const quantity =
                Number(item.quantity);

            const unitPrice =
                Number(item.unit_price);


            if (!productId) {

                throw new Error(
                    "يوجد صنف غير صحيح في الفاتورة"
                );

            }


            if (
                !quantity ||
                quantity <= 0
            ) {

                throw new Error(
                    "كمية أحد الأصناف غير صحيحة"
                );

            }


            if (
                unitPrice < 0 ||
                Number.isNaN(unitPrice)
            ) {

                throw new Error(
                    "سعر أحد الأصناف غير صحيح"
                );

            }


            const product =
                db.prepare(`
                    SELECT
                        p.id,
                        p.name,
                        p.purchase_price,
                        p.sale_price,
                        c.name AS category_name
                    FROM products p
                    LEFT JOIN categories c
                        ON c.id = p.category_id
                    WHERE p.id = ?
                      AND p.is_active = 1
                `).get(productId);


            if (!product) {

                throw new Error(
                    "أحد المنتجات غير موجود أو غير نشط"
                );

            }


            // =========================
            // CHECK STOCK
            // =========================

            const stockRow =
                db.prepare(`
                    SELECT quantity
                    FROM stock
                    WHERE product_id = ?
                      AND location_id = ?
                `).get(
                    productId,
                    locationRow.id
                );


            const available =
                Number(
                    stockRow?.quantity || 0
                );


            if (quantity > available) {

                throw new Error(
                    `الكمية المطلوبة من "${product.name}" أكبر من المتاح في ${location}`
                );

            }


            const total =
                quantity *
                unitPrice;


            subtotal += total;


            if (
                product.category_name ===
                "سباكة"
            ) {

                plumbingSubtotal +=
                    total;

            }


            preparedItems.push({

                productId,

                quantity,

                unitPrice,

                total,

                purchasePrice:
                    Number(
                        product.purchase_price || 0
                    )

            });

        }


        // =========================
        // PLUMBING DISCOUNT
        // =========================

        const plumbingDiscountAmount =
            plumbingSubtotal *
            plumbingDiscountPercent /
            100;


        const grandTotal =
            subtotal -
            plumbingDiscountAmount;


        const paid =
            Math.max(
                0,
                Number(sale.paid || 0)
            );


        if (paid > grandTotal) {

            throw new Error(
                "المبلغ المدفوع أكبر من إجمالي الفاتورة"
            );

        }


        const remaining =
            grandTotal - paid;


        // =========================
        // CUSTOMER
        // =========================

        let customerId = null;

        if (customerName) {
            const existingCustomer =
                db.prepare(`SELECT id FROM customers WHERE name = ? LIMIT 1`).get(customerName);
            if (existingCustomer) {
                customerId = existingCustomer.id;
            } else {
                const newCustomer =
                    db.prepare(`INSERT INTO customers (name, is_active) VALUES (?, 1)`).run(customerName);
                customerId = newCustomer.lastInsertRowid;
            }
        }

        // نوع الفاتورة: نقدي أو آجل
        const saleType = (remaining > 0 ? "credit" : "cash");

        // =========================
        // CREATE SALE
        // =========================

        const nextSaleId = db.prepare(
            "SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM sales"
        ).get().nextId;
        const invoiceNumber = `S-${String(nextSaleId).padStart(6, "0")}`;
        const saleResult =
            db.prepare(`
                INSERT INTO sales (
                    invoice_number,
                    customer_id,
                    location_id,
                    sale_type,
                    subtotal,
                    plumbing_discount_percent,
                    plumbing_discount_amount,
                    general_discount_amount,
                    total_amount,
                    paid_amount,
                    remaining_amount,
                    notes,
                    status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'completed')
            `).run(
                invoiceNumber,
                customerId,
                locationRow.id,
                saleType,
                subtotal,
                plumbingDiscountPercent,
                plumbingDiscountAmount,
                grandTotal,
                paid,
                remaining,
                notes
            );

        const saleId = saleResult.lastInsertRowid;


        // =========================
        // INSERT SALE ITEMS
        // =========================

        const insertItem =
            db.prepare(`
                INSERT INTO sale_items (
                    sale_id,
                    product_id,
                    location_id,
                    quantity,
                    unit_price,
                    total_amount,
                    purchase_price
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);


        for (const item of preparedItems) {

            insertItem.run(
                saleId,
                item.productId,
                locationRow.id,   // location_id
                item.quantity,
                item.unitPrice,
                item.total,       // total_amount
                item.purchasePrice
            );


            // =========================
            // DECREASE STOCK
            // =========================

            db.prepare(`
                UPDATE stock
                SET quantity = quantity - ?
                WHERE product_id = ?
                  AND location_id = ?
            `).run(

                item.quantity,

                item.productId,

                locationRow.id

            );


            // =========================
            // STOCK MOVEMENT
            // =========================

            db.prepare(`
                INSERT INTO stock_movements (
                    product_id,
                    location_id,
                    movement_type,
                    quantity,
                    reference_type,
                    reference_id
                )
                VALUES (
                    ?,
                    ?,
                    'sale',
                    ?,
                    'sale',
                    ?
                )
            `).run(

                item.productId,

                locationRow.id,

                -item.quantity,

                saleId

            );

        }


        // =========================
        // SALE PAYMENT
        // =========================

        if (paid > 0) {

            const cashAccount =
                db.prepare(`
                    SELECT id
                    FROM cash_accounts
                    WHERE name = 'الخزنة الرئيسية'
                    LIMIT 1
                `).get();


            if (!cashAccount) {

                throw new Error(
                    "الخزنة الرئيسية غير موجودة"
                );

            }


            db.prepare(`
                INSERT INTO sale_payments (
                    sale_id,
                    amount,
                    payment_method
                )
                VALUES (?, ?, 'cash')
            `).run(
                saleId,
                paid
            );


            // =========================
            // CASH TRANSACTION
            // =========================

            db.prepare(`
                INSERT INTO cash_transactions (
                    cash_account_id,
                    transaction_type,
                    direction,
                    amount,
                    reference_type,
                    reference_id,
                    description
                )
                VALUES (
                    ?,
                    'sale',
                    'in',
                    ?,
                    'sale',
                    ?,
                    ?
                )
            `).run(

                cashAccount.id,

                paid,

                saleId,

                `تحصيل فاتورة بيع ${invoiceNumber}`

            );

        }


        // =========================
        // =========================
        // CUSTOMER ACCOUNT
        // =========================

        if (customerId) {

            // فاتورة بيع (مدين للعميل = debit)
            db.prepare(`
                INSERT INTO customer_transactions (
                    customer_id,
                    transaction_type,
                    reference_type,
                    reference_id,
                    debit,
                    credit,
                    notes
                )
                VALUES (?, 'sale', 'sale', ?, ?, 0, ?)
            `).run(customerId, saleId, grandTotal, `فاتورة بيع ${invoiceNumber}`);


            if (paid > 0) {

                // دفعة (ائتمان للعميل = credit)
                db.prepare(`
                    INSERT INTO customer_transactions (
                        customer_id,
                        transaction_type,
                        reference_type,
                        reference_id,
                        debit,
                        credit,
                        notes
                    )
                    VALUES (?, 'payment', 'sale', ?, 0, ?, ?)
                `).run(customerId, saleId, paid, `دفع على فاتورة ${invoiceNumber}`);

            }

        }


        // =========================
        // RESULT
        // =========================

        return {
            success: true,
            saleId,
            invoiceNumber,
            subtotal,
            plumbingDiscountAmount,
            total: grandTotal,
            paid,
            remaining
        };

    });

    return transaction();

});


// =========================
// CREATE PLUMBING ORDER (طلبيه سباكه للتجار)
// =========================

ipcMain.handle("plumbingOrders:create", (_e, order) => {
    const transaction = db.transaction(() => {

        if (!order || !Array.isArray(order.items) || order.items.length === 0) {
            throw new Error("يجب إضافة صنف واحد على الأقل للطلبيه");
        }

        const customerName = order.customer_name?.trim();
        if (!customerName) throw new Error("اسم التاجر مطلوب لطلبيه السباكه");

        const location = order.location === "المخزن" ? "المخزن" : "المعرض";
        const notes = order.notes?.trim() || null;

        // خصم التاجر الكلي على المجموع
        const traderDiscountPercent = Math.max(0, Math.min(100, Number(order.trader_discount_percent || 0)));

        const locationRow = db.prepare(`SELECT id FROM locations WHERE name = ?`).get(location);
        if (!locationRow) throw new Error("مكان البيع غير موجود");

        let subtotal = 0;
        const preparedItems = [];

        for (const item of order.items) {
            const productId = Number(item.product_id);
            const quantity = Number(item.quantity);
            const unitPrice = Number(item.unit_price);

            if (!productId) throw new Error("يوجد صنف غير صحيح");
            if (!quantity || quantity <= 0) throw new Error("كمية أحد الأصناف غير صحيحة");
            if (unitPrice < 0 || Number.isNaN(unitPrice)) throw new Error("سعر أحد الأصناف غير صحيح");

            const product = db.prepare(`
                SELECT p.id, p.name, p.purchase_price, p.sale_price, c.name AS category_name
                FROM products p
                LEFT JOIN categories c ON c.id = p.category_id
                WHERE p.id = ? AND p.is_active = 1
            `).get(productId);

            if (!product) throw new Error("أحد المنتجات غير موجود أو غير نشط");

            // التأكد: كل الأصناف سباكه فقط
            if (product.category_name !== "سباكة") {
                throw new Error(`طلبيه سباكه تقبل أصناف سباكه فقط. الصنف "${product.name}" في قسم ${product.category_name} مرفوض`);
            }

            const stockRow = db.prepare(`
                SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?
            `).get(productId, locationRow.id);

            const available = Number(stockRow?.quantity || 0);
            if (quantity > available) {
                throw new Error(`الكمية المطلوبة من "${product.name}" أكبر من المتاح في ${location}`);
            }

            const total = quantity * unitPrice;
            subtotal += total;

            preparedItems.push({
                productId,
                quantity,
                unitPrice,
                total,
                purchasePrice: Number(product.purchase_price || 0)
            });
        }

        // خصم التاجر (كلي)
        const traderDiscountAmount = subtotal * traderDiscountPercent / 100;
        const grandTotal = subtotal - traderDiscountAmount;

        const paid = Math.max(0, Number(order.paid || 0));
        if (paid > grandTotal) throw new Error("المبلغ المدفوع أكبر من إجمالي طلبيه السباكه");
        const remaining = grandTotal - paid;
        const saleType = remaining > 0 ? "credit" : "cash";

        // العميل/التاجر
        let customerId = null;
        const existingCustomer = db.prepare(`SELECT id FROM customers WHERE name = ? LIMIT 1`).get(customerName);
        if (existingCustomer) {
            customerId = existingCustomer.id;
        } else {
            const nc = db.prepare(`INSERT INTO customers (name, is_active) VALUES (?, 1)`).run(customerName);
            customerId = nc.lastInsertRowid;
        }

        const nextSaleId = db.prepare(
            "SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM sales"
        ).get().nextId;
        const invoiceNumber = `P-${String(nextSaleId).padStart(6, "0")}`;
        const saleResult = db.prepare(`
            INSERT INTO sales (
                invoice_number,
                customer_id,
                location_id,
                sale_type,
                subtotal,
                trader_discount_percent,
                trader_discount_amount,
                total_amount,
                paid_amount,
                remaining_amount,
                notes,
                status
            )
            VALUES (?, ?, ?, 'plumbing_order', ?, ?, ?, ?, ?, ?, ?, 'completed')
        `).run(
            invoiceNumber,
            customerId,
            locationRow.id,
            subtotal,
            traderDiscountPercent,
            traderDiscountAmount,
            grandTotal,
            paid,
            remaining,
            notes
        );

        const saleId = saleResult.lastInsertRowid;

        // الأصناف + المخزون
        const insertItem = db.prepare(`
            INSERT INTO sale_items (sale_id, product_id, location_id, quantity, unit_price, total_amount, purchase_price)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of preparedItems) {
            insertItem.run(saleId, item.productId, locationRow.id, item.quantity, item.unitPrice, item.total, item.purchasePrice);

            db.prepare(`UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?`)
                .run(item.quantity, item.productId, locationRow.id);

            db.prepare(`
                INSERT INTO stock_movements
                    (product_id, location_id, movement_type, quantity, reference_type, reference_id)
                VALUES (?, ?, 'sale', ?, 'sale', ?)
            `).run(item.productId, locationRow.id, -item.quantity, saleId);
        }

        // المدفوعات + الخزنة
        if (paid > 0) {
            const cashAccount = db.prepare(`SELECT id FROM cash_accounts WHERE name = 'الخزنة الرئيسية' LIMIT 1`).get();
            if (!cashAccount) throw new Error("الخزنة الرئيسية غير موجودة");

            db.prepare(`INSERT INTO sale_payments (sale_id, amount, payment_method) VALUES (?, ?, 'cash')`).run(saleId, paid);
            db.prepare(`
                INSERT INTO cash_transactions
                    (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
                VALUES (?, 'sale', 'in', ?, 'sale', ?, ?)
            `).run(cashAccount.id, paid, saleId, `تحصيل طلبيه سباكه ${invoiceNumber}`);
        }

        // حسابات التاجر
        db.prepare(`
            INSERT INTO customer_transactions
                (customer_id, transaction_type, reference_type, reference_id, debit, credit, notes)
            VALUES (?, 'sale', 'sale', ?, ?, 0, ?)
        `).run(customerId, saleId, grandTotal, `طلبيه سباكه ${invoiceNumber}`);

        if (paid > 0) {
            db.prepare(`
                INSERT INTO customer_transactions
                    (customer_id, transaction_type, reference_type, reference_id, debit, credit, notes)
                VALUES (?, 'payment', 'sale', ?, 0, ?, ?)
            `).run(customerId, saleId, paid, `دفع على طلبيه ${invoiceNumber}`);
        }

        return {
            success: true,
            saleId,
            invoiceNumber,
            subtotal,
            traderDiscountAmount,
            total: grandTotal,
            paid,
            remaining
        };
    });

    return transaction();
});


// =========================
// UPDATE SALE (تعديل فاتورة مبيعات أو طلبيه سباكه)
// =========================
// منطق التعديل: نرجع كل شيء قديم (مخزون + حركات + مدفوعات) ثم نعيد إنشاؤه من جديد
// مع الحفاظ على رقم الفاتورة والتاريخ الأصلي

ipcMain.handle("sales:update", (_e, saleId, sale) => {
    const transaction = db.transaction(() => {
        saleId = Number(saleId);

        // تحميل الفاتورة القديمة
        const oldSale = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(saleId);
        if (!oldSale) throw new Error("الفاتورة غير موجودة");

        // تحميل الأصناف القديمة
        const oldItems = db.prepare(`SELECT * FROM sale_items WHERE sale_id = ?`).all(saleId);

        // ============================================
        // STEP 1: ROLLBACK (ارجاع المخزون القديم)
        // ============================================
        for (const it of oldItems) {
            // ارجاع الكمية للمخزون
            db.prepare(`
                UPDATE stock SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
                WHERE product_id = ? AND location_id = ?
            `).run(it.quantity, it.product_id, it.location_id);

            // حركة مخزون عكسية (إرجاع)
            db.prepare(`
                INSERT INTO stock_movements
                    (product_id, location_id, movement_type, quantity, reference_type, reference_id, notes)
                VALUES (?, ?, 'return', ?, 'sale', ?, ?)
            `).run(it.product_id, it.location_id, it.quantity, saleId, "تعديل فاتورة - إرجاع الكمية القديمة");
        }

        // ============================================
        // STEP 2: مسح السجلات الثانوية القديمة
        // ============================================
        db.prepare(`DELETE FROM sale_items WHERE sale_id = ?`).run(saleId);
        db.prepare(`DELETE FROM sale_payments WHERE sale_id = ?`).run(saleId);
        db.prepare(`DELETE FROM customer_transactions WHERE reference_id = ? AND reference_type = 'sale'`).run(saleId);
        db.prepare(`DELETE FROM cash_transactions WHERE reference_id = ? AND reference_type = 'sale'`).run(saleId);

        // ============================================
        // STEP 3: حساب الفاتورة الجديدة وإعادة تطبيقها
        // (هذا الكود مكافئ لإنشاء فاتورة جديد لكنه يحدث وليس ينشئ)
        // ============================================
        const isPlumbingOrder = oldSale.sale_type === "plumbing_order";

        if (!sale || !Array.isArray(sale.items) || sale.items.length === 0) {
            throw new Error("يجب إضافة صنف واحد على الأقل للفاتورة");
        }

        const location = sale.location === "المخزن" ? "المخزن" : "المعرض";
        const customerName = sale.customer_name?.trim() || null;
        const notes = sale.notes?.trim() || null;

        // خصم طلبيه السباكه (كلي) أو خصم سباكة فواتير عادية (للأصناف)
        const traderDiscountPercent = Math.max(0, Math.min(100, Number(sale.trader_discount_percent || 0)));
        const plumbingDiscountPercent = Math.max(0, Math.min(100, Number(sale.plumbing_discount_percent || 0)));

        const locationRow = db.prepare(`SELECT id FROM locations WHERE name = ?`).get(location);
        if (!locationRow) throw new Error("مكان البيع غير موجود");

        let subtotal = 0;
        let plumbingSubtotal = 0;
        const preparedItems = [];

        for (const item of sale.items) {
            const productId = Number(item.product_id);
            const quantity = Number(item.quantity);
            const unitPrice = Number(item.unit_price);

            if (!productId) throw new Error("يوجد صنف غير صحيح");
            if (!quantity || quantity <= 0) throw new Error("كمية أحد الأصناف غير صحيحة");
            if (unitPrice < 0 || Number.isNaN(unitPrice)) throw new Error("سعر أحد الأصناف غير صحيح");

            const product = db.prepare(`
                SELECT p.id, p.name, p.purchase_price, c.name AS category_name
                FROM products p
                LEFT JOIN categories c ON c.id = p.category_id
                WHERE p.id = ? AND p.is_active = 1
            `).get(productId);

            if (!product) throw new Error("أحد المنتجات غير موجود أو غير نشط");

            // إذا كانت طلبيه سباكه: أصناف سباكه فقط
            if (isPlumbingOrder && product.category_name !== "سباكة") {
                throw new Error(`طلبيه سباكه تقبل أصناف سباكه فقط. الصنف "${product.name}" مرفوض`);
            }

            const stockRow = db.prepare(`
                SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?
            `).get(productId, locationRow.id);

            const available = Number(stockRow?.quantity || 0);
            if (quantity > available) {
                throw new Error(`الكمية المطلوبة من "${product.name}" أكبر من المتاح في ${location}`);
            }

            const total = quantity * unitPrice;
            subtotal += total;

            if (product.category_name === "سباكة") {
                plumbingSubtotal += total;
            }

            preparedItems.push({
                productId,
                quantity,
                unitPrice,
                total,
                purchasePrice: Number(product.purchase_price || 0)
            });
        }

        // حساب الإجمالي النهائي حسب نوع الفاتورة
        let grandTotal;
        let traderDiscountAmount = 0;
        let plumbingDiscountAmount = 0;

        if (isPlumbingOrder) {
            // خصم تاجر كلي
            traderDiscountAmount = subtotal * traderDiscountPercent / 100;
            grandTotal = subtotal - traderDiscountAmount;
        } else {
            // خصم سباكة على أصناف السباكه
            plumbingDiscountAmount = plumbingSubtotal * plumbingDiscountPercent / 100;
            grandTotal = subtotal - plumbingDiscountAmount;
        }

        const paid = Math.max(0, Number(sale.paid || 0));
        if (paid > grandTotal) throw new Error("المبلغ المدفوع أكبر من إجمالي الفاتورة");
        const remaining = grandTotal - paid;
        const saleType = remaining > 0 ? (isPlumbingOrder ? "plumbing_order" : "credit") : (isPlumbingOrder ? "plumbing_order" : "cash");

        // العميل / التاجر (إذا وجد)
        let customerId = null;
        if (customerName) {
            const ec = db.prepare(`SELECT id FROM customers WHERE name = ? LIMIT 1`).get(customerName);
            if (ec) {
                customerId = ec.id;
            } else {
                const nc = db.prepare(`INSERT INTO customers (name, is_active) VALUES (?, 1)`).run(customerName);
                customerId = nc.lastInsertRowid;
            }
        }

        // ============================================
        // STEP 4: UPDATE sales header (بالاحتفاظ بالرقم الأصلي والتاريخ الأصلي)
        // ============================================
        db.prepare(`
            UPDATE sales SET
                customer_id = ?,
                location_id = ?,
                sale_type = ?,
                subtotal = ?,
                plumbing_discount_percent = ?,
                plumbing_discount_amount = ?,
                trader_discount_percent = ?,
                trader_discount_amount = ?,
                general_discount_amount = 0,
                total_amount = ?,
                paid_amount = ?,
                remaining_amount = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            customerId,
            locationRow.id,
            saleType,
            subtotal,
            isPlumbingOrder ? 0 : plumbingDiscountPercent,
            isPlumbingOrder ? 0 : plumbingDiscountAmount,
            isPlumbingOrder ? traderDiscountPercent : 0,
            isPlumbingOrder ? traderDiscountAmount : 0,
            grandTotal,
            paid,
            remaining,
            notes,
            saleId
        );

        const invoiceNumber = oldSale.invoice_number;

        // ============================================
        // STEP 5: إدراج الأصناف الجديدة + خصم المخزون
        // ============================================
        const insertItem = db.prepare(`
            INSERT INTO sale_items
                (sale_id, product_id, location_id, quantity, unit_price, total_amount, purchase_price)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of preparedItems) {
            insertItem.run(saleId, item.productId, locationRow.id, item.quantity, item.unitPrice, item.total, item.purchasePrice);

            db.prepare(`UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?`)
                .run(item.quantity, item.productId, locationRow.id);

            db.prepare(`
                INSERT INTO stock_movements
                    (product_id, location_id, movement_type, quantity, reference_type, reference_id, notes)
                VALUES (?, ?, 'sale', ?, 'sale', ?, ?)
            `).run(item.productId, locationRow.id, -item.quantity, saleId, "تعديل فاتورة - خصم الأصناف الجديدة");
        }

        // ============================================
        // STEP 6: مدفوعات + خزنة
        // ============================================
        if (paid > 0) {
            const cashAccount = db.prepare(`SELECT id FROM cash_accounts WHERE name = 'الخزنة الرئيسية' LIMIT 1`).get();
            if (!cashAccount) throw new Error("الخزنة الرئيسية غير موجودة");

            db.prepare(`INSERT INTO sale_payments (sale_id, amount, payment_method) VALUES (?, ?, 'cash')`)
                .run(saleId, paid);

            db.prepare(`
                INSERT INTO cash_transactions
                    (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
                VALUES (?, 'sale', 'in', ?, 'sale', ?, ?)
            `).run(cashAccount.id, paid, saleId, `تحصيل فاتورة ${invoiceNumber} (بعد تعديل)`);
        }

        // ============================================
        // STEP 7: حساب العميل
        // ============================================
        if (customerId) {
            db.prepare(`
                INSERT INTO customer_transactions
                    (customer_id, transaction_type, reference_type, reference_id, debit, credit, notes)
                VALUES (?, 'sale', 'sale', ?, ?, 0, ?)
            `).run(customerId, saleId, grandTotal, `فاتورة ${invoiceNumber} (بعد تعديل)`);

            if (paid > 0) {
                db.prepare(`
                    INSERT INTO customer_transactions
                        (customer_id, transaction_type, reference_type, reference_id, debit, credit, notes)
                    VALUES (?, 'payment', 'sale', ?, 0, ?, ?)
                `).run(customerId, saleId, paid, `دفع على فاتورة ${invoiceNumber} (بعد تعديل)`);
            }
        }

        return {
            success: true,
            saleId,
            invoiceNumber,
            subtotal,
            total: grandTotal,
            paid,
            remaining
        };
    });

    return transaction();
});

}

// =========================
// CREATE WINDOWS
// =========================
function createSplashWindow() {
    splashWindow = splashController.open();
    splashWindow.on("closed", () => {
        splashWindow = null;
    });
    splashWindow.webContents.on("render-process-gone", (_event, details) => {
        showStartupError(new Error(`Splash renderer stopped: ${details.reason}`));
    });
    // لا نجعل واجهة شاشة البداية شرطاً لاستكمال الإقلاع؛ النافذة نفسها
    // تظهر بفاصل احتياطي حتى لو تأخر رسم محتواها على جهاز أبطأ.
    return splashController.waitUntilVisible();
}

function createMainWindow() {
    let resolvePainted;
    const painted = new Promise((resolve) => {
        resolvePainted = resolve;
    });
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    const { x = 0, y = 0 } = primaryDisplay.workArea || {};
    mainWindow = new BrowserWindow({
        title: "الشرق | نظام إدارة المحل",
        width,
        height,
        x,
        y,
        minWidth: 760,
        minHeight: 700,
        show: false,
        backgroundColor: "#10141b",
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "src", "preload.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false
        }
    });
    mainWindow.once("ready-to-show", () => {
        resolvePainted();
    });
    mainWindow.webContents.on("did-fail-load", (_event, errorCode, description) => {
        if (!startupIsComplete) {
            showStartupError(new Error(`Main window failed to load (${errorCode}): ${description}`));
        }
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
        if (!startupIsComplete) {
            showStartupError(new Error(`Main window renderer stopped: ${details.reason}`));
        }
    });
    return painted;
}

function waitForMainReady() {
    if (mainRendererReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
        resolveMainReady = resolve;
        rejectMainReady = reject;
    });
}

app.whenReady().then(async () => {
    try {
        await createSplashWindow();
        if (startupHasFailed) return;

        reportStartupProgress(10, "جاري تشغيل الشرق...");
        const mainPainted = createMainWindow();
        reportStartupProgress(18, "جاري تجهيز قاعدة البيانات...");
        initializeBackend();
        reportStartupProgress(88, "جاري تحميل البيانات...");

        mainWindow.webContents.once("did-finish-load", () => {
            reportStartupProgress(94, "جاري تشغيل الواجهة...");
        });
        await Promise.all([
            mainWindow.loadFile(path.join(__dirname, "src", "renderer", "index.html")),
            mainPainted,
            waitForMainReady()
        ]);
        if (startupHasFailed) return;

        startupIsComplete = true;
        await splashController.finish(mainWindow);
    } catch (error) {
        showStartupError(error);
    }

    app.on("activate", async () => {
        if (startupHasFailed || !startupIsComplete) {
            splashWindow?.show();
            return;
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
            return;
        }
        const painted = createMainWindow();
        try {
            await mainWindow.loadFile(path.join(__dirname, "src", "renderer", "index.html"));
            await painted;
            mainWindow.show();
        } catch (error) {
            console.error("Failed to restore the main window:", error);
        }
    });
});


// =========================
// CLOSE APP
// =========================

app.on(
    "window-all-closed",
    () => {

        if (process.platform !== "darwin") {

            app.quit();

        }

    }
);

module.exports = { initializeBackend };
