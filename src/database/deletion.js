const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");

const SETTING_SALT = "deletion_password_salt";
const SETTING_HASH = "deletion_password_hash";

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

function verifyDeletionPassword(db, password) {
    const salt = getSetting(db, SETTING_SALT);
    const storedHash = getSetting(db, SETTING_HASH);
    if (!salt || !storedHash || typeof password !== "string") {
        throw new Error("اضبط كلمة مرور الحذف من الإعدادات أولًا");
    }

    const actualHash = scryptSync(password, salt, 64);
    const expectedHash = Buffer.from(storedHash, "hex");
    if (expectedHash.length !== actualHash.length || !timingSafeEqual(expectedHash, actualHash)) {
        throw new Error("كلمة مرور الحذف غير صحيحة");
    }
}

function setDeletionPassword(db, currentPassword, newPassword) {
    if (typeof newPassword !== "string" || newPassword.length < 8) {
        throw new Error("كلمة مرور الحذف يجب ألا تقل عن 8 أحرف");
    }

    const storedHash = getSetting(db, SETTING_HASH);
    if (storedHash) {
        verifyDeletionPassword(db, currentPassword);
    } else if (currentPassword) {
        throw new Error("لم يتم ضبط كلمة مرور حذف سابقة");
    }

    const newSalt = randomBytes(16).toString("hex");
    const newHash = scryptSync(newPassword, newSalt, 64).toString("hex");
    db.transaction(() => {
        saveSetting(db, SETTING_SALT, newSalt);
        saveSetting(db, SETTING_HASH, newHash);
    })();
    return { success: true };
}

module.exports = { setDeletionPassword, verifyDeletionPassword };
