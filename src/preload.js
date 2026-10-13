const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("elSharqStartup", {
    mainReady: () => ipcRenderer.send("startup:main-ready"),
    failed: (message) => ipcRenderer.send("startup:main-failed", String(message || "Dashboard initialization failed"))
});

contextBridge.exposeInMainWorld("elSharq", {

    // ====== أماكن التخزين ======
    getLocations: () =>
        ipcRenderer.invoke("locations:getAll"),

    // ====== المنتجات ======
    getProducts: () =>
        ipcRenderer.invoke("products:getAll"),

    getProductById: (id) =>
        ipcRenderer.invoke("products:getById", id),

    addProduct: (product) =>
        ipcRenderer.invoke("products:add", product),

    deleteProduct: (id, password) =>
        ipcRenderer.invoke("products:delete", id, password),

    updateProduct: (id, product) =>
        ipcRenderer.invoke("products:update", id, product),

    // ====== التصنيفات ======
    getCategories: () =>
        ipcRenderer.invoke("categories:getAll"),

    // ====== الأطقم (product_sets) ======
    getProductSets: () =>
        ipcRenderer.invoke("productSets:getAll"),

    getSanitaryProducts: () =>
        ipcRenderer.invoke("productSets:getSanitaryProducts"),

    addProductSet: (set) =>
        ipcRenderer.invoke("productSets:add", set),

    updateProductSet: (id, set) =>
        ipcRenderer.invoke("productSets:update", id, set),

    setProductSetActive: (id, active) =>
        ipcRenderer.invoke("productSets:setActive", id, active),

    // ====== المبيعات (الفواتير) ======
    // worker-payroll-api-v1
    // ====== العمال والرواتب ======
    getWorkers: () => ipcRenderer.invoke("workers:getAll"),
    getWorkerLedger: (id) => ipcRenderer.invoke("workers:getLedger", id),
    createWorker: (payload) => ipcRenderer.invoke("workers:create", payload),
    updateWorker: (id, payload) => ipcRenderer.invoke("workers:update", id, payload),
    addWorkerAdvance: (id, amount, notes) => ipcRenderer.invoke("workers:addAdvance", id, amount, notes),
    payWorkerSalaryCycle: (cycleId) => ipcRenderer.invoke("workers:payCycle", cycleId),
    getSales: (filter, searchTerm = "") =>
        ipcRenderer.invoke("sales:getAll", filter, searchTerm),

    getSaleById: (id) =>
        ipcRenderer.invoke("sales:getById", id),

    createSale: (sale) =>
        ipcRenderer.invoke("sales:create", sale),

    updateSale: (id, sale) =>
        ipcRenderer.invoke("sales:update", id, sale),

    // ====== حجوزات العملاء ======
    getReservations: () => ipcRenderer.invoke("reservations:getAll"),
    createReservation: (payload) => ipcRenderer.invoke("reservations:create", payload),
    addReservationPayment: (id, amount) => ipcRenderer.invoke("reservations:addPayment", id, amount),
    cancelReservation: (id) => ipcRenderer.invoke("reservations:cancel", id),
    deliverReservation: (id, additionalPayment) =>
        ipcRenderer.invoke("reservations:deliver", id, additionalPayment),
    deleteSale: (id, password, mode) =>
        ipcRenderer.invoke("sales:delete", id, password, mode),

    createSaleReturn: (id, payload) =>
        ipcRenderer.invoke("sales:return:create", id, payload),

    // ====== المعاملات السريعة ======
    getQuickSales: () => ipcRenderer.invoke("quickTransactions:getSales"),
    getQuickTransactions: () => ipcRenderer.invoke("quickTransactions:getHistory"),
    deleteQuickTransaction: (id) => ipcRenderer.invoke("quickTransactions:delete", id),
    createQuickSale: (sale) => ipcRenderer.invoke("quickTransactions:createSale", sale),
    createQuickStandaloneReturn: (payload) =>
        ipcRenderer.invoke("quickTransactions:createStandaloneReturn", payload),

    createQuickReturn: (saleId, payload) => ipcRenderer.invoke("quickTransactions:createReturn", saleId, payload),

    // ====== طلبيه سباكه للتجار ======
    createPlumbingOrder: (order) =>
        ipcRenderer.invoke("plumbingOrders:create", order),

    getPurchases: (filters) =>
        ipcRenderer.invoke("purchases:getAll", filters),

    getPurchaseById: (id) =>
        ipcRenderer.invoke("purchases:getById", id),

    deletePurchase: (id, password) =>
        ipcRenderer.invoke("purchases:delete", id, password),

    createPurchase: (purchase) =>
        ipcRenderer.invoke("purchases:create", purchase),

    getStockOverview: () =>
        ipcRenderer.invoke("stock:getOverview"),

    getStockMovements: () =>
        ipcRenderer.invoke("stock:getMovements"),

    transferStock: (transfer) =>
        ipcRenderer.invoke("stock:transfer", transfer),

    adjustStock: (adjustment) =>
        ipcRenderer.invoke("stock:adjust", adjustment),

    getCustomers: () =>
        ipcRenderer.invoke("customers:getAll"),

    getOutstandingInvoices: (entity) =>
        entity === "customers"
            ? ipcRenderer.invoke("customers:getOutstanding")
            : entity === "suppliers"
                ? ipcRenderer.invoke("suppliers:getOutstanding")
                : Promise.reject(new Error("نوع الحساب غير صحيح")),

    recordAccountPayment: (entity, invoiceId, amount) =>
        ipcRenderer.invoke("contacts:recordPayment", entity, invoiceId, amount),

    getSuppliers: () =>
        ipcRenderer.invoke("suppliers:getAll"),

    saveContact: (entity, id, contact) =>
        ipcRenderer.invoke("contacts:save", entity, id, contact),

    getCashAccounts: () => ipcRenderer.invoke("cash:getAccounts"),

    getCashSummary: () =>
        ipcRenderer.invoke("cash:getSummary"),

    getCashTransactions: () =>
        ipcRenderer.invoke("cash:getTransactions"),

    deleteCashTransaction: (transactionId) =>
        ipcRenderer.invoke("cash:deleteManualTransaction", transactionId),

    getExpenseCategories: () =>
        ipcRenderer.invoke("cash:getExpenseCategories"),

    getExpenses: () =>
        ipcRenderer.invoke("cash:getExpenses"),

    deleteExpense: (expenseId) =>
        ipcRenderer.invoke("cash:deleteExpense", expenseId),

    addCashTransaction: (entry) =>
        ipcRenderer.invoke("cash:addTransaction", entry),

    getCashStatement: (range) =>
        ipcRenderer.invoke("cash:getStatement", range),
    getReportSummary: (range) =>
        ipcRenderer.invoke("reports:getSummary", range),

    getSettings: () =>
        ipcRenderer.invoke("settings:getAll"),

    saveSettings: (settings) =>
        ipcRenderer.invoke("settings:save", settings),

    setDeletionPassword: (currentPassword, newPassword) =>
        ipcRenderer.invoke("settings:setDeletionPassword", currentPassword, newPassword),

    backupDatabase: () =>
        ipcRenderer.invoke("database:backup")

});