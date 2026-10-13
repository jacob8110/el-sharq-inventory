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
    // =========================
    // QUICK TRANSACTIONS: مبيعات ومرتجعات نقدية من المعرض
    // =========================
    ipcMain.handle("quickTransactions:getSales", () => {
        const sales = db.prepare(`
            SELECT id, transaction_number, total_amount, created_at, notes
            FROM quick_transactions
            WHERE transaction_type = 'sale'
            ORDER BY id DESC
            LIMIT 300
        `).all();
        const getItems = db.prepare(`
            SELECT qi.id AS item_id, qi.product_id, qi.quantity, qi.unit_price,
                qi.purchase_price, qi.total_amount, p.name AS product_name, p.unit,
                COALESCE((
                    SELECT SUM(ri.quantity)
                    FROM quick_transaction_items ri
                    JOIN quick_transactions rt ON rt.id = ri.transaction_id
                    WHERE rt.transaction_type = 'return' AND ri.source_item_id = qi.id
                ), 0) AS returned_quantity
            FROM quick_transaction_items qi
            JOIN products p ON p.id = qi.product_id
            WHERE qi.transaction_id = ?
            ORDER BY qi.id
        `);
        return sales.map((sale) => ({ ...sale, items: getItems.all(sale.id) }));
    });

    ipcMain.handle("quickTransactions:getHistory", () => db.prepare(`
        SELECT qt.id, qt.transaction_number, qt.transaction_type, qt.source_sale_id,
            qt.total_amount, qt.notes, qt.created_at,
            source.transaction_number AS source_sale_number,
            COUNT(qi.id) AS item_count
        FROM quick_transactions qt
        LEFT JOIN quick_transactions source ON source.id = qt.source_sale_id
        LEFT JOIN quick_transaction_items qi ON qi.transaction_id = qt.id
        GROUP BY qt.id
        ORDER BY qt.id DESC
        LIMIT 100
    `).all());

    ipcMain.handle("quickTransactions:createSale", (_event, payload) => db.transaction(() => {
        if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
            throw new Error("أضف صنفًا واحدًا على الأقل");
        }
        const showroom = db.prepare("SELECT id FROM locations WHERE name = 'المعرض' AND is_active = 1").get();
        if (!showroom) throw new Error("مكان المعرض غير موجود أو غير نشط");
        const prepared = [];
        const requested = new Map();
        let total = 0;
        for (const input of payload.items) {
            const productId = Number(input.product_id ?? input.productId);
            const quantity = Number(input.quantity);
            if (!Number.isInteger(productId) || productId <= 0) throw new Error("اختر صنفًا صحيحًا");
            if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("أدخل كمية صحيحة");
            const product = db.prepare(`
                SELECT id, name, unit, sale_price, purchase_price
                FROM products WHERE id = ? AND is_active = 1
            `).get(productId);
            if (!product) throw new Error("أحد المنتجات غير موجود أو غير نشط");
            const nextQty = Number(requested.get(productId) || 0) + quantity;
            requested.set(productId, nextQty);
            const lineTotal = Math.round(quantity * Number(product.sale_price || 0) * 100) / 100;
            if (!Number.isFinite(lineTotal) || lineTotal < 0) throw new Error(`سعر ${product.name} غير صحيح`);
            prepared.push({ product, quantity, lineTotal });
            total += lineTotal;
        }
        total = Math.round(total * 100) / 100;
        if (total <= 0) throw new Error("إجمالي البيع يجب أن يكون أكبر من صفر");
        for (const [productId, quantity] of requested) {
            const product = prepared.find((item) => item.product.id === productId).product;
            const stock = db.prepare("SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?").get(productId, showroom.id);
            if (quantity > Number(stock?.quantity || 0) + 0.000001) {
                throw new Error(`الكمية المطلوبة من "${product.name}" أكبر من المتاح في المعرض`);
            }
        }
        const nextId = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM quick_transactions").get().id);
        // A quick sale may only use the portion not held for customer reservations.
        for (const [productId, quantity] of requested) {
            const physical = Number(db.prepare(
                "SELECT COALESCE(SUM(quantity), 0) AS quantity FROM stock WHERE product_id = ?"
            ).get(productId).quantity || 0);
            const reserved = Number(db.prepare(`
                SELECT COALESCE(SUM(ri.quantity), 0) AS quantity
                FROM reservation_items ri
                JOIN reservations r ON r.id = ri.reservation_id
                WHERE ri.product_id = ? AND r.status = 'pending'
            `).get(productId).quantity || 0);
            if (quantity > physical - reserved + 0.000001) {
                const product = prepared.find((item) => item.product.id === productId)?.product;
                throw new Error(`لا يمكن بيع كمية محجوزة للعميل من "${product?.name || "الصنف"}"`);
            }
        }
        const number = `QS-${String(nextId).padStart(6, "0")}`;
        const result = db.prepare(`
            INSERT INTO quick_transactions (transaction_number, transaction_type, total_amount, notes)
            VALUES (?, 'sale', ?, ?)
        `).run(number, total, String(payload.notes || "").trim() || null);
        const transactionId = Number(result.lastInsertRowid);
        const insertItem = db.prepare(`
            INSERT INTO quick_transaction_items
                (transaction_id, product_id, quantity, unit_price, purchase_price, total_amount)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const item of prepared) {
            const productId = Number(item.product.id);
            db.prepare(`UPDATE stock SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND location_id = ?`)
                .run(item.quantity, productId, showroom.id);
            db.prepare(`
                INSERT INTO stock_movements (product_id, location_id, movement_type, quantity, reference_type, reference_id, notes)
                VALUES (?, ?, 'sale', ?, 'quick_transaction', ?, ?)
            `).run(productId, showroom.id, -item.quantity, transactionId, `بيع سريع ${number}`);
            insertItem.run(transactionId, productId, item.quantity, Number(item.product.sale_price || 0), Number(item.product.purchase_price || 0), item.lineTotal);
        }
        const account = db.prepare("SELECT id FROM cash_accounts WHERE name = 'الخزنة الرئيسية' AND is_active = 1").get();
        if (!account) throw new Error("الخزنة الرئيسية غير موجودة أو غير نشطة");
        db.prepare(`
            INSERT INTO cash_transactions (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
            VALUES (?, 'quick_sale', 'in', ?, 'quick_transaction', ?, ?)
        `).run(account.id, total, transactionId, `بيع سريع ${number}`);
        return { success: true, id: transactionId, transactionNumber: number, totalAmount: total };
    })());

    ipcMain.handle("quickTransactions:createReturn", (_event, saleId, payload) => db.transaction(() => {
        const id = Number(saleId);
        if (!Number.isInteger(id) || id <= 0) throw new Error("اختر عملية بيع صحيحة");
        if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) throw new Error("أدخل كمية مرتجعة لصنف واحد على الأقل");
        const sale = db.prepare("SELECT * FROM quick_transactions WHERE id = ? AND transaction_type = 'sale'").get(id);
        if (!sale) throw new Error("عملية البيع السريع غير موجودة");
        const showroom = db.prepare("SELECT id FROM locations WHERE name = 'المعرض' AND is_active = 1").get();
        if (!showroom) throw new Error("مكان المعرض غير موجود أو غير نشط");
        const originalItems = db.prepare(`
            SELECT qi.*, p.name AS product_name,
                COALESCE((SELECT SUM(ri.quantity) FROM quick_transaction_items ri
                    JOIN quick_transactions rt ON rt.id = ri.transaction_id
                    WHERE rt.transaction_type = 'return' AND ri.source_item_id = qi.id), 0) AS returned_quantity
            FROM quick_transaction_items qi JOIN products p ON p.id = qi.product_id
            WHERE qi.transaction_id = ?
        `).all(id);
        const byId = new Map(originalItems.map((item) => [Number(item.id), item]));
        const requests = new Map();
        for (const input of payload.items) {
            const sourceItemId = Number(input.quick_sale_item_id ?? input.item_id ?? input.itemId);
            const original = byId.get(sourceItemId);
            if (!original) throw new Error("أحد الأصناف لا يتبع عملية البيع المحددة");
            const quantity = Number(input.quantity);
            if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`كمية مرتجع ${original.product_name} غير صحيحة`);
            requests.set(sourceItemId, Number(requests.get(sourceItemId) || 0) + quantity);
        }
        const prepared = [];
        let total = 0;
        for (const [sourceItemId, quantity] of requests) {
            const original = byId.get(sourceItemId);
            const remaining = Number(original.quantity) - Number(original.returned_quantity || 0);
            if (quantity > remaining + 0.000001) throw new Error(`كمية مرتجع ${original.product_name} أكبر من الكمية المتبقية`);
            const lineTotal = Math.round(quantity * Number(original.unit_price) * 100) / 100;
            prepared.push({ original, quantity, lineTotal });
            total += lineTotal;
        }
        total = Math.round(total * 100) / 100;
        if (total <= 0) throw new Error("قيمة المرتجع يجب أن تكون أكبر من صفر");
        const nextId = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM quick_transactions").get().id);
        const number = `QR-${String(nextId).padStart(6, "0")}`;
        const result = db.prepare(`
            INSERT INTO quick_transactions (transaction_number, transaction_type, source_sale_id, total_amount, notes)
            VALUES (?, 'return', ?, ?, ?)
        `).run(number, id, total, String(payload.notes || "").trim() || null);
        const returnId = Number(result.lastInsertRowid);
        for (const item of prepared) {
            const productId = Number(item.original.product_id);
            db.prepare(`
                INSERT INTO quick_transaction_items
                    (transaction_id, source_item_id, product_id, quantity, unit_price, purchase_price, total_amount)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(returnId, Number(item.original.id), productId, item.quantity,
                Number(item.original.unit_price), Number(item.original.purchase_price || 0), item.lineTotal);
            db.prepare(`
                INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)
                ON CONFLICT(product_id, location_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
            `).run(productId, showroom.id, item.quantity);
            db.prepare(`
                INSERT INTO stock_movements (product_id, location_id, movement_type, quantity, reference_type, reference_id, notes)
                VALUES (?, ?, 'return', ?, 'quick_transaction', ?, ?)
            `).run(productId, showroom.id, item.quantity, returnId, `مرتجع سريع ${number} من ${sale.transaction_number}`);
        }
        const account = db.prepare("SELECT id FROM cash_accounts WHERE name = 'الخزنة الرئيسية' AND is_active = 1").get();
        if (!account) throw new Error("الخزنة الرئيسية غير موجودة أو غير نشطة");
        db.prepare(`
            INSERT INTO cash_transactions (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
            VALUES (?, 'quick_return', 'out', ?, 'quick_transaction', ?, ?)
        `).run(account.id, total, returnId, `رد نقدي لمرتجع سريع ${number}`);
        return { success: true, id: returnId, transactionNumber: number, totalAmount: total, sourceSaleNumber: sale.transaction_number };
    })());

    // مرتجع سريع مستقل عن أي فاتورة بيع.
    ipcMain.handle("quickTransactions:createStandaloneReturn", (_event, payload) => db.transaction(() => {
        if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
            throw new Error("أضف صنفًا واحدًا على الأقل");
        }

        const showroom = db.prepare(`
            SELECT id FROM locations
            WHERE name = 'المعرض' AND is_active = 1
        `).get();

        if (!showroom) throw new Error("مكان المعرض غير موجود أو غير نشط");

        const account = db.prepare(`
            SELECT id FROM cash_accounts
            WHERE name = 'الخزنة الرئيسية' AND is_active = 1
        `).get();

        if (!account) throw new Error("الخزنة الرئيسية غير موجودة أو غير نشطة");

        // نعتمد دائمًا سعر البيع الحالي المسجل في قاعدة البيانات.
        const requested = new Map();

        for (const input of payload.items) {
            const productId = Number(input.product_id ?? input.productId);
            const quantity = Number(input.quantity);

            if (!Number.isSafeInteger(productId) || productId <= 0) {
                throw new Error("اختر صنفًا صحيحًا");
            }

            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw new Error("أدخل كمية مرتجعة صحيحة");
            }

            const product = db.prepare(`
                SELECT id, name, unit, sale_price, purchase_price
                FROM products
                WHERE id = ? AND is_active = 1
            `).get(productId);

            if (!product) throw new Error("أحد المنتجات غير موجود أو غير نشط");

            const price = Number(product.sale_price);
            const cost = Number(product.purchase_price);

            if (!Number.isFinite(price) || price <= 0) {
                throw new Error(`سعر البيع المسجل للصنف "${product.name}" غير صالح`);
            }

            if (!Number.isFinite(cost) || cost < 0) {
                throw new Error(`تكلفة الصنف "${product.name}" غير صالحة`);
            }

            const existing = requested.get(productId);

            if (existing) {
                existing.quantity += quantity;
            } else {
                requested.set(productId, { product, quantity });
            }
        }

        const prepared = Array.from(requested.values()).map((item) => ({
            ...item,
            unitPrice: Number(item.product.sale_price),
            purchasePrice: Number(item.product.purchase_price),
            lineTotal: Math.round(
                item.quantity * Number(item.product.sale_price) * 100
            ) / 100
        }));

        const total = Math.round(
            prepared.reduce((sum, item) => sum + item.lineTotal, 0) * 100
        ) / 100;

        if (!Number.isFinite(total) || total <= 0) {
            throw new Error("قيمة المرتجع يجب أن تكون أكبر من صفر");
        }

        const nextId = Number(db.prepare(`
            SELECT COALESCE(MAX(id), 0) + 1 AS id
            FROM quick_transactions
        `).get().id);

        const number = `QR-${String(nextId).padStart(6, "0")}`;

        const result = db.prepare(`
            INSERT INTO quick_transactions
                (transaction_number, transaction_type, source_sale_id, total_amount, notes)
            VALUES (?, 'return', NULL, ?, ?)
        `).run(number, total, String(payload.notes || "").trim() || null);

        const returnId = Number(result.lastInsertRowid);

        const insertItem = db.prepare(`
            INSERT INTO quick_transaction_items
                (transaction_id, source_item_id, product_id, quantity,
                 unit_price, purchase_price, total_amount)
            VALUES (?, NULL, ?, ?, ?, ?, ?)
        `);

        const restoreStock = db.prepare(`
            INSERT INTO stock (product_id, location_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(product_id, location_id)
            DO UPDATE SET
                quantity = quantity + excluded.quantity,
                updated_at = CURRENT_TIMESTAMP
        `);

        const addMovement = db.prepare(`
            INSERT INTO stock_movements
                (product_id, location_id, movement_type, quantity,
                 reference_type, reference_id, notes)
            VALUES (?, ?, 'return', ?, 'quick_transaction', ?, ?)
        `);

        for (const item of prepared) {
            const productId = Number(item.product.id);

            insertItem.run(
                returnId,
                productId,
                item.quantity,
                item.unitPrice,
                item.purchasePrice,
                item.lineTotal
            );

            // إعادة الكمية إلى المعرض فقط.
            restoreStock.run(productId, showroom.id, item.quantity);

            addMovement.run(
                productId,
                showroom.id,
                item.quantity,
                returnId,
                `مرتجع سريع مستقل ${number}`
            );
        }

        // رد قيمة المرتجع نقدًا للعميل.
        db.prepare(`
            INSERT INTO cash_transactions
                (cash_account_id, transaction_type, direction, amount,
                 reference_type, reference_id, description)
            VALUES (?, 'quick_return', 'out', ?, 'quick_transaction', ?, ?)
        `).run(
            account.id,
            total,
            returnId,
            `رد نقدي لمرتجع سريع ${number}`
        );

        return {
            success: true,
            id: returnId,
            transactionNumber: number,
            totalAmount: total
        };
    })());

    // QUICK TRANSACTIONS: حذف الحركة وعكس أثرها المالي والمخزني.
    ipcMain.handle("quickTransactions:delete", (_event, transactionId) => db.transaction(() => {
        const id = Number(transactionId);

        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new Error("رقم المعاملة غير صحيح");
        }

        const transaction = db.prepare(`
            SELECT id, transaction_number, transaction_type, total_amount
            FROM quick_transactions
            WHERE id = ?
        `).get(id);

        if (!transaction) {
            throw new Error("المعاملة غير موجودة أو تم حذفها بالفعل");
        }

        if (!["sale", "return"].includes(transaction.transaction_type)) {
            throw new Error("نوع المعاملة غير مدعوم للحذف");
        }

        if (transaction.transaction_type === "sale") {
            const linkedReturns = db.prepare(`
                SELECT COUNT(*) AS count
                FROM quick_transactions
                WHERE transaction_type = 'return' AND source_sale_id = ?
            `).get(id);

            if (Number(linkedReturns.count) > 0) {
                throw new Error("لا يمكن حذف هذا البيع لوجود مرتجع مرتبط به. احذف المرتجع المرتبط أولاً.");
            }
        }

        const items = db.prepare(`
            SELECT product_id, quantity
            FROM quick_transaction_items
            WHERE transaction_id = ?
        `).all(id);

        if (!items.length) {
            throw new Error("لا توجد أصناف مسجلة في هذه المعاملة؛ لم يتم حذفها");
        }

        const cashMovements = db.prepare(`
            SELECT id
            FROM cash_transactions
            WHERE reference_type = 'quick_transaction' AND reference_id = ?
        `).all(id);

        if (!cashMovements.length) {
            throw new Error("لم أجد الحركة المالية المرتبطة؛ لم يتم حذف المعاملة حتى لا تختلف الخزنة");
        }

        const showroom = db.prepare(`
            SELECT id
            FROM locations
            WHERE name = 'المعرض' AND is_active = 1
        `).get();

        if (!showroom) {
            throw new Error("مكان المعرض غير موجود أو غير نشط");
        }

        const quantities = new Map();

        for (const item of items) {
            const productId = Number(item.product_id);
            const quantity = Number(item.quantity);

            if (!Number.isSafeInteger(productId) || productId <= 0 ||
                !Number.isFinite(quantity) || quantity <= 0) {
                throw new Error("بيانات أحد الأصناف غير سليمة؛ لم يتم الحذف");
            }

            quantities.set(
                productId,
                Number(quantities.get(productId) || 0) + quantity
            );
        }

        const getStock = db.prepare(`
            SELECT quantity
            FROM stock
            WHERE product_id = ? AND location_id = ?
        `);

        const addStock = db.prepare(`
            INSERT INTO stock (product_id, location_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(product_id, location_id)
            DO UPDATE SET
                quantity = quantity + excluded.quantity,
                updated_at = CURRENT_TIMESTAMP
        `);

        const subtractStock = db.prepare(`
            UPDATE stock
            SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = ? AND location_id = ? AND quantity >= ?
        `);

        if (transaction.transaction_type === "return") {
            // إلغاء المرتجع يعني سحب البضاعة التي أُضيفت بسببه.
            for (const [productId, quantity] of quantities) {
                const stock = getStock.get(productId, showroom.id);
                const currentQuantity = Number(stock?.quantity || 0);

                if (currentQuantity + 0.000001 < quantity) {
                    const product = db.prepare(
                        "SELECT name FROM products WHERE id = ?"
                    ).get(productId);

                    throw new Error(
                        `لا يمكن حذف المرتجع: كمية "${product?.name || productId}" الموجودة في المعرض أقل من الكمية المرتجعة`
                    );
                }
            }

            for (const [productId, quantity] of quantities) {
                const result = subtractStock.run(
                    quantity, productId, showroom.id, quantity
                );

                if (Number(result.changes) !== 1) {
                    throw new Error("تعذر تحديث مخزون المعرض؛ لم يتم إكمال الحذف");
                }
            }
        } else {
            // إلغاء البيع يعني إعادة الكميات المباعة إلى المعرض.
            for (const [productId, quantity] of quantities) {
                addStock.run(productId, showroom.id, quantity);
            }
        }

        // حذف الحركة النقدية يخفض رصيد الخزنة للبيع،
        // ويرفع رصيدها للمرتجع لأن مبلغ الرد لم يعد مخصومًا.
        db.prepare(`
            DELETE FROM cash_transactions
            WHERE reference_type = 'quick_transaction' AND reference_id = ?
        `).run(id);

        db.prepare(`
            DELETE FROM stock_movements
            WHERE reference_type = 'quick_transaction' AND reference_id = ?
        `).run(id);

        db.prepare(`
            DELETE FROM quick_transaction_items
            WHERE transaction_id = ?
        `).run(id);

        db.prepare(`
            DELETE FROM quick_transactions
            WHERE id = ?
        `).run(id);

        return {
            success: true,
            transactionNumber: transaction.transaction_number,
            transactionType: transaction.transaction_type,
            totalAmount: Number(transaction.total_amount)
        };
    })());

    // SALES: القائمة + الحصول على فاتورة + تعديل
    // =========================

    ipcMain.handle("sales:getAll", (_e, filter = "normal", searchTerm = "") => {
        // Without a search, show the latest 100. With a search, include matching historical invoices.
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
        const conditions = ["COALESCE(s.is_hidden, 0) = 0"];
        const params = [];
        if (filter === "plumbing_order") {
            conditions.push("s.sale_type = 'plumbing_order'");
        } else if (filter !== "all") {
            conditions.push("(s.sale_type IS NULL OR s.sale_type != 'plumbing_order')");
        }

        const query = String(searchTerm || "").trim();
        if (query) {
            conditions.push("(COALESCE(c.name, '') LIKE ? OR COALESCE(s.invoice_number, '') LIKE ?)");
            params.push(`%${query}%`, `%${query}%`);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const limitClause = query ? "" : "LIMIT 100";
        return db.prepare(`${baseSelect} ${whereClause} ORDER BY s.id DESC ${limitClause}`).all(...params);
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
        const returnRows = db.prepare(`
            SELECT
                sr.id AS return_id,
                sr.return_number,
                sr.total_amount AS return_total,
                sr.balance_credit_amount,
                sr.cash_refund_amount,
                sr.notes AS return_notes,
                sr.created_at AS return_created_at,
                sri.id AS return_item_id,
                sri.sale_item_id,
                sri.product_id,
                sri.location_id,
                sri.quantity,
                sri.display_quantity,
                sri.display_unit,
                sri.unit_price,
                sri.total_amount AS item_total,
                p.name AS product_name,
                l.name AS location_name
            FROM sales_returns sr
            LEFT JOIN sales_return_items sri ON sri.return_id = sr.id
            LEFT JOIN products p ON p.id = sri.product_id
            LEFT JOIN locations l ON l.id = sri.location_id
            WHERE sr.sale_id = ?
            ORDER BY sr.id, sri.id
        `).all(id);

        const returnMap = new Map();
        for (const row of returnRows) {
            if (!returnMap.has(row.return_id)) {
                returnMap.set(row.return_id, {
                    id: row.return_id,
                    return_number: row.return_number,
                    total_amount: row.return_total,
                    balance_credit_amount: row.balance_credit_amount,
                    cash_refund_amount: row.cash_refund_amount,
                    notes: row.return_notes,
                    created_at: row.return_created_at,
                    items: []
                });
            }

            if (row.return_item_id != null) {
                returnMap.get(row.return_id).items.push({
                    id: row.return_item_id,
                    sale_item_id: row.sale_item_id,
                    product_id: row.product_id,
                    product_name: row.product_name,
                    location_id: row.location_id,
                    location_name: row.location_name,
                    quantity: row.quantity,
                    display_quantity: row.display_quantity,
                    display_unit: row.display_unit,
                    unit_price: row.unit_price,
                    total_amount: row.item_total
                });
            }
        }
        sale.returns = Array.from(returnMap.values());

        return sale;
    });

    ipcMain.handle("sales:delete", (_event, saleId, password, mode = "reverse") => {
        verifyDeletionPassword(db, password);
        return db.transaction(() => {
            const id = Number(saleId);
            if (!Number.isInteger(id) || id <= 0) {
                throw new Error("رقم الفاتورة غير صحيح");
            }

            const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(id);
            if (!sale) throw new Error("فاتورة البيع غير موجودة");

            if (mode === "hide") {
                db.prepare("UPDATE sales SET is_hidden = 1 WHERE id = ?").run(id);
                return { success: true, hidden: true };
            }
            if (mode !== "reverse") {
                throw new Error("اختيار الحذف غير صحيح");
            }

            const soldItems = db.prepare(`
                SELECT product_id, location_id, SUM(quantity) AS quantity
                FROM sale_items
                WHERE sale_id = ?
                GROUP BY product_id, location_id
            `).all(id);

            const returnedItems = db.prepare(`
                SELECT sri.product_id, sri.location_id,
                    SUM(sri.quantity) AS quantity
                FROM sales_return_items sri
                JOIN sales_returns sr ON sr.id = sri.return_id
                WHERE sr.sale_id = ?
                GROUP BY sri.product_id, sri.location_id
            `).all(id);

            for (const item of returnedItems) {
                const stock = db.prepare(`
                    SELECT quantity FROM stock
                    WHERE product_id = ? AND location_id = ?
                `).get(item.product_id, item.location_id);

                if (!stock || Number(stock.quantity || 0) + 0.000001 < Number(item.quantity || 0)) {
                    throw new Error(
                        "تعذر الحذف النهائي: كمية مرتجع أحد الأصناف غير متوفرة في مكان إرجاعها."
                    );
                }
            }

            for (const item of returnedItems) {
                db.prepare(`
                    UPDATE stock
                    SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE product_id = ? AND location_id = ?
                `).run(item.quantity, item.product_id, item.location_id);

                db.prepare(`
                    INSERT INTO stock_movements
                        (product_id, location_id, movement_type, quantity,
                         reference_type, reference_id, notes)
                    VALUES (?, ?, 'adjustment', ?, 'sale_delete', ?, ?)
                `).run(
                    item.product_id,
                    item.location_id,
                    -Number(item.quantity),
                    id,
                    `عكس مرتجع عند الحذف النهائي للفاتورة ${sale.invoice_number}`
                );
            }

            for (const item of soldItems) {
                const stock = db.prepare(`
                    SELECT id FROM stock
                    WHERE product_id = ? AND location_id = ?
                `).get(item.product_id, item.location_id);

                if (stock) {
                    db.prepare(`
                        UPDATE stock
                        SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `).run(item.quantity, stock.id);
                } else {
                    db.prepare(`
                        INSERT INTO stock (product_id, location_id, quantity)
                        VALUES (?, ?, ?)
                    `).run(item.product_id, item.location_id, item.quantity);
                }

                db.prepare(`
                    INSERT INTO stock_movements
                        (product_id, location_id, movement_type, quantity,
                         reference_type, reference_id, notes)
                    VALUES (?, ?, 'adjustment', ?, 'sale_delete', ?, ?)
                `).run(
                    item.product_id,
                    item.location_id,
                    Number(item.quantity),
                    id,
                    `عكس بيع عند الحذف النهائي للفاتورة ${sale.invoice_number}`
                );
            }

            db.prepare(`
                DELETE FROM customer_transactions
                WHERE reference_type = 'sale' AND reference_id = ?
            `).run(id);
            db.prepare(`
                DELETE FROM customer_transactions
                WHERE reference_type = 'sales_return'
                  AND reference_id IN (
                      SELECT id FROM sales_returns WHERE sale_id = ?
                  )
            `).run(id);
            db.prepare(`
                DELETE FROM cash_transactions
                WHERE reference_type = 'sale' AND reference_id = ?
            `).run(id);
            db.prepare(`
                DELETE FROM cash_transactions
                WHERE reference_type = 'sales_return'
                  AND reference_id IN (
                      SELECT id FROM sales_returns WHERE sale_id = ?
                  )
            `).run(id);

            db.prepare(`
                DELETE FROM sales_return_items
                WHERE return_id IN (
                    SELECT id FROM sales_returns WHERE sale_id = ?
                )
            `).run(id);
            db.prepare("DELETE FROM sales_returns WHERE sale_id = ?").run(id);
            db.prepare("DELETE FROM sales WHERE id = ?").run(id);

            return { success: true, hidden: false };
        })();
    });
    // =========================
    // SAVE SALE
    // =========================

    // =========================
    // CREATE SALE RETURN
    // =========================
    ipcMain.handle("sales:return:create", (_event, saleId, payload) => {
        return db.transaction(() => {
            const id = Number(saleId);
            if (!Number.isInteger(id) || id <= 0) throw new Error("رقم الفاتورة غير صحيح");
            if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
                throw new Error("أضف صنفًا واحدًا على الأقل للمرتجع");
            }

            const sale = db.prepare(`
                SELECT * FROM sales WHERE id = ? AND status = 'completed'
            `).get(id);
            if (!sale) throw new Error("الفاتورة غير موجودة أو غير مكتملة");

            const originalItems = db.prepare(`
                SELECT
                    si.id,
                    si.product_id,
                    si.quantity,
                    si.unit_price,
                    si.total_amount,
                    si.display_quantity,
                    si.display_unit,
                    si.display_unit_price,
                    p.name AS product_name,
                    p.unit AS product_unit,
                    cat.name AS category_name,
                    COALESCE(
                        (SELECT SUM(sri.quantity)
                         FROM sales_return_items sri
                         WHERE sri.sale_item_id = si.id),
                        0
                    ) AS returned_quantity
                FROM sale_items si
                JOIN products p ON p.id = si.product_id
                LEFT JOIN categories cat ON cat.id = p.category_id
                WHERE si.sale_id = ?
            `).all(id);

            const itemById = new Map(originalItems.map(item => [Number(item.id), item]));
            const plumbingGross = originalItems.reduce((sum, item) =>
                item.category_name === "سباكة"
                    ? sum + Number(item.total_amount || 0)
                    : sum, 0);
            const subtotal = Number(sale.subtotal || 0);
            const plumbingDiscount = Number(
                sale.sale_type === "plumbing_order"
                    ? sale.trader_discount_amount || 0
                    : sale.plumbing_discount_amount || 0
            );
            const plumbingDiscountBase = sale.sale_type === "plumbing_order"
                ? subtotal
                : plumbingGross;
            const plumbingDiscountRate = plumbingDiscountBase > 0
                ? Math.min(1, Math.max(0, plumbingDiscount / plumbingDiscountBase))
                : 0;
            const generalDiscountRate = subtotal > 0
                ? Math.min(1, Math.max(0, Number(sale.general_discount_amount || 0) / subtotal))
                : 0;

            const requestedBySaleItem = new Map();
            const preparedReturns = [];
            let totalAmount = 0;

            for (const input of payload.items) {
                const saleItemId = Number(input.sale_item_id ?? input.saleItemId);
                const original = itemById.get(saleItemId);
                if (!original) throw new Error("أحد الأصناف لا يتبع هذه الفاتورة");

                const displayQuantity = Number(input.display_quantity ?? input.displayQuantity);
                if (!Number.isFinite(displayQuantity) || displayQuantity <= 0) {
                    throw new Error(`كمية مرتجع "${original.product_name}" غير صحيحة`);
                }

                const originalStockQuantity = Number(original.quantity || 0);
                const originalDisplayQuantity = Number(original.display_quantity || original.quantity || 0);
                if (originalStockQuantity <= 0 || originalDisplayQuantity <= 0) {
                    throw new Error(`تعذر حساب وحدة الصنف "${original.product_name}"`);
                }

                const alreadyReturned = Number(original.returned_quantity || 0);
                const requestedSoFar = Number(requestedBySaleItem.get(saleItemId) || 0);
                const remainingStockQuantity = originalStockQuantity - alreadyReturned - requestedSoFar;
                const remainingDisplayQuantity =
                    remainingStockQuantity * originalDisplayQuantity / originalStockQuantity;

                if (displayQuantity > remainingDisplayQuantity + 0.000001) {
                    throw new Error(`كمية مرتجع "${original.product_name}" أكبر من الكمية المتبقية`);
                }

                const stockQuantity =
                    originalStockQuantity * displayQuantity / originalDisplayQuantity;
                requestedBySaleItem.set(saleItemId, requestedSoFar + stockQuantity);

                const locationId = Number(input.location_id ?? input.locationId);
                if (!Number.isInteger(locationId) || locationId <= 0) {
                    throw new Error(`اختر مكان إضافة الصنف "${original.product_name}"`);
                }
                const location = db.prepare(`
                    SELECT id, name FROM locations WHERE id = ? AND is_active = 1
                `).get(locationId);
                if (!location) throw new Error("مكان إضافة المرتجع غير موجود أو غير نشط");

                const grossAmount = Number(original.total_amount || 0) *
                    stockQuantity / originalStockQuantity;
                const itemPlumbingRate =
                    sale.sale_type === "plumbing_order" ||
                    original.category_name === "سباكة"
                        ? plumbingDiscountRate
                        : 0;
                const netAmount = Math.round(
                    grossAmount * (1 - itemPlumbingRate) * (1 - generalDiscountRate) * 100
                ) / 100;
                const displayUnit = String(
                    original.display_unit || original.product_unit || "قطعة"
                );
                const unitPrice = netAmount / displayQuantity;

                preparedReturns.push({
                    saleItemId,
                    productId: Number(original.product_id),
                    locationId,
                    stockQuantity,
                    displayQuantity,
                    displayUnit,
                    unitPrice,
                    totalAmount: netAmount
                });
                totalAmount += netAmount;
            }

            totalAmount = Math.round(totalAmount * 100) / 100;
            if (totalAmount <= 0) throw new Error("قيمة المرتجع يجب أن تكون أكبر من صفر");

            const balanceCreditAmount = Math.min(
                totalAmount,
                Math.max(0, Number(sale.remaining_amount || 0))
            );
            const cashRefundAmount = Math.round(
                Math.max(0, totalAmount - balanceCreditAmount) * 100
            ) / 100;

            let nextReturnId = Number(
                db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM sales_returns").get().nextId
            );
            let returnNumber = `R-${String(nextReturnId).padStart(6, "0")}`;
            while (db.prepare("SELECT 1 FROM sales_returns WHERE return_number = ?").get(returnNumber)) {
                nextReturnId += 1;
                returnNumber = `R-${String(nextReturnId).padStart(6, "0")}`;
            }

            const returnResult = db.prepare(`
                INSERT INTO sales_returns (
                    return_number, sale_id, customer_id, total_amount,
                    balance_credit_amount, cash_refund_amount, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                returnNumber,
                id,
                sale.customer_id || null,
                totalAmount,
                balanceCreditAmount,
                cashRefundAmount,
                String(payload.notes || "").trim() || null
            );
            const returnId = Number(returnResult.lastInsertRowid);

            for (const item of preparedReturns) {
                db.prepare(`
                    INSERT INTO sales_return_items (
                        return_id, sale_item_id, product_id, location_id,
                        quantity, display_quantity, display_unit, unit_price, total_amount
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    returnId,
                    item.saleItemId,
                    item.productId,
                    item.locationId,
                    item.stockQuantity,
                    item.displayQuantity,
                    item.displayUnit,
                    item.unitPrice,
                    item.totalAmount
                );

                const stock = db.prepare(`
                    SELECT id FROM stock WHERE product_id = ? AND location_id = ?
                `).get(item.productId, item.locationId);

                if (stock) {
                    db.prepare(`
                        UPDATE stock
                        SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `).run(item.stockQuantity, stock.id);
                } else {
                    db.prepare(`
                        INSERT INTO stock (product_id, location_id, quantity)
                        VALUES (?, ?, ?)
                    `).run(item.productId, item.locationId, item.stockQuantity);
                }

                db.prepare(`
                    INSERT INTO stock_movements (
                        product_id, location_id, movement_type, quantity,
                        reference_type, reference_id, notes
                    )
                    VALUES (?, ?, 'return', ?, 'sales_return', ?, ?)
                `).run(
                    item.productId,
                    item.locationId,
                    item.stockQuantity,
                    returnId,
                    `مرتجع ${returnNumber} للفاتورة ${sale.invoice_number}`
                );
            }

            if (balanceCreditAmount > 0 && sale.customer_id) {
                db.prepare(`
                    INSERT INTO customer_transactions (
                        customer_id, transaction_type, reference_type, reference_id,
                        debit, credit, notes
                    )
                    VALUES (?, 'return', 'sales_return', ?, 0, ?, ?)
                `).run(
                    sale.customer_id,
                    returnId,
                    balanceCreditAmount,
                    `خصم مرتجع ${returnNumber} من حساب الفاتورة ${sale.invoice_number}`
                );
            }

            if (cashRefundAmount > 0) {
                const cashAccount = db.prepare(`
                    SELECT id FROM cash_accounts
                    WHERE name = 'الخزنة الرئيسية' AND is_active = 1
                    LIMIT 1
                `).get();
                if (!cashAccount) throw new Error("الخزنة الرئيسية غير موجودة");

                db.prepare(`
                    INSERT INTO cash_transactions (
                        cash_account_id, transaction_type, direction, amount,
                        reference_type, reference_id, description
                    )
                    VALUES (?, 'sale_return', 'out', ?, 'sales_return', ?, ?)
                `).run(
                    cashAccount.id,
                    cashRefundAmount,
                    returnId,
                    `رد نقدي لمرتجع ${returnNumber} من الفاتورة ${sale.invoice_number}`
                );
            }

            db.prepare(`
                UPDATE sales
                SET remaining_amount = MAX(0, remaining_amount - ?),
                    sale_type = CASE
                        WHEN sale_type = 'plumbing_order' THEN sale_type
                        WHEN remaining_amount - ? <= 0.000001 THEN 'cash'
                        ELSE 'credit'
                    END
                WHERE id = ?
            `).run(balanceCreditAmount, balanceCreditAmount, id);

            return {
                success: true,
                returnId,
                returnNumber,
                totalAmount,
                balanceCreditAmount,
                cashRefundAmount
            };
        })();
    });

    // =========================
    // CUSTOMER RESERVATIONS
    // =========================
    ipcMain.handle("reservations:getAll", () => {
        return db.prepare(`
            SELECT r.*,
                s.invoice_number AS invoice_number,
                COALESCE((
                    SELECT GROUP_CONCAT(p.name || ' × ' || ri.quantity, '، ')
                    FROM reservation_items ri
                    JOIN products p ON p.id = ri.product_id
                    WHERE ri.reservation_id = r.id
                ), '') AS items_summary,
                (SELECT COUNT(*) FROM reservation_items ri WHERE ri.reservation_id = r.id) AS item_count
            FROM reservations r
            LEFT JOIN sales s ON s.id = r.sale_id
            ORDER BY r.id DESC
            LIMIT 250
        `).all();
    });

    ipcMain.handle("reservations:create", (_event, payload) => db.transaction(() => {
        if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
            throw new Error("أضف صنفًا واحدًا على الأقل للحجز");
        }
        const customerName = String(payload.customer_name || "").trim();
        if (!customerName) throw new Error("اكتب اسم العميل");
        const phone = String(payload.customer_phone || "").trim() || null;
        const dueDate = String(payload.due_date || "").trim() || null;
        const notes = String(payload.notes || "").trim() || null;

        const requested = new Map();
        const prepared = [];
        let subtotal = 0;
        for (const input of payload.items) {
            const productId = Number(input.product_id);
            const quantity = Number(input.quantity);
            const unitPrice = Number(input.unit_price);
            if (!Number.isInteger(productId) || productId <= 0) throw new Error("اختر صنفًا صحيحًا");
            if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("أدخل كمية صحيحة لكل صنف");
            if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("سعر أحد الأصناف غير صحيح");
            const product = db.prepare(`
                SELECT id, name, sale_price, purchase_price
                FROM products WHERE id = ? AND is_active = 1
            `).get(productId);
            if (!product) throw new Error("أحد المنتجات غير موجود أو غير نشط");
            requested.set(productId, Number(requested.get(productId) || 0) + quantity);
            const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
            prepared.push({
                productId,
                productName: product.name,
                quantity,
                unitPrice,
                purchasePrice: Number(product.purchase_price || 0),
                lineTotal
            });
            subtotal += lineTotal;
        }
        subtotal = Math.round(subtotal * 100) / 100;
        if (subtotal <= 0) throw new Error("إجمالي الحجز يجب أن يكون أكبر من صفر");

        for (const [productId, quantity] of requested) {
            const product = prepared.find((item) => item.productId === productId);
            const physical = Number(db.prepare(`
                SELECT COALESCE(SUM(quantity), 0) AS quantity
                FROM stock WHERE product_id = ?
            `).get(productId).quantity || 0);
            const reserved = Number(db.prepare(`
                SELECT COALESCE(SUM(ri.quantity), 0) AS quantity
                FROM reservation_items ri
                JOIN reservations r ON r.id = ri.reservation_id
                WHERE ri.product_id = ? AND r.status = 'pending'
            `).get(productId).quantity || 0);
            if (quantity > physical - reserved + 0.000001) {
                throw new Error(`الكمية المتاحة للحجز من "${product.productName}" هي ${Math.max(0, physical - reserved)}`);
            }
        }

        const deposit = Math.round(Number(payload.deposit || 0) * 100) / 100;
        if (!Number.isFinite(deposit) || deposit < 0) throw new Error("قيمة العربون غير صحيحة");
        if (deposit > subtotal + 0.000001) throw new Error("العربون أكبر من إجمالي الحجز");
        let cashAccount = null;
        if (deposit > 0) {
            cashAccount = db.prepare(`
                SELECT id FROM cash_accounts
                WHERE name = 'الخزنة الرئيسية' AND is_active = 1
                LIMIT 1
            `).get();
            if (!cashAccount) throw new Error("الخزنة الرئيسية غير موجودة أو غير نشطة");
        }

        const existingCustomer = db.prepare(`
            SELECT id FROM customers WHERE name = ? LIMIT 1
        `).get(customerName);
        const customerId = existingCustomer ? Number(existingCustomer.id) : null;
        const nextId = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM reservations").get().id);
        const reservationNumber = `R-${String(nextId).padStart(6, "0")}`;
        const result = db.prepare(`
            INSERT INTO reservations (
                reservation_number, customer_id, customer_name, customer_phone,
                due_date, notes, subtotal, total_amount, paid_amount, remaining_amount, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `).run(
            reservationNumber, customerId, customerName, phone,
            dueDate, notes, subtotal, subtotal, deposit, subtotal - deposit
        );
        const reservationId = Number(result.lastInsertRowid);
        const insertItem = db.prepare(`
            INSERT INTO reservation_items
                (reservation_id, product_id, quantity, unit_price, purchase_price, total_amount)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const item of prepared) {
            insertItem.run(
                reservationId, item.productId, item.quantity,
                item.unitPrice, item.purchasePrice, item.lineTotal
            );
        }
        if (deposit > 0) {
            db.prepare(`
                INSERT INTO reservation_payments
                    (reservation_id, amount, payment_type, cash_account_id, payment_method, notes)
                VALUES (?, ?, 'deposit', ?, 'cash', ?)
            `).run(reservationId, deposit, cashAccount.id, "عربون حجز " + reservationNumber);
            db.prepare(`
                INSERT INTO cash_transactions
                    (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
                VALUES (?, 'reservation_deposit', 'in', ?, 'reservation', ?, ?)
            `).run(cashAccount.id, deposit, reservationId, "عربون حجز " + reservationNumber);
        }
        return {
            success: true,
            id: reservationId,
            reservationNumber,
            totalAmount: subtotal,
            paidAmount: deposit,
            remainingAmount: subtotal - deposit
        };
    })());

    ipcMain.handle("reservations:addPayment", (_event, reservationId, amountInput) => db.transaction(() => {
        const id = Number(reservationId);
        const amount = Math.round(Number(amountInput) * 100) / 100;
        if (!Number.isInteger(id) || id <= 0) throw new Error("اختر حجزًا صحيحًا");
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("أدخل مبلغ دفعة صحيحًا");
        const reservation = db.prepare("SELECT * FROM reservations WHERE id = ?").get(id);
        if (!reservation) throw new Error("الحجز غير موجود");
        if (reservation.status !== "pending") throw new Error("لا يمكن تحصيل دفعة لحجز غير نشط");
        if (amount > Number(reservation.remaining_amount || 0) + 0.000001) {
            throw new Error("الدفعة أكبر من المبلغ المتبقي");
        }
        const account = db.prepare(`
            SELECT id FROM cash_accounts
            WHERE name = 'الخزنة الرئيسية' AND is_active = 1 LIMIT 1
        `).get();
        if (!account) throw new Error("الخزنة الرئيسية غير موجودة أو غير نشطة");
        db.prepare(`
            INSERT INTO reservation_payments
                (reservation_id, amount, payment_type, cash_account_id, payment_method, notes)
            VALUES (?, ?, 'payment', ?, 'cash', ?)
        `).run(id, amount, account.id, "دفعة على الحجز " + reservation.reservation_number);
        db.prepare(`
            INSERT INTO cash_transactions
                (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
            VALUES (?, 'reservation_payment', 'in', ?, 'reservation', ?, ?)
        `).run(account.id, amount, id, "دفعة على الحجز " + reservation.reservation_number);
        const paid = Math.round((Number(reservation.paid_amount || 0) + amount) * 100) / 100;
        const remaining = Math.max(0, Math.round((Number(reservation.total_amount) - paid) * 100) / 100);
        db.prepare(`
            UPDATE reservations SET paid_amount = ?, remaining_amount = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(paid, remaining, id);
        return { success: true, paidAmount: paid, remainingAmount: remaining };
    })());

    ipcMain.handle("reservations:cancel", (_event, reservationId) => db.transaction(() => {
        const id = Number(reservationId);
        const reservation = db.prepare("SELECT * FROM reservations WHERE id = ?").get(id);
        if (!reservation) throw new Error("الحجز غير موجود");
        if (reservation.status !== "pending") throw new Error("لا يمكن إلغاء حجز تم تسليمه أو إلغاؤه من قبل");
        const refund = Math.round(Number(reservation.paid_amount || 0) * 100) / 100;
        if (refund > 0) {
            const account = db.prepare(`
                SELECT id FROM cash_accounts
                WHERE name = 'الخزنة الرئيسية' AND is_active = 1 LIMIT 1
            `).get();
            if (!account) throw new Error("لا يمكن رد العربون: الخزنة الرئيسية غير موجودة أو غير نشطة");
            db.prepare(`
                INSERT INTO reservation_payments
                    (reservation_id, amount, payment_type, cash_account_id, payment_method, notes)
                VALUES (?, ?, 'refund', ?, 'cash', ?)
            `).run(id, refund, account.id, "رد مبالغ الحجز الملغي " + reservation.reservation_number);
            db.prepare(`
                INSERT INTO cash_transactions
                    (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
                VALUES (?, 'reservation_refund', 'out', ?, 'reservation', ?, ?)
            `).run(account.id, refund, id, "رد مبالغ الحجز الملغي " + reservation.reservation_number);
        }
        db.prepare(`
            UPDATE reservations
            SET status = 'cancelled', paid_amount = 0, remaining_amount = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(id);
        return { success: true, refundedAmount: refund };
    })());

    ipcMain.handle("reservations:deliver", (_event, reservationId, additionalPaymentInput) => db.transaction(() => {
        const id = Number(reservationId);
        const additionalPayment = Math.round(Number(additionalPaymentInput || 0) * 100) / 100;
        if (!Number.isInteger(id) || id <= 0) throw new Error("اختر حجزًا صحيحًا");
        if (!Number.isFinite(additionalPayment) || additionalPayment < 0) throw new Error("مبلغ التحصيل عند التسليم غير صحيح");
        const reservation = db.prepare("SELECT * FROM reservations WHERE id = ?").get(id);
        if (!reservation) throw new Error("الحجز غير موجود");
        if (reservation.status !== "pending") throw new Error("هذا الحجز ليس قيد الانتظار");
        const items = db.prepare(`
            SELECT ri.*, p.name AS product_name, p.unit AS product_unit
            FROM reservation_items ri
            JOIN products p ON p.id = ri.product_id
            WHERE ri.reservation_id = ? ORDER BY ri.id
        `).all(id);
        if (!items.length) throw new Error("الحجز لا يحتوي على أصناف");

        const total = Math.round(Number(reservation.total_amount || 0) * 100) / 100;
        const paidBefore = Math.round(Number(reservation.paid_amount || 0) * 100) / 100;
        if (additionalPayment > Number(reservation.remaining_amount || 0) + 0.000001) {
            throw new Error("المبلغ المحصل أكبر من المتبقي على الحجز");
        }
        const totalPaid = Math.round((paidBefore + additionalPayment) * 100) / 100;
        const remaining = Math.max(0, Math.round((total - totalPaid) * 100) / 100);

        const showroom = db.prepare("SELECT id FROM locations WHERE name = 'المعرض' LIMIT 1").get();
        const warehouse = db.prepare("SELECT id FROM locations WHERE name = 'المخزن' LIMIT 1").get();
        if (!showroom || !warehouse) throw new Error("يجب التأكد من وجود موقعَي المعرض والمخزن");
        const itemQuantities = new Map();
        for (const item of items) {
            itemQuantities.set(
                Number(item.product_id),
                Number(itemQuantities.get(Number(item.product_id)) || 0) + Number(item.quantity)
            );
        }
        for (const [productId, quantity] of itemQuantities) {
            const physical = Number(db.prepare(`
                SELECT COALESCE(SUM(quantity), 0) AS quantity
                FROM stock WHERE product_id = ?
            `).get(productId).quantity || 0);
            const reservedOther = Number(db.prepare(`
                SELECT COALESCE(SUM(ri.quantity), 0) AS quantity
                FROM reservation_items ri
                JOIN reservations r ON r.id = ri.reservation_id
                WHERE ri.product_id = ? AND r.status = 'pending' AND r.id <> ?
            `).get(productId, id).quantity || 0);
            if (quantity + reservedOther > physical + 0.000001) {
                throw new Error(`المخزون الحالي من أحد الأصناف لا يكفي لتسليم الحجز مع الحفاظ على الحجوزات الأخرى`);
            }
        }

        const stockCache = new Map();
        const readStock = (productId, locationId) => {
            const key = `${productId}:${locationId}`;
            if (!stockCache.has(key)) {
                const row = db.prepare(`
                    SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?
                `).get(productId, locationId);
                stockCache.set(key, Number(row?.quantity || 0));
            }
            return Number(stockCache.get(key) || 0);
        };
        const allocations = [];
        for (const item of items) {
            const itemAllocationStart = allocations.length;
            let needed = Number(item.quantity);
            const fromShowroom = Math.min(needed, readStock(item.product_id, showroom.id));
            if (fromShowroom > 0) {
                allocations.push({ item, locationId: Number(showroom.id), quantity: fromShowroom });
                const key = `${item.product_id}:${showroom.id}`;
                stockCache.set(key, readStock(item.product_id, showroom.id) - fromShowroom);
                needed -= fromShowroom;
            }
            const fromWarehouse = Math.min(needed, readStock(item.product_id, warehouse.id));
            if (fromWarehouse > 0) {
                allocations.push({ item, locationId: Number(warehouse.id), quantity: fromWarehouse });
                const key = `${item.product_id}:${warehouse.id}`;
                stockCache.set(key, readStock(item.product_id, warehouse.id) - fromWarehouse);
                needed -= fromWarehouse;
            }
            if (needed > 0.000001) {
                throw new Error(`كمية "${item.product_name}" غير متوفرة حاليًا في المعرض والمخزن`);
            }
            const itemAllocations = allocations.slice(itemAllocationStart);
            let allocatedAmount = 0;
            itemAllocations.forEach((allocation, index) => {
                const isLastChunk = index === itemAllocations.length - 1;
                const chunkAmount = isLastChunk
                    ? Math.round((Number(item.total_amount || 0) - allocatedAmount) * 100) / 100
                    : Math.round(Number(allocation.quantity) * Number(item.unit_price) * 100) / 100;
                allocation.lineTotal = chunkAmount;
                allocatedAmount = Math.round((allocatedAmount + chunkAmount) * 100) / 100;
            });
        }

        let account = null;
        if (additionalPayment > 0) {
            account = db.prepare(`
                SELECT id FROM cash_accounts
                WHERE name = 'الخزنة الرئيسية' AND is_active = 1 LIMIT 1
            `).get();
            if (!account) throw new Error("الخزنة الرئيسية غير موجودة أو غير نشطة");
        }

        let customerId = reservation.customer_id ? Number(reservation.customer_id) : null;
        if (!customerId) {
            const existing = db.prepare("SELECT id FROM customers WHERE name = ? LIMIT 1").get(reservation.customer_name);
            if (existing) {
                customerId = Number(existing.id);
            } else {
                const created = db.prepare(`
                    INSERT INTO customers (name, phone, is_active) VALUES (?, ?, 1)
                `).run(reservation.customer_name, reservation.customer_phone || null);
                customerId = Number(created.lastInsertRowid);
            }
        }

        const nextSaleId = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM sales").get().nextId);
        const invoiceNumber = `S-${String(nextSaleId).padStart(6, "0")}`;
        const headerLocationId = Number(showroom.id || warehouse.id);
        const saleResult = db.prepare(`
            INSERT INTO sales (
                invoice_number, customer_id, location_id, sale_type, subtotal,
                plumbing_discount_percent, plumbing_discount_amount, general_discount_amount,
                total_amount, paid_amount, remaining_amount, notes, due_date, status
            )
            VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, 'completed')
        `).run(
            invoiceNumber, customerId, headerLocationId,
            remaining > 0 ? "credit" : "cash",
            total, total, totalPaid, remaining,
            [reservation.notes, "تحويل حجز " + reservation.reservation_number].filter(Boolean).join(" | "),
            reservation.due_date || null
        );
        const saleId = Number(saleResult.lastInsertRowid);

        const insertSaleItem = db.prepare(`
            INSERT INTO sale_items
                (sale_id, product_id, location_id, quantity, unit_price, total_amount,
                 purchase_price, discount_amount, display_quantity, display_unit, display_unit_price)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
        `);
        const updateStock = db.prepare(`
            UPDATE stock SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = ? AND location_id = ? AND quantity + 0.000001 >= ?
        `);
        const insertMovement = db.prepare(`
            INSERT INTO stock_movements
                (product_id, location_id, movement_type, quantity, reference_type, reference_id, notes)
            VALUES (?, ?, 'sale', ?, 'sale', ?, ?)
        `);
        for (const allocation of allocations) {
            const item = allocation.item;
            const qty = Number(allocation.quantity);
            const lineTotal = Number(allocation.lineTotal ?? Math.round(qty * Number(item.unit_price) * 100) / 100);
            const stockResult = updateStock.run(qty, item.product_id, allocation.locationId, qty);
            if (!stockResult.changes) throw new Error(`تعذر خصم مخزون "${item.product_name}"`);
            insertSaleItem.run(
                saleId, item.product_id, allocation.locationId, qty,
                Number(item.unit_price), lineTotal, Number(item.purchase_price || 0),
                qty, String(item.product_unit || ""), Number(item.unit_price)
            );
            insertMovement.run(
                item.product_id, allocation.locationId, -qty, saleId,
                "تسليم حجز " + reservation.reservation_number
            );
        }

        // Carry prior reservation payments into the sale payment history using their original timestamps.
        const insertSalePayment = db.prepare(`
            INSERT INTO sale_payments (sale_id, amount, payment_method, notes, created_at)
            VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        `);
        const priorReservationPayments = db.prepare(`
            SELECT amount, payment_method, notes, created_at
            FROM reservation_payments
            WHERE reservation_id = ? AND payment_type IN ('deposit', 'payment')
            ORDER BY id
        `).all(id);
        for (const payment of priorReservationPayments) {
            insertSalePayment.run(
                saleId, Number(payment.amount), payment.payment_method || "cash",
                payment.notes || "دفعة سابقة على الحجز", payment.created_at || null
            );
        }
        if (additionalPayment > 0) {
            insertSalePayment.run(saleId, additionalPayment, "cash", "تحصيل عند تسليم الحجز", null);
            db.prepare(`
                INSERT INTO cash_transactions
                    (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
                VALUES (?, 'sale', 'in', ?, 'sale', ?, ?)
            `).run(account.id, additionalPayment, saleId, `تحصيل عند تسليم الحجز ${reservation.reservation_number}`);
            db.prepare(`
                INSERT INTO reservation_payments
                    (reservation_id, amount, payment_type, cash_account_id, sale_id, payment_method, notes)
                VALUES (?, ?, 'delivery', ?, ?, 'cash', ?)
            `).run(id, additionalPayment, account.id, saleId, "تحصيل عند التسليم");
        }

        db.prepare(`
            INSERT INTO customer_transactions
                (customer_id, transaction_type, reference_type, reference_id, debit, credit, notes)
            VALUES (?, 'sale', 'sale', ?, ?, 0, ?)
        `).run(customerId, saleId, total, "فاتورة " + invoiceNumber + " من الحجز " + reservation.reservation_number);
        if (totalPaid > 0) {
            db.prepare(`
                INSERT INTO customer_transactions
                    (customer_id, transaction_type, reference_type, reference_id, debit, credit, notes)
                VALUES (?, 'payment', 'sale', ?, 0, ?, ?)
            `).run(customerId, saleId, totalPaid, "دفعات الحجز " + reservation.reservation_number);
        }

        db.prepare(`
            UPDATE reservations
            SET customer_id = ?, status = 'completed', sale_id = ?,
                paid_amount = ?, remaining_amount = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(customerId, saleId, totalPaid, remaining, id);

        return {
            success: true,
            id,
            reservationNumber: reservation.reservation_number,
            saleId,
            invoiceNumber,
            totalAmount: total,
            paidAmount: totalPaid,
            remainingAmount: remaining
        };
    })());

    // worker-payroll-backend-v1
    // Dates are evaluated as local calendar dates (not UTC) to preserve the worker's hire-day cycle.
    function workerIsoDate(dateValue) {
        const date = new Date(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate(), 12, 0, 0, 0);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
    function workerParseIsoDate(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
        if (!match) throw new Error("تاريخ بداية العمل غير صحيح");
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
        if (workerIsoDate(date) !== value) throw new Error("تاريخ بداية العمل غير صحيح");
        return date;
    }
    function workerAddMonthsFromAnchor(startIso, offset) {
        const start = workerParseIsoDate(startIso);
        const monthIndex = start.getFullYear() * 12 + start.getMonth() + Number(offset);
        const year = Math.floor(monthIndex / 12);
        const month = ((monthIndex % 12) + 12) % 12;
        const lastDay = new Date(year, month + 1, 0, 12).getDate();
        return workerIsoDate(new Date(year, month, Math.min(start.getDate(), lastDay), 12));
    }
    function workerPreviousDay(isoDate) {
        const date = workerParseIsoDate(isoDate);
        date.setDate(date.getDate() - 1);
        return workerIsoDate(date);
    }
    function workerEnsurePayrollCycles(worker, todayIso) {
        const start = workerParseIsoDate(worker.start_date);
        const today = workerParseIsoDate(todayIso);
        const trackingStartIso = String(worker.payroll_start_date || worker.start_date).slice(0, 10);
        workerParseIsoDate(trackingStartIso);
        const indexForDate = (isoDate) => {
            const target = workerParseIsoDate(isoDate);
            let monthIndex = (target.getFullYear() - start.getFullYear()) * 12 + (target.getMonth() - start.getMonth());
            if (monthIndex < 0) return 0;
            while (monthIndex > 0 && workerAddMonthsFromAnchor(worker.start_date, monthIndex) > isoDate) monthIndex--;
            while (workerAddMonthsFromAnchor(worker.start_date, monthIndex + 1) <= isoDate) monthIndex++;
            return monthIndex;
        };
        const firstIndex = indexForDate(trackingStartIso);
        const lastIndex = Math.max(firstIndex, indexForDate(todayIso));
        const insert = db.prepare(`
            INSERT OR IGNORE INTO worker_payroll_cycles
                (worker_id, period_start, period_end, due_date, salary_amount, status)
            VALUES (?, ?, ?, ?, ?, 'open')
        `);
        for (let month = firstIndex; month <= lastIndex; month++) {
            const periodStart = workerAddMonthsFromAnchor(worker.start_date, month);
            const dueDate = workerAddMonthsFromAnchor(worker.start_date, month + 1);
            insert.run(Number(worker.id), periodStart, workerPreviousDay(dueDate), dueDate, Number(worker.monthly_salary || 0));
        }
    }
    function workerRoundMoney(value) { return Math.round(Number(value || 0) * 100) / 100; }
    function workerGetCurrentCycle(workerId, todayIso) {
        return db.prepare(`
            SELECT * FROM worker_payroll_cycles
            WHERE worker_id = ? AND period_start <= ? AND period_end >= ?
            ORDER BY period_start DESC LIMIT 1
        `).get(workerId, todayIso, todayIso) || null;
    }
    function workerGetPrimaryCashAccount() {
        const account = db.prepare(`SELECT id FROM cash_accounts WHERE name = 'الخزنة الرئيسية' AND is_active = 1 LIMIT 1`).get();
        if (!account) throw new Error("الخزنة الرئيسية غير موجودة أو غير نشطة؛ لم يتم تسجيل الحركة.");
        return account;
    }
    function workerCycleWithTotals(cycle) {
        const advances = workerRoundMoney(db.prepare(`
            SELECT COALESCE(SUM(amount), 0) AS total FROM worker_transactions
            WHERE cycle_id = ? AND transaction_type = 'advance'
        `).get(cycle.id).total);
        const salary = workerRoundMoney(cycle.salary_amount);
        return { ...cycle, salary_amount: salary, advances_total: advances, remaining_salary: Math.max(0, workerRoundMoney(salary - advances)) };
    }

    ipcMain.handle("workers:getAll", () => db.transaction(() => {
        const today = workerIsoDate(new Date());
        const rows = db.prepare(`SELECT * FROM workers ORDER BY is_active DESC, name COLLATE NOCASE`).all();
        for (const worker of rows) workerEnsurePayrollCycles(worker, today);
        return rows.map((worker) => {
            let cycle = workerGetCurrentCycle(worker.id, today);
            if (!cycle) cycle = db.prepare(`SELECT * FROM worker_payroll_cycles WHERE worker_id = ? ORDER BY period_start LIMIT 1`).get(worker.id);
            const currentCycle = cycle ? workerCycleWithTotals(cycle) : null;
            const dueCycles = db.prepare(`
                SELECT * FROM worker_payroll_cycles
                WHERE worker_id = ? AND status = 'open' AND due_date <= ?
                ORDER BY due_date, id
            `).all(worker.id, today).map(workerCycleWithTotals);
            const dueTotal = workerRoundMoney(dueCycles.reduce((sum, entry) => sum + entry.remaining_salary, 0));
            return { ...worker, current_cycle: currentCycle, due_cycles: dueCycles, due_cycle_count: dueCycles.length, due_total: dueTotal };
        });
    })());

    ipcMain.handle("workers:getLedger", (_event, workerIdInput) => db.transaction(() => {
        const workerId = Number(workerIdInput);
        if (!Number.isInteger(workerId) || workerId <= 0) throw new Error("اختر عاملًا صحيحًا");
        const worker = db.prepare(`SELECT * FROM workers WHERE id = ?`).get(workerId);
        if (!worker) throw new Error("العامل غير موجود");
        workerEnsurePayrollCycles(worker, workerIsoDate(new Date()));
        const cycles = db.prepare(`SELECT * FROM worker_payroll_cycles WHERE worker_id = ? ORDER BY period_start DESC LIMIT 120`).all(workerId).map(workerCycleWithTotals);
        const transactions = db.prepare(`
            SELECT wt.*, ca.name AS cash_account_name, c.period_start, c.period_end, c.due_date
            FROM worker_transactions wt
            JOIN worker_payroll_cycles c ON c.id = wt.cycle_id
            LEFT JOIN cash_accounts ca ON ca.id = wt.cash_account_id
            WHERE wt.worker_id = ? ORDER BY wt.id DESC LIMIT 300
        `).all(workerId);
        return { worker, cycles, transactions };
    })());

    ipcMain.handle("workers:create", (_event, payload) => db.transaction(() => {
        if (!payload) throw new Error("أدخل بيانات العامل");
        const name = String(payload.name || "").trim();
        const phone = String(payload.phone || "").trim() || null;
        const jobTitle = String(payload.job_title || "").trim() || null;
        const salary = workerRoundMoney(payload.monthly_salary);
        const startDate = String(payload.start_date || "").trim();
        if (!name) throw new Error("اسم العامل مطلوب");
        if (!Number.isFinite(salary) || salary <= 0) throw new Error("اكتب مرتبًا شهريًا أكبر من صفر");
        workerParseIsoDate(startDate);
        const result = db.prepare(`
            INSERT INTO workers (name, phone, job_title, monthly_salary, start_date, payroll_start_date, is_active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        `).run(name, phone, jobTitle, salary, startDate, workerIsoDate(new Date()));
        const worker = db.prepare(`SELECT * FROM workers WHERE id = ?`).get(Number(result.lastInsertRowid));
        workerEnsurePayrollCycles(worker, workerIsoDate(new Date()));
        return { success: true, id: Number(worker.id), name: worker.name };
    })());

    ipcMain.handle("workers:update", (_event, workerIdInput, payload) => db.transaction(() => {
        const workerId = Number(workerIdInput);
        if (!Number.isInteger(workerId) || workerId <= 0 || !payload) throw new Error("بيانات العامل غير صحيحة");
        const current = db.prepare(`SELECT * FROM workers WHERE id = ?`).get(workerId);
        if (!current) throw new Error("العامل غير موجود");
        const name = String(payload.name || "").trim();
        const phone = String(payload.phone || "").trim() || null;
        const jobTitle = String(payload.job_title || "").trim() || null;
        const salary = workerRoundMoney(payload.monthly_salary);
        if (!name) throw new Error("اسم العامل مطلوب");
        if (!Number.isFinite(salary) || salary <= 0) throw new Error("اكتب مرتبًا شهريًا أكبر من صفر");
        const isActive = payload.is_active === false || Number(payload.is_active) === 0 ? 0 : 1;
        db.prepare(`UPDATE workers SET name = ?, phone = ?, job_title = ?, monthly_salary = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(name, phone, jobTitle, salary, isActive, workerId);
        const today = workerIsoDate(new Date());
        // Only future, untouched cycles adopt a newly edited salary; the in-progress month keeps its agreed salary snapshot.
        db.prepare(`
            UPDATE worker_payroll_cycles SET salary_amount = ?
            WHERE worker_id = ? AND status = 'open' AND period_start > ?
              AND NOT EXISTS (SELECT 1 FROM worker_transactions wt WHERE wt.cycle_id = worker_payroll_cycles.id)
        `).run(salary, workerId, today);
        return { success: true, id: workerId, is_active: isActive };
    })());

    ipcMain.handle("workers:addAdvance", (_event, workerIdInput, amountInput, descriptionInput) => db.transaction(() => {
        const workerId = Number(workerIdInput);
        const amount = workerRoundMoney(amountInput);
        const description = String(descriptionInput || "").trim() || "سلفة / مصروف شخصي";
        if (!Number.isInteger(workerId) || workerId <= 0) throw new Error("اختر عاملًا صحيحًا");
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("قيمة المسحوب يجب أن تكون أكبر من صفر");
        const worker = db.prepare(`SELECT * FROM workers WHERE id = ?`).get(workerId);
        if (!worker) throw new Error("العامل غير موجود");
        if (Number(worker.is_active) !== 1) throw new Error("لا يمكن تسجيل سلفة لعامل غير نشط");
        const today = workerIsoDate(new Date());
        if (today < worker.start_date) throw new Error("تاريخ بداية العمل لم يأتِ بعد؛ لا يمكن تسجيل سحب الآن");
        workerEnsurePayrollCycles(worker, today);
        const cycle = workerGetCurrentCycle(workerId, today);
        if (!cycle || cycle.status !== "open") throw new Error("لم يتم العثور على دورة المرتب الحالية");
        const totals = workerCycleWithTotals(cycle);
        if (amount > totals.remaining_salary + 0.000001) {
            throw new Error(`المتاح من مرتب الدورة الحالية ${totals.remaining_salary.toFixed(2)} ج.م فقط. لا يمكن تسجيل سحوبات أعلى من مرتب الدورة.`);
        }
        const account = workerGetPrimaryCashAccount();
        const txResult = db.prepare(`
            INSERT INTO worker_transactions (worker_id, cycle_id, transaction_type, amount, cash_account_id, description)
            VALUES (?, ?, 'advance', ?, ?, ?)
        `).run(workerId, cycle.id, amount, account.id, description);
        const workerTransactionId = Number(txResult.lastInsertRowid);
        const cashResult = db.prepare(`
            INSERT INTO cash_transactions
                (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
            VALUES (?, 'expense', 'out', ?, 'worker_transaction', ?, ?)
        `).run(account.id, amount, workerTransactionId, `سلفة / مصروف للعامل ${worker.name}: ${description}`);
        db.prepare(`UPDATE worker_transactions SET cash_transaction_id = ? WHERE id = ?`).run(Number(cashResult.lastInsertRowid), workerTransactionId);
        return { success: true, amount, workerTransactionId, remainingSalary: workerRoundMoney(totals.remaining_salary - amount) };
    })());

    ipcMain.handle("workers:payCycle", (_event, cycleIdInput) => db.transaction(() => {
        const cycleId = Number(cycleIdInput);
        if (!Number.isInteger(cycleId) || cycleId <= 0) throw new Error("دورة المرتب غير صحيحة");
        const cycle = db.prepare(`
            SELECT c.*, w.name AS worker_name, w.is_active
            FROM worker_payroll_cycles c JOIN workers w ON w.id = c.worker_id
            WHERE c.id = ?
        `).get(cycleId);
        if (!cycle) throw new Error("دورة المرتب غير موجودة");
        if (cycle.status !== "open") throw new Error("تمت تصفية هذه الدورة بالفعل");
        const today = workerIsoDate(new Date());
        if (cycle.due_date > today) throw new Error(`موعد القبض ${cycle.due_date}؛ لا يمكن تصفية المرتب قبل موعده`);
        const totals = workerCycleWithTotals(cycle);
        if (totals.advances_total > totals.salary_amount + 0.000001) throw new Error("إجمالي السلف أكبر من مرتب الدورة؛ راجع سجل العامل قبل التصفية");
        const payout = workerRoundMoney(Math.max(0, totals.salary_amount - totals.advances_total));
        let account = null;
        if (payout > 0) account = workerGetPrimaryCashAccount();
        const description = `صرف باقي مرتب ${cycle.worker_name} للفترة ${cycle.period_start} إلى ${cycle.period_end}`;
        const txResult = db.prepare(`
            INSERT INTO worker_transactions (worker_id, cycle_id, transaction_type, amount, cash_account_id, description)
            VALUES (?, ?, 'salary_payout', ?, ?, ?)
        `).run(Number(cycle.worker_id), cycleId, payout, account ? account.id : null, description);
        const workerTransactionId = Number(txResult.lastInsertRowid);
        if (payout > 0) {
            const cashResult = db.prepare(`
                INSERT INTO cash_transactions
                    (cash_account_id, transaction_type, direction, amount, reference_type, reference_id, description)
                VALUES (?, 'expense', 'out', ?, 'worker_transaction', ?, ?)
            `).run(account.id, payout, workerTransactionId, description);
            db.prepare(`UPDATE worker_transactions SET cash_transaction_id = ? WHERE id = ?`).run(Number(cashResult.lastInsertRowid), workerTransactionId);
        }
        db.prepare(`UPDATE worker_payroll_cycles SET status = 'paid', payout_amount = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'`).run(payout, cycleId);
        return { success: true, workerName: cycle.worker_name, periodStart: cycle.period_start, periodEnd: cycle.period_end, salaryAmount: totals.salary_amount, advancesTotal: totals.advances_total, payoutAmount: payout };
    })());
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


            const dueDate = String(sale.due_date || "").trim() || null;


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



                const displayQuantity = Number(
                    item.display_quantity ?? item.displayQuantity ?? quantity
                );
                const displayUnit =
                    String(item.display_unit ?? item.displayUnit ?? "").trim() || null;
                const displayUnitPrice = Number(
                    item.display_unit_price ?? item.displayUnitPrice ?? unitPrice
                );

                preparedItems.push({
                    productId,
                    quantity,
                    unitPrice,
                    total,
                    displayQuantity,
                    displayUnit,
                    displayUnitPrice,
                    purchasePrice: Number(product.purchase_price || 0)

                });

            }


            // =========================
            // Protect pending reservations from being consumed by ordinary sales.
            const reservedSaleQuantities = new Map();
            for (const row of preparedItems) {
                reservedSaleQuantities.set(
                    Number(row.productId),
                    Number(reservedSaleQuantities.get(Number(row.productId)) || 0) + Number(row.quantity)
                );
            }
            for (const [reservedProductId, requestedQuantity] of reservedSaleQuantities) {
                const physicalQuantity = Number(db.prepare(
                    "SELECT COALESCE(SUM(quantity), 0) AS quantity FROM stock WHERE product_id = ?"
                ).get(reservedProductId).quantity || 0);
                const heldQuantity = Number(db.prepare(`
                    SELECT COALESCE(SUM(ri.quantity), 0) AS quantity
                    FROM reservation_items ri
                    JOIN reservations r ON r.id = ri.reservation_id
                    WHERE ri.product_id = ? AND r.status = 'pending'
                `).get(reservedProductId).quantity || 0);
                if (requestedQuantity > physicalQuantity - heldQuantity + 0.000001) {
                    const row = db.prepare("SELECT name FROM products WHERE id = ?").get(reservedProductId);
                    throw new Error(`لا يمكن بيع كمية محجوزة للعميل من "${row?.name || "الصنف"}"`);
                }
            }
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
                    due_date,
                    status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'completed')
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
                    notes,
                    dueDate
                );

            const saleId = saleResult.lastInsertRowid;


            // =========================
            // INSERT SALE ITEMS
            // =========================

            const insertItem = db.prepare(`
    INSERT INTO sale_items (
        sale_id,
        product_id,
        location_id,
        quantity,
        unit_price,
        total_amount,
        purchase_price,
        display_quantity,
        display_unit,
        display_unit_price
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);


            for (const item of preparedItems) {

                insertItem.run(
                    saleId,
                    item.productId,
                    locationRow.id,
                    item.quantity,
                    item.unitPrice,
                    item.total,
                    item.purchasePrice,
                    item.displayQuantity,
                    item.displayUnit,
                    item.displayUnitPrice
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
            const dueDate = String(order.due_date || "").trim() || null;

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
            // Protect pending reservations from being consumed by plumbing orders.
            const reservedOrderQuantities = new Map();
            for (const row of preparedItems) {
                reservedOrderQuantities.set(
                    Number(row.productId),
                    Number(reservedOrderQuantities.get(Number(row.productId)) || 0) + Number(row.quantity)
                );
            }
            for (const [reservedProductId, requestedQuantity] of reservedOrderQuantities) {
                const physicalQuantity = Number(db.prepare(
                    "SELECT COALESCE(SUM(quantity), 0) AS quantity FROM stock WHERE product_id = ?"
                ).get(reservedProductId).quantity || 0);
                const heldQuantity = Number(db.prepare(`
                    SELECT COALESCE(SUM(ri.quantity), 0) AS quantity
                    FROM reservation_items ri
                    JOIN reservations r ON r.id = ri.reservation_id
                    WHERE ri.product_id = ? AND r.status = 'pending'
                `).get(reservedProductId).quantity || 0);
                if (requestedQuantity > physicalQuantity - heldQuantity + 0.000001) {
                    const row = db.prepare("SELECT name FROM products WHERE id = ?").get(reservedProductId);
                    throw new Error(`لا يمكن بيع كمية محجوزة للعميل من "${row?.name || "الصنف"}"`);
                }
            }
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
                due_date,
                status
            )
            VALUES (?, ?, ?, 'plumbing_order', ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
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
                notes,
                dueDate
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
            if (db.prepare("SELECT 1 FROM sales_returns WHERE sale_id = ? LIMIT 1").get(saleId)) {
                throw new Error("لا يمكن تعديل الفاتورة لوجود مرتجع مرتبط بها");
            }

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
            const dueDate = String(sale.due_date || "").trim() || null;

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

                const displayQuantity = Number(
    item.display_quantity ?? item.displayQuantity ?? quantity
);
const displayUnit =
    String(item.display_unit ?? item.displayUnit ?? "").trim() || null;
const displayUnitPrice = Number(
    item.display_unit_price ?? item.displayUnitPrice ?? unitPrice
);

preparedItems.push({
    productId,
    quantity,
    unitPrice,
    total,
    displayQuantity,
    displayUnit,
    displayUnitPrice,
    purchasePrice: Number(product.purchase_price || 0)
});

            }

            // Protect pending reservations while an existing invoice is edited.
            const editedSaleQuantities = new Map();
            for (const row of preparedItems) {
                editedSaleQuantities.set(
                    Number(row.productId),
                    Number(editedSaleQuantities.get(Number(row.productId)) || 0) + Number(row.quantity)
                );
            }
            for (const [reservedProductId, requestedQuantity] of editedSaleQuantities) {
                const physicalQuantity = Number(db.prepare(
                    "SELECT COALESCE(SUM(quantity), 0) AS quantity FROM stock WHERE product_id = ?"
                ).get(reservedProductId).quantity || 0);
                const heldQuantity = Number(db.prepare(`
                    SELECT COALESCE(SUM(ri.quantity), 0) AS quantity
                    FROM reservation_items ri
                    JOIN reservations r ON r.id = ri.reservation_id
                    WHERE ri.product_id = ? AND r.status = 'pending'
                `).get(reservedProductId).quantity || 0);
                if (requestedQuantity > physicalQuantity - heldQuantity + 0.000001) {
                    const row = db.prepare("SELECT name FROM products WHERE id = ?").get(reservedProductId);
                    throw new Error(`لا يمكن تعديل الفاتورة بكمية محجوزة للعميل من "${row?.name || "الصنف"}"`);
                }
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
                due_date = ?,
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
                dueDate,
                saleId
            );

            const invoiceNumber = oldSale.invoice_number;

            // ============================================
            // STEP 5: إدراج الأصناف الجديدة + خصم المخزون
            // ============================================
            const insertItem = db.prepare(`
    INSERT INTO sale_items (
        sale_id,
        product_id,
        location_id,
        quantity,
        unit_price,
        total_amount,
        purchase_price,
        display_quantity,
        display_unit,
        display_unit_price
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)


        `);
            for (const item of preparedItems) {
insertItem.run(
    saleId,
    item.productId,
    locationRow.id,
    item.quantity,
    item.unitPrice,
    item.total,
    item.purchasePrice,
    item.displayQuantity,
    item.displayUnit,
    item.displayUnitPrice
);

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
            // ELSHARQ_MAXIMIZE_BEFORE_MAIN_WINDOW_SHOW_V2
            if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
                mainWindow.maximize();
            }
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