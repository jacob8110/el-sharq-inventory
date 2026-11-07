const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");

const FINANCE_SALT = "finance_password_salt";
const FINANCE_HASH = "finance_password_hash";
const DELETION_SALT = "deletion_password_salt";
const DELETION_HASH = "deletion_password_hash";

function getSetting(db, key) {
    return db.prepare("SELECT setting_value FROM settings WHERE setting_key = ?").get(key)?.setting_value || "";
}

function saveSetting(db, key, value) {
    db.prepare(`
        INSERT INTO settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key) DO UPDATE SET
            setting_value = excluded.setting_value,
            updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
}

function isFinancePasswordConfigured(db) {
    return Boolean(
        db.prepare("SELECT 1 FROM settings WHERE setting_key IN (?, ?) LIMIT 1")
            .get(FINANCE_HASH, DELETION_HASH)
    );
}

function verifyPasswordPair(db, saltKey, hashKey, password, notConfiguredMessage) {
    const salt = getSetting(db, saltKey);
    const storedHash = getSetting(db, hashKey);
    if (!salt && !storedHash) throw new Error(notConfiguredMessage);
    if (!salt || !storedHash || typeof password !== "string") {
        throw new Error("إعداد كلمة المرور غير مكتمل. أعد ضبطها من الإعدادات.");
    }
    const expectedHash = Buffer.from(storedHash, "hex");
    if (expectedHash.length !== 64 || !/^[0-9a-f]{32}$/i.test(salt)) {
        throw new Error("بيانات كلمة المرور غير سليمة. أعد ضبطها من الإعدادات.");
    }
    const actualHash = scryptSync(password, salt, 64);
    return timingSafeEqual(expectedHash, actualHash);
}

function verifyFinancePassword(db, password) {
    const financeSalt = getSetting(db, FINANCE_SALT);
    const financeHash = getSetting(db, FINANCE_HASH);
    const deletionSalt = getSetting(db, DELETION_SALT);
    const deletionHash = getSetting(db, DELETION_HASH);
    const financeConfigured = Boolean(financeSalt || financeHash);
    const deletionConfigured = Boolean(deletionSalt || deletionHash);
    if (!financeConfigured && !deletionConfigured) {
        throw new Error("لم يتم ضبط كلمة المرور الموحدة من الإعدادات بعد");
    }
    let matched = false;
    if (financeConfigured) {
        matched = verifyPasswordPair(db, FINANCE_SALT, FINANCE_HASH, password, "كلمة المرور المالية غير مضبوطة");
    }
    if (!matched && deletionConfigured) {
        matched = verifyPasswordPair(db, DELETION_SALT, DELETION_HASH, password, "كلمة مرور الحذف غير مضبوطة");
    }
    if (!matched) throw new Error("كلمة المرور غير صحيحة");
    return true;
}

function setSharedSecurityPassword(db, currentFinancePassword, currentDeletionPassword, newPassword) {
    if (typeof newPassword !== "string" || newPassword.trim().length < 4) {
        throw new Error("كلمة المرور الجديدة يجب أن تتكون من 4 أحرف أو أرقام على الأقل");
    }
    const financeConfigured = Boolean(getSetting(db, FINANCE_SALT) || getSetting(db, FINANCE_HASH));
    const deletionConfigured = Boolean(getSetting(db, DELETION_SALT) || getSetting(db, DELETION_HASH));
    if (financeConfigured && !verifyPasswordPair(db, FINANCE_SALT, FINANCE_HASH, currentFinancePassword, "كلمة المرور المالية غير مضبوطة")) {
        throw new Error("كلمة المرور المالية الحالية غير صحيحة");
    }
    if (deletionConfigured && !verifyPasswordPair(db, DELETION_SALT, DELETION_HASH, currentDeletionPassword, "كلمة مرور الحذف غير مضبوطة")) {
        throw new Error("كلمة مرور الحذف الحالية غير صحيحة");
    }

    const newSalt = randomBytes(16).toString("hex");
    const newHash = scryptSync(newPassword, newSalt, 64).toString("hex");
    db.transaction(() => {
        saveSetting(db, FINANCE_SALT, newSalt);
        saveSetting(db, FINANCE_HASH, newHash);
        saveSetting(db, DELETION_SALT, newSalt);
        saveSetting(db, DELETION_HASH, newHash);
    })();
    return { success: true };
}

module.exports = {
    isFinancePasswordConfigured,
    verifyFinancePassword,
    setSharedSecurityPassword
};
