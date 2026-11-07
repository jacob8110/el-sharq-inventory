const PREFIX = '__ELSHARQ_INVOICE_GROUP_V1__';
function metadata(sale) {
    if (!String(sale?.notes || '').startsWith(PREFIX)) return null;
    try {
        const value = JSON.parse(sale.notes.slice(PREFIX.length));
        if (value.version !== 1 || !['parent', 'section'].includes(value.kind)) throw new Error();
        return value;
    } catch (_) { throw new Error('بيانات الفاتورة المجمعة غير سليمة؛ لم يتم تنفيذ العملية'); }
}
function encode(value) { return PREFIX + JSON.stringify({ ...value, version: 1 }); }
function resolveParentId(db, id) {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(id));
    const info = metadata(sale);
    return info?.kind === 'section' ? Number(info.parentId) : Number(id);
}
function assertOrdinary(sale) {
    if (metadata(sale)) throw new Error('الفاتورة المجمعة وأقسامها لا تُعدّل أو تُحذف منفردة؛ استخدم المعاينة والتحصيل على الفاتورة الأم');
}
function mergeInvoices(db, ids) {
    return db.transaction(() => {
        if (!Array.isArray(ids) || ids.length < 2 || new Set(ids.map(Number)).size !== ids.length || ids.some(id => !Number.isSafeInteger(Number(id)) || Number(id) < 1)) {
            throw new Error('اختر فاتورتين مختلفتين على الأقل لنفس العميل');
        }
        const selected = ids.map(id => db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(id)));
        if (selected.some(s => !s || s.status !== 'completed' || Number(s.is_hidden) || !s.customer_id || metadata(s)?.kind === 'section')) throw new Error('إحدى الفواتير غير متاحة للدمج');
        const customerId = Number(selected[0].customer_id);
        if (selected.some(s => Number(s.customer_id) !== customerId)) throw new Error('الدمج متاح لفواتير العميل الواحد فقط');
        const parents = selected.filter(s => metadata(s)?.kind === 'parent');
        if (parents.length > 1) throw new Error('اختر فاتورة أم واحدة لإضافة الفواتير إليها');
        const existingParents = db.prepare("SELECT * FROM sales WHERE customer_id = ? AND status = 'completed'").all(customerId).filter(s => metadata(s)?.kind === 'parent');
        if (existingParents.some(s => !parents.some(p => p.id === s.id))) throw new Error('لهذا العميل فاتورة أم بالفعل؛ اخترها ضمن الفواتير المراد ضمها');
        const sections = selected.flatMap(s => metadata(s)?.kind === 'parent' ? metadata(s).sectionIds.map(id => db.prepare('SELECT * FROM sales WHERE id = ?').get(id)) : [s]);
        if (sections.some(s => !s) || new Set(sections.map(s => s.id)).size !== sections.length) throw new Error('أقسام الفاتورة غير سليمة');
        let parent = parents[0];
        if (!parent) {
            const next = Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM sales').get().id);
            const result = db.prepare("INSERT INTO sales (invoice_number, customer_id, customer_phone, location_id, sale_type, status) VALUES (?, ?, ?, ?, 'credit', 'completed')").run(`M-${String(next).padStart(6, '0')}`, customerId, selected[0].customer_phone || null, selected[0].location_id || null);
            parent = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(result.lastInsertRowid));
        }
        const additions = selected.filter(s => !metadata(s));
        const sum = key => selected.reduce((value, s) => value + Number(s[key] || 0), 0);
        const total = sum('total_amount'), paid = sum('paid_amount'), remaining = sum('remaining_amount');
        const notes = encode({ kind: 'parent', sectionIds: sections.map(s => s.id), originalNotes: metadata(parent)?.originalNotes || '' });
        const dates = selected.map(s => s.due_date).filter(Boolean).sort();
        db.prepare(`UPDATE sales SET subtotal = ?, total_amount = ?, paid_amount = ?, remaining_amount = ?, plumbing_discount_amount = ?, trader_discount_amount = ?, general_discount_amount = ?, sale_type = ?, due_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(sum('subtotal'), total, paid, remaining, sum('plumbing_discount_amount'), sum('trader_discount_amount'), sum('general_discount_amount'), remaining > 0.000001 ? 'credit' : 'cash', dates[0] || null, notes, parent.id);
        for (const section of additions) {
            db.prepare("UPDATE sales SET status = 'consolidated', is_hidden = 1, notes = ? WHERE id = ?").run(encode({ kind: 'section', parentId: parent.id, originalNotes: section.notes || '' }), section.id);
            db.prepare('UPDATE sale_payments SET sale_id = ?, notes = ? || COALESCE(notes, ?) WHERE sale_id = ?').run(parent.id, `[${section.invoice_number}] `, '', section.id);
        }
        return { success: true, saleId: parent.id, invoiceNumber: parent.invoice_number, total, paid, remaining };
    })();
}
function decorateInvoice(db, sale, loadSection) {
    const info = metadata(sale);
    if (!info) return sale;
    if (info.kind === 'section') throw new Error('يجب تحميل الفاتورة الأم');
    const sections = info.sectionIds.map(id => {
        const section = loadSection(id);
        if (!section || metadata(section)?.parentId !== sale.id) throw new Error('أقسام الفاتورة غير سليمة');
        section.notes = metadata(section).originalNotes;
        return section;
    });
    const returnMap = new Map();
    for (const r of (sale.returns || [])) {
        if (r && r.id != null) returnMap.set(r.id, r);
    }
    for (const s of sections) {
        for (const r of (s.returns || [])) {
            if (r && r.id != null && !returnMap.has(r.id)) returnMap.set(r.id, r);
        }
    }
    const combinedReturns = Array.from(returnMap.values());
    const directItems = (sale.items || []).map(item => ({ ...item, invoice_parent_addition: true }));
    const sectionItems = sections.flatMap(s => s.items || []);
    return { ...sale, notes: info.originalNotes, is_consolidated: true, sections, items: [...sectionItems, ...directItems], returns: combinedReturns };
}
function registerConsolidation(ipcMain, db) {
    ipcMain.handle('sales:consolidate', (_event, ids) => mergeInvoices(db, ids));
}
module.exports = { PREFIX, metadata, resolveParentId, assertOrdinary, mergeInvoices, decorateInvoice, registerConsolidation };
