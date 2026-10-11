const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const temporaryUserData = fs.mkdtempSync(path.join(os.tmpdir(), "el-sharq-integration-"));
const handlers = new Map();

const ipcMain = {
    handle(channel, callback) {
        handlers.set(channel, callback);
    },
    on() {}
};

const electronMock = {
    app: {
        isPackaged: true,
        getPath(name) {
            assert.equal(name, "userData");
            return temporaryUserData;
        },
        emit() {},
        on() {},
        whenReady() {
            // Loading main.js registers all IPC handlers. The UI startup itself is not needed here.
            return new Promise(() => {});
        },
        quit() {},
        relaunch() {},
        exit() {}
    },
    BrowserWindow: class BrowserWindow {},
    dialog: {
        async showSaveDialog() {
            return {
                canceled: false,
                filePath: path.join(temporaryUserData, "verified-backup.db")
            };
        }
    },
    ipcMain,
    screen: {
        getPrimaryDisplay() {
            return { workAreaSize: { width: 1280, height: 720 } };
        }
    }
};

const originalLoad = Module._load;
Module._load = function loadElectronMock(request, parent, isMain) {
    if (request === "electron") return electronMock;
    return originalLoad.call(this, request, parent, isMain);
};

let db;
try {
    const { initializeBackend } = require(path.join(projectRoot, "main.js"));
    initializeBackend();
    db = require(path.join(projectRoot, "src", "database", "database.js"));
} finally {
    Module._load = originalLoad;
}
const invoke = (channel, ...args) => {
    const handler = handlers.get(channel);
    assert.ok(handler, `Missing IPC handler: ${channel}`);
    return handler({}, ...args);
};

test.after(() => {
    db.close();
    fs.rmSync(temporaryUserData, { recursive: true, force: true });
});

test("critical shop workflow preserves stock, invoices, deletion protection, and backup", async () => {
    for (const channel of [
        "products:add",
        "sales:create",
        "purchases:create",
        "stock:transfer",
        "database:backup"
    ]) {
        assert.ok(handlers.has(channel), `Missing critical IPC handler: ${channel}`);
    }

    const [categories, locations] = await Promise.all([
        invoke("categories:getAll"),
        invoke("locations:getAll")
    ]);
    const category = categories[0];
    const showroom = locations.find((location) => location.type === "showroom");
    const warehouse = locations.find((location) => location.type === "warehouse");
    assert.ok(category, "A category is required for the product test");
    assert.ok(showroom, "The showroom location is required");
    assert.ok(warehouse, "The warehouse location is required");

    const runId = `${Date.now()}-${process.pid}`;
    const product = await invoke("products:add", {
        name: `Integration product ${runId}`,
        internal_code: `IT-${runId}`,
        category_id: category.id,
        unit: "piece",
        purchase_price: 10,
        purchase_price_manual: true,
        sale_price: 20,
        min_stock: 0,
        showroom_quantity: 10,
        warehouse_quantity: 5
    });
    assert.equal(product.success, true);

    const sale = await invoke("sales:create", {
        location: "المعرض",
        customer_name: `Integration customer ${runId}`,
        paid: 40,
        items: [{ product_id: product.productId, quantity: 2, unit_price: 20 }]
    });
    assert.equal(sale.success, true);
    assert.equal(sale.total, 40);
    assert.equal(sale.remaining, 0);

    let productSnapshot = await invoke("products:getById", product.productId);
    assert.equal(productSnapshot.showroom_quantity, 8);
    assert.equal(productSnapshot.warehouse_quantity, 5);

    const transfer = await invoke("stock:transfer", {
        from_location_id: showroom.id,
        to_location_id: warehouse.id,
        items: [{ product_id: product.productId, quantity: 3 }],
        notes: "Integration test transfer"
    });
    assert.equal(transfer.success, true);

    productSnapshot = await invoke("products:getById", product.productId);
    assert.equal(productSnapshot.showroom_quantity, 5);
    assert.equal(productSnapshot.warehouse_quantity, 8);

    const adjustment = await invoke("stock:adjust", {
        product_id: product.productId,
        location_id: showroom.id,
        quantity: 7,
        notes: "Integration test adjustment"
    });
    assert.equal(adjustment.success, true);
    assert.equal(adjustment.difference, 2);

    const purchase = await invoke("purchases:create", {
        supplier_name: `Integration supplier ${runId}`,
        location_id: warehouse.id,
        paid_amount: 0,
        items: [{ product_id: product.productId, quantity: 4, unit_cost: 12 }]
    });
    assert.equal(purchase.success, true);
    assert.equal(purchase.total, 48);

    productSnapshot = await invoke("products:getById", product.productId);
    assert.equal(productSnapshot.showroom_quantity, 7);
    assert.equal(productSnapshot.warehouse_quantity, 12);

    db.prepare(`
        DELETE FROM settings
        WHERE setting_key IN ('deletion_password_salt', 'deletion_password_hash')
    `).run();
    await invoke("settings:setDeletionPassword", "", "integration-test-password");
    assert.throws(
        () => invoke("sales:delete", sale.saleId, "incorrect-password"),
        /password|كلمة/i
    );
    const deletedSale = await invoke("sales:delete", sale.saleId, "integration-test-password");
    assert.equal(deletedSale.success, true);

    productSnapshot = await invoke("products:getById", product.productId);
    assert.equal(productSnapshot.showroom_quantity, 9);

    const deletedProduct = await invoke(
        "products:delete",
        product.productId,
        "integration-test-password"
    );
    assert.equal(deletedProduct.success, true);
    assert.equal(deletedProduct.archived, true);
    assert.equal((await invoke("products:getById", product.productId)).active, 0);

    const backup = await invoke("database:backup");
    assert.equal(backup.success, true);
    assert.ok(fs.statSync(backup.filePath).size > 0, "The backup must contain database data");

    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
});
