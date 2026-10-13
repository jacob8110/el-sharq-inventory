const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'src', 'database', 'data', 'el-sharq.db');

console.log('==================================================');
console.log('   تعريب أسماء الأصناف - شركة الشرق للتجارة');
console.log('==================================================');

try {
  const db = new Database(DB_PATH);
  
  const translations = [["Floor stand Toilet without douche & complete back to wall", "مرحاض أرضي ملاصق للحائط بدون دش"], ["Floor stand Toilet back to wall with douche Hydrojet", "مرحاض أرضي ملاصق للحائط بالدش هيدروجيت"], ["Floor stand Toilet back to wall with douche", "مرحاض أرضي ملاصق للحائط بالدش"], ["Wall mounted combi Toilet with douche Hydrojet", "مرحاض معلق كومبي بالدش هيدروجيت"], ["Wall mounted combi Toilet with douche", "مرحاض معلق كومبي بالدش"], ["Wall mounted combi Toilet without douche", "مرحاض معلق كومبي بدون دش"], ["Wall mounted Toilet with douche Hydrojet", "مرحاض معلق بالدش هيدروجيت"], ["Wall mounted Toilet with douche", "مرحاض معلق بالدش"], ["Wall mounted Toilet without douche", "مرحاض معلق بدون دش"], ["Wall mountedToilet without douche", "مرحاض معلق بدون دش"], ["Mini bowl with douche Hydrojet", "مرحاض صغير بالدش هيدروجيت"], ["Mini bowl with douche", "مرحاض صغير بالدش"], ["Mini bowl without douche", "مرحاض صغير بدون دش"], ["Bidet floor standing", "بيديه أرضي"], ["Bidet wall mounted", "بيديه معلق"], ["Chassis for wall hung toilet", "شاسيه دفن لمرحاض معلق"], ["Cistern with single flush mechanism for combi", "خزان ماكينة ضغط مفرد لكومبي"], ["Half pedestal Magnus for WB 45 / 60 cm R/L", "نصف عامود ماجنوس لحوض 45 / 60 سم يمين/شمال"], ["Half pedestal Vega for WB", "نصف عامود فيجا لحوض"], ["Half pedestal for WB 70 and", "نصف عامود لحوض 70 و"], ["Half pedestal for WB 45", "نصف عامود لحوض 45"], ["Half pedestal for WB", "نصف عامود لحوض"], ["Pedestal Vega", "عامود كامل فيجا"], ["Pedestal for WB 70 and", "عامود كامل لحوض 70 و"], ["Urinal orion round back inlet", "مبولة أوريون دائرية تغذية خلفية"], ["Urinal orion round top inlet", "مبولة أوريون دائرية تغذية علوية"], ["Urinal separator", "فاصل مباول"], ["Urinal taurus wash brook Top inlet with douche", "مبولة توروس تغذية علوية بالدش"], ["Urinal taurus wash brook back inlet with douche", "مبولة توروس تغذية خلفية بالدش"], ["Urinal taurus washbrook back inlet without douche", "مبولة توروس تغذية خلفية بدون دش"], ["Urinal taurus washbrookTop inlet without douche", "مبولة توروس تغذية علوية بدون دش"], ["Overcounter washbasin 42 cm without ceramic drain cover", "حوض فوق الرخامة 42 سم بدون غطاء صرف سيراميك"], ["Overcounter washbasin 48 cm including ceramic drain cover", "حوض فوق الرخامة 48 سم شامل غطاء صرف سيراميك"], ["Overcounter washbasin 50 cm", "حوض فوق الرخامة 50 سم"], ["Overcounter wash basin 60 cm", "حوض فوق الرخامة 60 سم"], ["Felis Over counter wash basin 49 cm with back plane glazed", "حوض فوق الرخامة فيليس 49 سم بظهر مطلي"], ["countertop Magnus washbasin 50 cm", "حوض ساقط في الرخامة ماجنوس 50 سم"], ["countertop oberon washbasin 55 cm", "حوض ساقط في الرخامة أوبيرون 55 سم"], ["Semi recessed Magnus washbasin 50 cm", "حوض نصف ساقط ماجنوس 50 سم"], ["Furniture basin icarus 60 cm center", "حوض موبيليا إيكاروس 60 سم منتصف"], ["Furniture basin icarus 65 cm center", "حوض موبيليا إيكاروس 65 سم منتصف"], ["Furniture basin icarus 75 cm center", "حوض موبيليا إيكاروس 75 سم منتصف"], ["Furniture basin icarus 75 cm Left", "حوض موبيليا إيكاروس 75 سم شمال"], ["Furniture basin icarus 75 cm Right", "حوض موبيليا إيكاروس 75 سم يمين"], ["Furniture basin icarus 85 cm", "حوض موبيليا إيكاروس 85 سم"], ["Furniture wash basin 85 cm", "حوض موبيليا 85 سم"], ["Furniture wash basin 90 cm", "حوض موبيليا 90 سم"], ["Furniture wash basin 105 cm", "حوض موبيليا 105 سم"], ["Apollo Wash Bowel D 420 x 420 mm without overflow", "حوض ديكور بولا أبوللو 42×42 سم بدون فايظ"], ["Evona Wash Bowel D 390 x 390 mm without overflow", "حوض ديكور بولا إيفونا 39×39 سم بدون فايظ"], ["Evona Wash Bowel D 510 x 405 mm without overflow", "حوض ديكور بولا إيفونا 51×40.5 سم بدون فايظ"], ["Harmony Wash Bowel D 590 x 390 mm without overflow", "حوض ديكور بولا هارموني 59×39 سم بدون فايظ"], ["Helios Wash Bowel D 355 x 355 mm without overflow", "حوض ديكور بولا هيليوس 35.5×35.5 سم بدون فايظ"], ["Hera Wash Bowel D 410 x 150 mm without overflow", "حوض ديكور بولا هيرا 41×15 سم بدون فايظ"], ["Wash Bowel eros 60 cm", "حوض ديكور بولا إيروس 60 سم"], ["Wash Bowel D 460 mm without overflow", "حوض ديكور بولا 46 سم بدون فايظ"], ["Wash Bowel 60 cm", "حوض ديكور بولا 60 سم"], ["Wash Bowel 80 cm", "حوض ديكور بولا 80 سم"], ["Wash Basin 45 cm", "حوض 45 سم"], ["Wash Basin 45cm", "حوض 45 سم"], ["Wash Basin 55 cm", "حوض 55 سم"], ["Wash Basin 60cmL eft", "حوض 60 سم شمال"], ["Wash Basin 65 cm", "حوض 65 سم"], ["Wash Basin60cm Right", "حوض 60 سم يمين"], ["Kitchen sink", "حوض مطبخ"], ["without tap platform", "بدون فتحة خلاط"], ["Big Soap", "صبانة كبيرة"], ["Small soap", "صبانة صغيرة"], ["Paper holder", "وراقة مناديل"], ["Towel", "حامل فوطة"], ["Shelf 50 cm", "رف 50 سم"], ["Hook", "علاقة ملابس"]];

  const products = db.prepare("SELECT id, name FROM products WHERE name LIKE '%Toilet%' OR name LIKE '%Basin%' OR name LIKE '%Bowel%' OR name LIKE '%washbasin%' OR name LIKE '%Urinal%' OR name LIKE '%pedestal%' OR name LIKE '%Soap%' OR name LIKE '%Bidet%' OR name LIKE '%holder%' OR name LIKE '%Shelf%' OR name LIKE '%Hook%'").all();

  console.log('تم العثور على ' + products.length + ' صنف يحتوي على مسميات إنجليزية.');

  const updateStmt = db.prepare('UPDATE products SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');

  let updatedCount = 0;
  const runTransaction = db.transaction(() => {
    for (const p of products) {
      let newName = p.name;
      for (const [eng, ar] of translations) {
        const regex = new RegExp(eng.replace(/[-\/\^+?.()|[\]{}]/g, '\$&'), 'gi');
        newName = newName.replace(regex, ar);
      }
      if (newName !== p.name) {
        updateStmt.run(newName, p.id);
        updatedCount++;
      }
    }
  });

  runTransaction();

  console.log('✔ تم تعريب ' + updatedCount + ' صنف بنجاح تام إلى اللغة العربية!');
  console.log('==================================================');

  const samples = db.prepare('SELECT id, internal_code, name FROM products WHERE category_id = 19 ORDER BY id DESC LIMIT 6').all();
  console.log('نماذج من الأصناف بعد التعريب:');
  samples.forEach((s, idx) => {
    console.log(' ' + (idx + 1) + '. [' + s.internal_code + '] ' + s.name);
  });

  db.close();
} catch (err) {
  console.error('✖ حدث خطأ:', err.message);
}
