// نظام التحقق من الترخيص الرقمي - الشرق
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAP1zFIz0Yhk0rlY0gtzXmVyPDM0lq1clCWQiDpv0zJM=
-----END PUBLIC KEY-----`;

// معرّف الجهاز الفريد بناءً على مواصفات الهاردوير
function getMachineId() {
    const raw = [
        os.hostname(),
        os.platform(),
        os.arch(),
        os.cpus().map(c => c.model).join(';'),
        os.totalmem()
    ].join('||');
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 20).toUpperCase();
}

function getLicenseFilePath() {
    return path.join(process.cwd(), 'elsharq.license');
}

function verifyLicense() {
    const licensePath = getLicenseFilePath();
    if (!fs.existsSync(licensePath)) {
        return { valid: false, machineId: getMachineId(), reason: 'لم يتم العثور على ملف الترخيص' };
    }

    try {
        const fileContent = fs.readFileSync(licensePath, 'utf8').trim();
        const [encodedPayload, signatureHex] = fileContent.split('.');
        if (!encodedPayload || !signatureHex) {
            return { valid: false, machineId: getMachineId(), reason: 'صيغة ملف الترخيص غير صالحة' };
        }

        const payload = JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf8'));
        const currentMachineId = getMachineId();

        if (payload.machineId !== currentMachineId) {
            return { valid: false, machineId: currentMachineId, reason: 'الترخيص مخصص لجهاز آخر' };
        }

        if (payload.expiry && new Date(payload.expiry) < new Date()) {
            return { valid: false, machineId: currentMachineId, reason: 'انتهت صلاحية الترخيص' };
        }

        const isVerified = crypto.verify(
            null,
            Buffer.from(encodedPayload),
            PUBLIC_KEY,
            Buffer.from(signatureHex, 'hex')
        );

        return {
            valid: isVerified,
            machineId: currentMachineId,
            clientName: payload.clientName || 'عميل مرخص',
            reason: isVerified ? 'مرخص بنجاح' : 'توقيع الترخيص غير سليم'
        };
    } catch (err) {
        return { valid: false, machineId: getMachineId(), reason: 'خطأ في فحص الترخيص' };
    }
}

module.exports = { getMachineId, verifyLicense };
