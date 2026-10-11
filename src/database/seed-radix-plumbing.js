const catalog = require("./data/radix-plumbing-catalog.json");

const CATALOG_KEY = "catalog.radix-plumbing-2026-v1";
const COMPANY_DISCOUNT_PERCENT = 32;

function sizeCode(size) {
    return size
        .toUpperCase()
        .replaceAll("½", "HALF")
        .replaceAll("¼", "QUARTER")
        .replaceAll("¾", "THREEQUARTERS")
        .replace(/(\d)[.,](\d)/g, "$1P$2")
        .replaceAll("مم", "MM")
        .replaceAll("بوصة", "IN")
        .replaceAll("×", "X")
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

function seedRadixPlumbingCatalog(db) {
    const previousImport = db.prepare(
        "SELECT setting_value FROM settings WHERE setting_key = ?"
    ).get(CATALOG_KEY);
    if (previousImport) return { imported: false, added: 0 };

    return db.transaction(() => {
        const category = db.prepare(
            "SELECT id FROM categories WHERE name = 'سباكة' AND is_active = 1"
        ).get();
        if (!category) throw new Error("تعذر استيراد قائمة راديكس: قسم السباكة غير موجود أو غير نشط");

        const locations = db.prepare(`
            SELECT id FROM locations
            WHERE name IN ('المعرض', 'المخزن')
            ORDER BY name
        `).all();
        if (locations.length !== 2) {
            throw new Error("تعذر استيراد قائمة راديكس: أماكن المعرض والمخزن غير مكتملة");
        }

        const insertProduct = db.prepare(`
            INSERT INTO products (
                internal_code, name, category_id, unit, purchase_price,
                sale_price, minimum_stock, is_active, company_discount_percent
            )
            VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)
        `);
        const insertStock = db.prepare(`
            INSERT INTO stock (product_id, location_id, quantity)
            VALUES (?, ?, 0)
        `);
        const hasCode = db.prepare(
            "SELECT 1 FROM products WHERE internal_code = ?"
        );
        let added = 0;

        for (const family of catalog) {
            if (!family.code || !family.name || !Array.isArray(family.variants)) {
                throw new Error("تعذر استيراد قائمة راديكس: بيانات أحد الأصناف غير مكتملة");
            }
            if (!["قطعة", "متر"].includes(family.unit)) {
                throw new Error(`وحدة غير صحيحة لصنف ${family.name}`);
            }
            if (/^مواسير(?:\s|$)/u.test(family.name) !== (family.unit === "متر")) {
                throw new Error(`وحدة البيع لا تطابق صنف ${family.name}`);
            }

            for (const variant of family.variants) {
                if (!Array.isArray(variant) || variant.length !== 2) {
                    throw new Error(`مقاس أو سعر غير صحيح لصنف ${family.name}`);
                }
                const [size, salePrice] = variant;
                if (typeof size !== "string" || !size.trim() ||
                    !Number.isFinite(salePrice) || salePrice <= 0) {
                    throw new Error(`سعر أو مقاس غير صالح لصنف ${family.name}`);
                }

                const code = `RD-${family.code}-${sizeCode(size)}`;
                if (hasCode.get(code)) continue;

                const name = `راديكس ${family.name} — ${size}`;
                const purchasePrice = Math.round(
                    salePrice * (1 - COMPANY_DISCOUNT_PERCENT / 100) * 100
                ) / 100;
                const product = insertProduct.run(
                    code,
                    name,
                    category.id,
                    family.unit,
                    purchasePrice,
                    salePrice,
                    COMPANY_DISCOUNT_PERCENT
                );
                for (const location of locations) {
                    insertStock.run(product.lastInsertRowid, location.id);
                }
                added += 1;
            }
        }

        db.prepare(`
            INSERT INTO suppliers (name, notes)
            SELECT 'راديكس', 'مورد أصناف السباكة - قائمة أسعار 2026'
            WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = 'راديكس')
        `).run();
        db.prepare(`
            INSERT INTO settings (setting_key, setting_value)
            VALUES (?, ?)
        `).run(CATALOG_KEY, String(added));

        return { imported: true, added };
    })();
}

module.exports = seedRadixPlumbingCatalog;
