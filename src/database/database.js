const Database = require("better-sqlite3");
const { app } = require("electron");
const path = require("path");
const fs = require("fs");

// ==========================================
// قاعدة بيانات الشرق
// ==========================================

const legacyDatabasePath = path.join(__dirname, "data", "el-sharq.db");
const databaseFolder = app.isPackaged
    ? path.join(app.getPath("userData"), "data")
    : path.join(__dirname, "data");
const databasePath = path.join(databaseFolder, "el-sharq.db");

function reportStartupProgress(progress, status) {
    app.emit("el-sharq-startup-progress", { progress, status });
}

if (!fs.existsSync(databaseFolder)) {
    fs.mkdirSync(databaseFolder, { recursive: true });
}

if (app.isPackaged && !fs.existsSync(databasePath) && fs.existsSync(legacyDatabasePath)) {
    fs.writeFileSync(databasePath, fs.readFileSync(legacyDatabasePath));
    const legacyWalPath = `${legacyDatabasePath}-wal`;
    if (fs.existsSync(legacyWalPath) && fs.statSync(legacyWalPath).size > 0) {
        fs.writeFileSync(`${databasePath}-wal`, fs.readFileSync(legacyWalPath));
    }
}

const db = new Database(databasePath);
reportStartupProgress(32, "جاري تجهيز قاعدة البيانات...");

// تحسين أداء وأمان SQLite
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
reportStartupProgress(38, "جاري فحص قاعدة البيانات...");

// ==========================================
// إنشاء الجداول
// ==========================================

db.exec(`

    -- ======================================
    -- المستخدمين والصلاحيات
    -- ======================================

    CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role_id INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (role_id)
            REFERENCES roles(id)
            ON DELETE SET NULL
    );


    -- ======================================
    -- التصنيفات
    -- ======================================

    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    -- ======================================
    -- المنتجات
    -- ======================================

    CREATE TABLE IF NOT EXISTS products (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    internal_code TEXT UNIQUE,

    barcode TEXT UNIQUE,

    name TEXT NOT NULL,

        category_id INTEGER NOT NULL,

        unit TEXT NOT NULL DEFAULT 'قطعة',

        purchase_price REAL NOT NULL DEFAULT 0,
        purchase_price_manual INTEGER NOT NULL DEFAULT 0,
        sale_price REAL NOT NULL DEFAULT 0,

        minimum_stock REAL NOT NULL DEFAULT 0,

        is_active INTEGER NOT NULL DEFAULT 1,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (category_id)
            REFERENCES categories(id)
            ON DELETE RESTRICT
    );


    -- ======================================
    -- أماكن التخزين
    -- ======================================

    CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        name TEXT NOT NULL UNIQUE,

        type TEXT NOT NULL,

        description TEXT,

        is_active INTEGER NOT NULL DEFAULT 1,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    -- ======================================
    -- المخزون الحالي
    -- ======================================

    CREATE TABLE IF NOT EXISTS stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        product_id INTEGER NOT NULL,

        location_id INTEGER NOT NULL,

        quantity REAL NOT NULL DEFAULT 0,

        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        UNIQUE(product_id, location_id),

        FOREIGN KEY (product_id)
            REFERENCES products(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (location_id)
            REFERENCES locations(id)
            ON DELETE RESTRICT
    );


    -- ======================================
    -- حركة المخزون
    -- ======================================

    CREATE TABLE IF NOT EXISTS stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        product_id INTEGER NOT NULL,

        location_id INTEGER NOT NULL,

        movement_type TEXT NOT NULL,

        quantity REAL NOT NULL,

        reference_type TEXT,

        reference_id INTEGER,

        notes TEXT,

        created_by INTEGER,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (product_id)
            REFERENCES products(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (location_id)
            REFERENCES locations(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (created_by)
            REFERENCES users(id)
            ON DELETE SET NULL
    );


    -- ======================================
    -- العملاء
    -- ======================================

    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        name TEXT NOT NULL,

        phone TEXT,

        address TEXT,

        opening_balance REAL NOT NULL DEFAULT 0,

        notes TEXT,

        is_active INTEGER NOT NULL DEFAULT 1,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    -- ======================================
    -- حركة حسابات العملاء
    -- ======================================

    CREATE TABLE IF NOT EXISTS customer_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        customer_id INTEGER NOT NULL,

        transaction_type TEXT NOT NULL,

        reference_type TEXT,

        reference_id INTEGER,

        debit REAL NOT NULL DEFAULT 0,

        credit REAL NOT NULL DEFAULT 0,

        notes TEXT,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (customer_id)
            REFERENCES customers(id)
            ON DELETE RESTRICT
    );


    -- ======================================
    -- الموردين
    -- ======================================

    CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        name TEXT NOT NULL,

        phone TEXT,

        address TEXT,

        opening_balance REAL NOT NULL DEFAULT 0,

        notes TEXT,

        is_active INTEGER NOT NULL DEFAULT 1,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    -- ======================================
    -- حركة حسابات الموردين
    -- ======================================

    CREATE TABLE IF NOT EXISTS supplier_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        supplier_id INTEGER NOT NULL,

        transaction_type TEXT NOT NULL,

        reference_type TEXT,

        reference_id INTEGER,

        debit REAL NOT NULL DEFAULT 0,

        credit REAL NOT NULL DEFAULT 0,

        notes TEXT,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (supplier_id)
            REFERENCES suppliers(id)
            ON DELETE RESTRICT
    );


    -- ======================================
    -- فواتير المبيعات
    -- ======================================

    CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        invoice_number TEXT NOT NULL UNIQUE,

        customer_id INTEGER,

        sale_type TEXT NOT NULL DEFAULT 'cash',

        subtotal REAL NOT NULL DEFAULT 0,

        plumbing_discount_percent REAL NOT NULL DEFAULT 0,

        plumbing_discount_amount REAL NOT NULL DEFAULT 0,

        general_discount_amount REAL NOT NULL DEFAULT 0,

        total_amount REAL NOT NULL DEFAULT 0,

        paid_amount REAL NOT NULL DEFAULT 0,

        remaining_amount REAL NOT NULL DEFAULT 0,

        status TEXT NOT NULL DEFAULT 'completed',

        notes TEXT,

        created_by INTEGER,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (customer_id)
            REFERENCES customers(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (created_by)
            REFERENCES users(id)
            ON DELETE SET NULL
    );


    -- ======================================
    -- أصناف فواتير المبيعات
    -- ======================================

    CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        sale_id INTEGER NOT NULL,

        product_id INTEGER NOT NULL,

        location_id INTEGER NOT NULL,

        quantity REAL NOT NULL,

        unit_price REAL NOT NULL,

        purchase_price REAL NOT NULL DEFAULT 0,

        discount_amount REAL NOT NULL DEFAULT 0,

        total_amount REAL NOT NULL,

        FOREIGN KEY (sale_id)
            REFERENCES sales(id)
            ON DELETE CASCADE,

        FOREIGN KEY (product_id)
            REFERENCES products(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (location_id)
            REFERENCES locations(id)
            ON DELETE RESTRICT
    );


    -- ======================================
    -- مدفوعات المبيعات
    -- ======================================

    CREATE TABLE IF NOT EXISTS sale_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        sale_id INTEGER NOT NULL,

        amount REAL NOT NULL,

        payment_method TEXT NOT NULL DEFAULT 'cash',

        notes TEXT,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (sale_id)
            REFERENCES sales(id)
            ON DELETE CASCADE
    );


    -- ======================================
    -- مرتجعات المبيعات
    -- ======================================

    CREATE TABLE IF NOT EXISTS sales_returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        return_number TEXT NOT NULL UNIQUE,

        sale_id INTEGER,

        customer_id INTEGER,

        total_amount REAL NOT NULL DEFAULT 0,

        balance_credit_amount REAL NOT NULL DEFAULT 0,

        cash_refund_amount REAL NOT NULL DEFAULT 0,

        notes TEXT,

        created_by INTEGER,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (sale_id)
            REFERENCES sales(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (customer_id)
            REFERENCES customers(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (created_by)
            REFERENCES users(id)
            ON DELETE SET NULL
    );


    CREATE TABLE IF NOT EXISTS sales_return_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        return_id INTEGER NOT NULL,

        sale_item_id INTEGER NOT NULL,

        product_id INTEGER NOT NULL,

        location_id INTEGER NOT NULL,

        quantity REAL NOT NULL,

        display_quantity REAL NOT NULL DEFAULT 0,

        display_unit TEXT NOT NULL DEFAULT '',

        unit_price REAL NOT NULL,

        total_amount REAL NOT NULL,

        FOREIGN KEY (return_id)
            REFERENCES sales_returns(id)
            ON DELETE CASCADE,

        FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE RESTRICT,

        FOREIGN KEY (product_id)
            REFERENCES products(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (location_id)
            REFERENCES locations(id)
            ON DELETE RESTRICT
    );


    -- ======================================
    -- فواتير المشتريات
    -- ======================================

    CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        invoice_number TEXT NOT NULL UNIQUE,

        supplier_id INTEGER,

        purchase_type TEXT NOT NULL DEFAULT 'cash',

        subtotal REAL NOT NULL DEFAULT 0,

        discount_amount REAL NOT NULL DEFAULT 0,

        total_amount REAL NOT NULL DEFAULT 0,

        paid_amount REAL NOT NULL DEFAULT 0,

        remaining_amount REAL NOT NULL DEFAULT 0,

        status TEXT NOT NULL DEFAULT 'completed',

        notes TEXT,

        created_by INTEGER,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (supplier_id)
            REFERENCES suppliers(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (created_by)
            REFERENCES users(id)
            ON DELETE SET NULL
    );


    -- ======================================
    -- أصناف فواتير المشتريات
    -- ======================================

    CREATE TABLE IF NOT EXISTS purchase_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        purchase_id INTEGER NOT NULL,

        product_id INTEGER NOT NULL,

        location_id INTEGER NOT NULL,

        quantity REAL NOT NULL,

        unit_cost REAL NOT NULL,

        total_amount REAL NOT NULL,

        previous_purchase_price REAL DEFAULT NULL,
        previous_purchase_price_manual INTEGER DEFAULT NULL,

        FOREIGN KEY (purchase_id)
            REFERENCES purchases(id)
            ON DELETE CASCADE,

        FOREIGN KEY (product_id)
            REFERENCES products(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (location_id)
            REFERENCES locations(id)
            ON DELETE RESTRICT
    );


    -- ======================================
    -- مدفوعات المشتريات
    -- ======================================

    CREATE TABLE IF NOT EXISTS purchase_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        purchase_id INTEGER NOT NULL,

        amount REAL NOT NULL,

        payment_method TEXT NOT NULL DEFAULT 'cash',

        notes TEXT,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (purchase_id)
            REFERENCES purchases(id)
            ON DELETE CASCADE
    );


    -- ======================================
    -- مرتجعات المشتريات
    -- ======================================

    CREATE TABLE IF NOT EXISTS purchase_returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        return_number TEXT NOT NULL UNIQUE,

        purchase_id INTEGER,

        supplier_id INTEGER,

        total_amount REAL NOT NULL DEFAULT 0,

        notes TEXT,

        created_by INTEGER,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (purchase_id)
            REFERENCES purchases(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (supplier_id)
            REFERENCES suppliers(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (created_by)
            REFERENCES users(id)
            ON DELETE SET NULL
    );


    CREATE TABLE IF NOT EXISTS purchase_return_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        return_id INTEGER NOT NULL,

        product_id INTEGER NOT NULL,

        location_id INTEGER NOT NULL,

        quantity REAL NOT NULL,

        unit_cost REAL NOT NULL,

        total_amount REAL NOT NULL,

        FOREIGN KEY (return_id)
            REFERENCES purchase_returns(id)
            ON DELETE CASCADE,

        FOREIGN KEY (product_id)
            REFERENCES products(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (location_id)
            REFERENCES locations(id)
            ON DELETE RESTRICT
    );


    -- ======================================
    -- الخزنة
    -- ======================================

    CREATE TABLE IF NOT EXISTS cash_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        name TEXT NOT NULL UNIQUE,

        opening_balance REAL NOT NULL DEFAULT 0,

        is_active INTEGER NOT NULL DEFAULT 1,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    CREATE TABLE IF NOT EXISTS cash_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        cash_account_id INTEGER NOT NULL,

        transaction_type TEXT NOT NULL,

        direction TEXT NOT NULL,

        amount REAL NOT NULL,

        reference_type TEXT,

        reference_id INTEGER,

        description TEXT,

        created_by INTEGER,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (cash_account_id)
            REFERENCES cash_accounts(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (created_by)
            REFERENCES users(id)
            ON DELETE SET NULL
    );


    -- ======================================
    -- المصروفات
    -- ======================================

    CREATE TABLE IF NOT EXISTS expense_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        name TEXT NOT NULL UNIQUE,

        description TEXT,

        is_active INTEGER NOT NULL DEFAULT 1
    );


    CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        expense_category_id INTEGER,

        cash_account_id INTEGER,

        amount REAL NOT NULL,

        description TEXT,

        reference_type TEXT,

        reference_id INTEGER,

        created_by INTEGER,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (expense_category_id)
            REFERENCES expense_categories(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (cash_account_id)
            REFERENCES cash_accounts(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (created_by)
            REFERENCES users(id)
            ON DELETE SET NULL
    );


    -- ======================================
    -- تحويلات المخزون
    -- ======================================

    CREATE TABLE IF NOT EXISTS stock_transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        transfer_number TEXT NOT NULL UNIQUE,

        from_location_id INTEGER NOT NULL,

        to_location_id INTEGER NOT NULL,

        notes TEXT,

        created_by INTEGER,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (from_location_id)
            REFERENCES locations(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (to_location_id)
            REFERENCES locations(id)
            ON DELETE RESTRICT,

        FOREIGN KEY (created_by)
            REFERENCES users(id)
            ON DELETE SET NULL
    );


    CREATE TABLE IF NOT EXISTS stock_transfer_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        transfer_id INTEGER NOT NULL,

        product_id INTEGER NOT NULL,

        quantity REAL NOT NULL,

        FOREIGN KEY (transfer_id)
            REFERENCES stock_transfers(id)
            ON DELETE CASCADE,

        FOREIGN KEY (product_id)
            REFERENCES products(id)
            ON DELETE RESTRICT
    );


    -- ======================================
    -- سجل العمليات
    -- ======================================

    CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        user_id INTEGER,

        action TEXT NOT NULL,

        entity_type TEXT,

        entity_id INTEGER,

        old_data TEXT,

        new_data TEXT,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (user_id)
            REFERENCES users(id)
            ON DELETE SET NULL
    );


    -- ======================================
    -- المعاملات السريعة (بيع نقدي ومرتجعاته)
    -- ======================================

    CREATE TABLE IF NOT EXISTS quick_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_number TEXT NOT NULL UNIQUE,
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('sale', 'return')),
        source_sale_id INTEGER,
        total_amount REAL NOT NULL DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_sale_id) REFERENCES quick_transactions(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS quick_transaction_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id INTEGER NOT NULL,
        source_item_id INTEGER,
        product_id INTEGER NOT NULL,
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        purchase_price REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL,
        FOREIGN KEY (transaction_id) REFERENCES quick_transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (source_item_id) REFERENCES quick_transaction_items(id) ON DELETE RESTRICT,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_quick_transactions_type_date
        ON quick_transactions(transaction_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_quick_transaction_items_transaction
        ON quick_transaction_items(transaction_id);

    -- ======================================
    -- إعدادات النظام
    -- ======================================

    CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        setting_key TEXT NOT NULL UNIQUE,

        setting_value TEXT,

        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

`);
reportStartupProgress(55, "جاري فحص وتحديث قاعدة البيانات...");

// ==========================================
// البيانات الأساسية
// ==========================================

// الأماكن الأساسية
const insertLocation = db.prepare(`
    INSERT OR IGNORE INTO locations (name, type)
    VALUES (?, ?)
`);

insertLocation.run("المعرض", "showroom");
insertLocation.run("المخزن", "warehouse");

// الخزنة الأساسية
const insertCashAccount = db.prepare(`
    INSERT OR IGNORE INTO cash_accounts (name)
    VALUES (?)
`);

insertCashAccount.run("الخزنة الرئيسية");

// التصنيفات الأساسية
const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO categories (name)
    VALUES (?)
`);

insertCategory.run("سباكة");
insertCategory.run("سيراميك");
insertCategory.run("أدوات صحية");
insertCategory.run("خلاطات");
insertCategory.run("إكسسوارات");

// أدوار المستخدمين
const insertRole = db.prepare(`
    INSERT OR IGNORE INTO roles (name, description)
    VALUES (?, ?)
`);

insertRole.run("admin", "مدير النظام");
insertRole.run("sales", "موظف مبيعات");
insertRole.run("warehouse", "موظف مخزن");

// فئات المصروفات
const insertExpenseCategory = db.prepare(`
    INSERT OR IGNORE INTO expense_categories (name)
    VALUES (?)
`);

insertExpenseCategory.run("كهرباء");
insertExpenseCategory.run("مياه");
insertExpenseCategory.run("نقل");
insertExpenseCategory.run("صيانة");
insertExpenseCategory.run("مرتبات");
insertExpenseCategory.run("أخرى");
reportStartupProgress(68, "جاري تحميل البيانات الأساسية...");


// ==========================================
// هجرات غير مدمرة (Safe Migrations)
// ==========================================
// فكرة الدالة المساعدة: بنشوف العمود موجود ولا لأ
function columnExists(tableName, columnName) {
    const row = db.prepare(`
        SELECT COUNT(*) AS cnt FROM pragma_table_info(?)
        WHERE name = ?
    `).get(tableName, columnName);
    return row.cnt > 0;
}

    // Customer reservations: non-destructive, idempotent schema creation.
    db.exec(`
        CREATE TABLE IF NOT EXISTS reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reservation_number TEXT NOT NULL UNIQUE,
            customer_id INTEGER,
            customer_name TEXT NOT NULL,
            customer_phone TEXT,
            due_date TEXT,
            notes TEXT,
            subtotal REAL NOT NULL DEFAULT 0,
            total_amount REAL NOT NULL DEFAULT 0,
            paid_amount REAL NOT NULL DEFAULT 0,
            remaining_amount REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            sale_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
            FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS reservation_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reservation_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity REAL NOT NULL,
            unit_price REAL NOT NULL,
            purchase_price REAL NOT NULL DEFAULT 0,
            total_amount REAL NOT NULL DEFAULT 0,
            FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS reservation_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reservation_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            payment_type TEXT NOT NULL DEFAULT 'payment',
            cash_account_id INTEGER,
            sale_id INTEGER,
            payment_method TEXT NOT NULL DEFAULT 'cash',
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE RESTRICT,
            FOREIGN KEY (cash_account_id) REFERENCES cash_accounts(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
        CREATE INDEX IF NOT EXISTS idx_reservation_items_product ON reservation_items(product_id);
        CREATE INDEX IF NOT EXISTS idx_reservation_payments_reservation ON reservation_payments(reservation_id);
    `);
    // worker-payroll-schema-v1: non-destructive worker/payroll history tables.
    db.exec(`
        CREATE TABLE IF NOT EXISTS workers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            job_title TEXT,
            monthly_salary REAL NOT NULL DEFAULT 0,
            start_date TEXT NOT NULL,
            payroll_start_date TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS worker_payroll_cycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            worker_id INTEGER NOT NULL,
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            due_date TEXT NOT NULL,
            salary_amount REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'open',
            payout_amount REAL NOT NULL DEFAULT 0,
            paid_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(worker_id, period_start),
            FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE RESTRICT
        );
        CREATE TABLE IF NOT EXISTS worker_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            worker_id INTEGER NOT NULL,
            cycle_id INTEGER NOT NULL,
            transaction_type TEXT NOT NULL,
            amount REAL NOT NULL DEFAULT 0,
            cash_account_id INTEGER,
            cash_transaction_id INTEGER,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE RESTRICT,
            FOREIGN KEY (cycle_id) REFERENCES worker_payroll_cycles(id) ON DELETE RESTRICT,
            FOREIGN KEY (cash_account_id) REFERENCES cash_accounts(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_worker_cycles_worker_due ON worker_payroll_cycles(worker_id, due_date, status);
        CREATE INDEX IF NOT EXISTS idx_worker_transactions_cycle ON worker_transactions(cycle_id, transaction_type);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_salary_payout_once
            ON worker_transactions(cycle_id) WHERE transaction_type = 'salary_payout';
    `);
// ---------- جدول products: إضافة أعمدة السيراميك والسباكه ----------
if (!columnExists("products", "tile_length_cm")) {
    db.exec(`ALTER TABLE products ADD COLUMN tile_length_cm REAL DEFAULT NULL`);
    console.log("Migration: Added column tile_length_cm to products");
}
if (!columnExists("products", "tile_width_cm")) {
    db.exec(`ALTER TABLE products ADD COLUMN tile_width_cm REAL DEFAULT NULL`);
    console.log("Migration: Added column tile_width_cm to products");
}
if (!columnExists("products", "tiles_per_carton")) {
    db.exec(`ALTER TABLE products ADD COLUMN tiles_per_carton INTEGER DEFAULT NULL`);
    console.log("Migration: Added column tiles_per_carton to products");
}
if (!columnExists("products", "company_discount_percent")) {
    db.exec(`ALTER TABLE products ADD COLUMN company_discount_percent REAL DEFAULT 0`);
    console.log("Migration: Added column company_discount_percent to products");
}
if (!columnExists("products", "purchase_price_manual")) {
    db.exec(`ALTER TABLE products ADD COLUMN purchase_price_manual INTEGER NOT NULL DEFAULT 0`);
    console.log("Migration: Added column purchase_price_manual to products");
}
if (!columnExists("purchase_items", "previous_purchase_price")) {
    db.exec(`ALTER TABLE purchase_items ADD COLUMN previous_purchase_price REAL DEFAULT NULL`);
    console.log("Migration: Added column previous_purchase_price to purchase_items");
}
    if (!columnExists("purchase_items", "previous_purchase_price_manual")) {
        db.exec(`ALTER TABLE purchase_items ADD COLUMN previous_purchase_price_manual INTEGER DEFAULT NULL`);
        console.log("Migration: Added column previous_purchase_price_manual to purchase_items");
    }
    if (!columnExists("purchase_items", "previous_sale_price")) {
        db.exec(`ALTER TABLE purchase_items ADD COLUMN previous_sale_price REAL DEFAULT NULL`);
        console.log("Migration: Added column previous_sale_price to purchase_items");
    }
    if (!columnExists("purchase_items", "list_price")) {
        db.exec(`ALTER TABLE purchase_items ADD COLUMN list_price REAL DEFAULT NULL`);
        console.log("Migration: Added column list_price to purchase_items");
    }
    if (!columnExists("purchase_items", "plumbing_discount_percent")) {
        db.exec(`ALTER TABLE purchase_items ADD COLUMN plumbing_discount_percent REAL DEFAULT NULL`);
        console.log("Migration: Added column plumbing_discount_percent to purchase_items");
    }

// ---------- جدول sales: إضافة updated_at وخصم التاجر لطلبيه السباكه ----------
if (!columnExists("sales", "updated_at")) {
    db.exec(`ALTER TABLE sales ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
    console.log("Migration: Added column updated_at to sales");
}
if (!columnExists("sales", "trader_discount_percent")) {
    db.exec(`ALTER TABLE sales ADD COLUMN trader_discount_percent REAL DEFAULT 0`);
    console.log("Migration: Added column trader_discount_percent to sales");
}
if (!columnExists("sales", "trader_discount_amount")) {
    db.exec(`ALTER TABLE sales ADD COLUMN trader_discount_amount REAL DEFAULT 0`);
    console.log("Migration: Added column trader_discount_amount to sales");
}
// مكان البيع (لو مش موجود في الفواتير القديمة)
if (!columnExists("sales", "location_id")) {
    db.exec(`ALTER TABLE sales ADD COLUMN location_id INTEGER DEFAULT NULL REFERENCES locations(id) ON DELETE SET NULL`);
    console.log("Migration: Added column location_id to sales");
}
if (!columnExists("sales", "due_date")) {
    db.exec(`ALTER TABLE sales ADD COLUMN due_date TEXT DEFAULT NULL`);
    console.log("Migration: Added column due_date to sales");
}

if (!columnExists("sales", "is_hidden")) {
    db.exec(`ALTER TABLE sales ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0`);
    console.log("Migration: Added column is_hidden to sales");
}
// ---------- حفظ وحدة وكمية وسعر البيع الظاهر في بند الفاتورة ----------
if (!columnExists("sale_items", "display_quantity")) {
    db.exec(`ALTER TABLE sale_items ADD COLUMN display_quantity REAL DEFAULT NULL`);
}
if (!columnExists("sale_items", "display_unit")) {
    db.exec(`ALTER TABLE sale_items ADD COLUMN display_unit TEXT DEFAULT NULL`);
}
if (!columnExists("sale_items", "display_unit_price")) {
    db.exec(`ALTER TABLE sale_items ADD COLUMN display_unit_price REAL DEFAULT NULL`);
}

if (!columnExists("sales_returns", "balance_credit_amount")) {
    db.exec(`ALTER TABLE sales_returns ADD COLUMN balance_credit_amount REAL NOT NULL DEFAULT 0`);
}
if (!columnExists("sales_returns", "cash_refund_amount")) {
    db.exec(`ALTER TABLE sales_returns ADD COLUMN cash_refund_amount REAL NOT NULL DEFAULT 0`);
}
if (!columnExists("sales_return_items", "sale_item_id")) {
    db.exec(`ALTER TABLE sales_return_items ADD COLUMN sale_item_id INTEGER DEFAULT NULL`);
}
if (!columnExists("sales_return_items", "display_quantity")) {
    db.exec(`ALTER TABLE sales_return_items ADD COLUMN display_quantity REAL NOT NULL DEFAULT 0`);
}
if (!columnExists("sales_return_items", "display_unit")) {
    db.exec(`ALTER TABLE sales_return_items ADD COLUMN display_unit TEXT NOT NULL DEFAULT ''`);
}

// ---------- إنشاء جداول الأطقم product_sets + product_set_items ----------
db.exec(`
    CREATE TABLE IF NOT EXISTS product_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        set_code TEXT UNIQUE,
        name TEXT NOT NULL,
        category_id INTEGER,
        sale_price REAL DEFAULT 0,
        description TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id)
            REFERENCES categories(id)
            ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS product_set_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        set_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        UNIQUE(set_id, product_id),
        FOREIGN KEY (set_id)
            REFERENCES product_sets(id)
            ON DELETE CASCADE,
        FOREIGN KEY (product_id)
            REFERENCES products(id)
            ON DELETE RESTRICT
    );
`);
console.log("Migration: product_sets and product_set_items tables ready.");
reportStartupProgress(82, "جاري تحميل البيانات الأساسية...");

const seedRadixPlumbingCatalog = require("./seed-radix-plumbing");
const radixCatalogResult = seedRadixPlumbingCatalog(db);
if (radixCatalogResult.imported) {
    console.log(`Imported ${radixCatalogResult.added} Radix plumbing products.`);
}
reportStartupProgress(86, "جاري تجهيز النظام...");

console.log("El-Sharq database initialized successfully.");

module.exports = db;