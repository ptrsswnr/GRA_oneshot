// ─────────────────────────────────────────────────────────────
// js/rule-engine.js — FS-03: Rule Engine 4 ชั้น (deterministic, ไม่มี AI ตัดสินใจใดๆ ในไฟล์นี้เลย)
//
// ชั้นที่ 1: เพดานของแหล่งทุน (ruleItems)
// ชั้นที่ 2: งบประมาณที่โครงการนี้ประมาณการไว้เอง (budgetItems) + ยอดสะสมของใบเสร็จที่เคยผ่านแล้ว
// ชั้นที่ 3: ความครบถ้วนของเอกสารแนบตาม evidence chain (documentTypeId ต่อไฟล์)
// ชั้นที่ 4: เนื้อหาในเอกสารแนบ (extractedFields ที่ผู้ใช้ยืนยันแล้ว เทียบกับ requiredFields)
//
// ทุกฟังก์ชันในไฟล์นี้เป็นการเทียบค่า/รายการล้วนๆ จาก Firestore — ไม่มีการเรียก AI ที่นี่เลย (AI ถูก
// เรียกแยกต่างหากใน receipt-ai.js/ai-explain.js เท่านั้น และผลจาก AI ไม่เคยถูกใช้ตัดสินสถานะที่นี่)
//
// หมายเหตุการออกแบบ validityChecks (ชั้นที่ 4): documentTypes.validityChecks[] เป็นข้อความอิสระ
// (free text) จากคู่มือจริง ไม่ใช่ struct {field, operator, value} ที่โค้ดเทียบค่าเองได้ตรงๆ — เท่าที่
// ระบบนี้เก็บข้อมูลไว้ (extractedFields เป็น flat map ต่อไฟล์ ไม่มีความสัมพันธ์ข้ามเอกสารที่ประกาศไว้
// เป็นโครงสร้าง) จึงไม่มีทางแยกแยะอัตโนมัติได้ว่า validityCheck ข้อไหน "เทียบเป็นค่าได้ตรงๆ" กับข้อไหน
// "ต้องเทียบด้วยสายตา" โดยไม่เสี่ยง parse ข้อความไทยอิสระผิดแล้วฟันธงสถานะผิดๆ (ซึ่งขัดกับกติกา "AI/โค้ด
// ห้ามเดา") — การตัดสินใจที่ปลอดภัยและตรงไปตรงมาที่สุดคือ: ถือว่า validityChecks ทุกข้อเป็นรายการ
// "ควรตรวจเพิ่มเติมด้วยคน" เสมอ (ไม่กระทบสถานะ ตรงตามกติกาข้อ "เทียบด้วยสายตาไม่กระทบสถานะ") ส่วนสิ่ง
// เดียวที่ชั้นที่ 4 นี้ตัดสินสถานะจริงๆ คือ requiredFields ที่ว่างเปล่า (ตรวจได้ตรงไปตรงมา ไม่ต้องตีความ)
// ─────────────────────────────────────────────────────────────

var STATUS_PASS = "ผ่าน";
var STATUS_FIX = "ต้องแก้ไข";
var STATUS_REJECT = "ไม่เข้าเงื่อนไข";

function statusRank(status) {
  if (status === STATUS_REJECT) return 2;
  if (status === STATUS_FIX) return 1;
  return 0; // ผ่าน / null(ยังไม่ตัดสิน)
}
function worseOf(a, b) {
  return statusRank(b) > statusRank(a) ? b : a;
}

function formatCurrency(amount) {
  if (typeof amount !== "number") return "-";
  return "฿" + amount.toLocaleString("th-TH", { minimumFractionDigits: 2 });
}

// ─── ชั้นที่ 1 ───────────────────────────────────────────────
async function evaluateTier1(fundSourceId, category, amount) {
  if (!fundSourceId) {
    return {
      applied: true, terminal: true, status: STATUS_REJECT, ruleItem: null,
      reason: "ไม่พบแหล่งทุนของโครงการนี้ กรุณาตรวจสอบข้อมูลโครงการที่หน้าโครงการของฉัน",
    };
  }

  var ruleVersionsSnap = await db.collection("fundSources").doc(fundSourceId)
    .collection("ruleVersions").where("isActive", "==", true).limit(1).get();
  if (ruleVersionsSnap.empty) {
    return {
      applied: true, terminal: true, status: STATUS_REJECT, ruleItem: null,
      reason: "แหล่งทุนนี้ยังไม่มีระเบียบที่ admin กำหนดไว้ กรุณาติดต่อผู้ดูแลระบบ",
    };
  }

  var ruleItemsSnap = await ruleVersionsSnap.docs[0].ref.collection("ruleItems")
    .where("categoryName", "==", category).limit(1).get();
  if (ruleItemsSnap.empty) {
    return {
      applied: true, terminal: true, status: STATUS_REJECT, ruleItem: null,
      reason: "ระเบียบของแหล่งทุนนี้ไม่มีหมวด \"" + category + "\" — หมวดนี้ไม่มีกฎรองรับ",
    };
  }

  var ruleItem = Object.assign({ id: ruleItemsSnap.docs[0].id }, ruleItemsSnap.docs[0].data());
  var rateType = ruleItem.rateType || "เพดานตามจริง";
  var rateAmount = ruleItem.rateAmount != null ? ruleItem.rateAmount : null;

  if (rateType === "เพดานตามจริง" || rateType === "เหมาจ่าย") {
    if (rateAmount != null && amount > rateAmount) {
      return {
        applied: true, terminal: false, status: STATUS_FIX, ruleItem: ruleItem,
        reason: "ยอดเงิน " + formatCurrency(amount) + " เกินเพดานของหมวด \"" + category + "\" (ไม่เกิน " +
          formatCurrency(rateAmount) + (ruleItem.unit ? " / " + ruleItem.unit : "") + ")",
      };
    }
    return {
      applied: true, terminal: false, status: STATUS_PASS, ruleItem: ruleItem,
      reason: "ยอดเงินไม่เกินเพดานของหมวด \"" + category + "\"" +
        (rateAmount != null ? " (" + formatCurrency(rateAmount) + (ruleItem.unit ? " / " + ruleItem.unit : "") + ")" : ""),
    };
  }

  // "ต่อหน่วย"/"ตามข้อเสนอโครงการ" — ไม่มีเพดานระดับแหล่งทุนให้เทียบ ส่งต่อให้ชั้นที่ 2 ตัดสินแทน
  return {
    applied: true, terminal: false, status: null, ruleItem: ruleItem,
    reason: "หมวด \"" + category + "\" เป็นประเภท " + rateType + " — ไม่มีเพดานระดับแหล่งทุน ตรวจสอบกับ" +
      "งบประมาณที่โครงการนี้ของบไว้แทน (ชั้นที่ 2)",
  };
}

// ─── ชั้นที่ 2 ───────────────────────────────────────────────
async function evaluateTier2(projectRef, category, amount) {
  var budgetItemsSnap = await projectRef.collection("budgetItems")
    .where("categoryName", "==", category).limit(1).get();

  if (budgetItemsSnap.empty) {
    return {
      applied: true, terminal: true, status: STATUS_REJECT,
      reason: "โครงการนี้ไม่ได้ตั้งงบประมาณ (budgetItems) ไว้สำหรับหมวด \"" + category + "\" เลย — " +
        "ต้องกรอกงบประมาณของหมวดนี้ไว้ก่อนที่หน้างบประมาณโครงการ ถึงจะเบิกหมวดนี้ได้",
    };
  }

  var budgetItem = Object.assign({ id: budgetItemsSnap.docs[0].id }, budgetItemsSnap.docs[0].data());
  var estimatedAmount = typeof budgetItem.estimatedAmount === "number" ? budgetItem.estimatedAmount : 0;

  // รวมยอดใบเสร็จที่ "เคยผ่านแล้ว" ของโครงการนี้ในหมวดเดียวกัน (ไม่รวมใบที่ยังไม่ผ่าน/ถูกปฏิเสธ) —
  // อ่าน field ใหม่ (category/amount) ก่อน แล้ว fallback เป็นชื่อ field เก่า (confirmedCategory/
  // confirmedAmount) เผื่อมีใบเสร็จเก่าจากระบบเดิมอยู่ในโครงสร้างเดียวกัน (ดูหมายเหตุ backward-compat)
  var receiptsSnap = await projectRef.collection("receipts").where("status", "==", STATUS_PASS).get();
  var previousPassedTotal = 0;
  receiptsSnap.forEach(function (doc) {
    var r = doc.data();
    var rCategory = r.category != null ? r.category : r.confirmedCategory;
    var rAmount = typeof r.amount === "number" ? r.amount : r.confirmedAmount;
    if (rCategory === category && typeof rAmount === "number") {
      previousPassedTotal += rAmount;
    }
  });

  var cumulativeTotal = previousPassedTotal + amount;
  var exceeded = cumulativeTotal > estimatedAmount;

  return {
    applied: true, terminal: false, status: exceeded ? STATUS_FIX : null,
    budgetItem: budgetItem, estimatedAmount: estimatedAmount,
    previousPassedTotal: previousPassedTotal, cumulativeTotal: cumulativeTotal, exceeded: exceeded,
    reason: exceeded
      ? "ยอดสะสมของหมวด \"" + category + "\" ในโครงการนี้ (รวมใบนี้) = " + formatCurrency(cumulativeTotal) +
        " เกินงบประมาณที่ของบไว้ " + formatCurrency(estimatedAmount) + " อยู่ " +
        formatCurrency(cumulativeTotal - estimatedAmount)
      : "ยอดสะสมของหมวด \"" + category + "\" ในโครงการนี้ (รวมใบนี้) = " + formatCurrency(cumulativeTotal) +
        " ไม่เกินงบประมาณที่ของบไว้ " + formatCurrency(estimatedAmount),
  };
}

// ─── ชั้นที่ 3 ───────────────────────────────────────────────
async function evaluateTier3(evidenceChainId, amount, files) {
  if (!evidenceChainId) {
    return { applied: false };
  }

  var chainDoc = await db.collection("evidenceChains").doc(evidenceChainId).get();
  if (!chainDoc.exists) {
    return { applied: false };
  }
  var chain = Object.assign({ id: chainDoc.id }, chainDoc.data());

  var requiredSteps = (chain.steps || []).filter(function (s) { return s.required === true; }).slice();
  (chain.conditionalSteps || []).forEach(function (cs) {
    var cond = cs.when || {};
    var actualValue = cond.field === "amount" ? amount : undefined;
    var conditionMet =
      (cond.op === ">" && actualValue > cond.value) ||
      (cond.op === ">=" && actualValue >= cond.value) ||
      (cond.op === "<" && actualValue < cond.value) ||
      (cond.op === "<=" && actualValue <= cond.value) ||
      (cond.op === "==" && actualValue === cond.value);
    if (conditionMet && cs.addStep) {
      requiredSteps.push(Object.assign({ required: true, conditional: true }, cs.addStep));
    }
  });

  var attachedDocTypeIds = files.map(function (f) { return f.documentTypeId; }).filter(Boolean);
  var missingSteps = requiredSteps.filter(function (step) {
    var accepted = step.documentTypeIds || [];
    return !accepted.some(function (id) { return attachedDocTypeIds.indexOf(id) !== -1; });
  });

  return {
    applied: true, chain: chain, requiredSteps: requiredSteps, missingSteps: missingSteps,
    status: missingSteps.length > 0 ? STATUS_FIX : null,
  };
}

// ─── ชั้นที่ 4 ───────────────────────────────────────────────
async function evaluateTier4(files) {
  var documentTypeCache = {};
  async function getDocumentType(id) {
    if (!(id in documentTypeCache)) {
      var doc = await db.collection("documentTypes").doc(id).get();
      documentTypeCache[id] = doc.exists ? Object.assign({ id: doc.id }, doc.data()) : null;
    }
    return documentTypeCache[id];
  }

  var missingFields = []; // [{documentTypeId, documentName, fieldName}]
  var manualReviewNotes = []; // [{documentTypeId, documentName, check}]
  var applied = false;

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (!file.documentTypeId) continue;
    var docType = await getDocumentType(file.documentTypeId);
    if (!docType) continue;

    var requiredFields = docType.requiredFields || [];
    var validityChecks = docType.validityChecks || [];
    if (requiredFields.length === 0 && validityChecks.length === 0) continue;
    applied = true;

    var extractedFields = file.extractedFields || {};
    requiredFields.forEach(function (fieldName) {
      var value = extractedFields[fieldName];
      if (value == null || String(value).trim() === "") {
        missingFields.push({ documentTypeId: docType.id, documentName: docType.documentName, formCode: docType.formCode, fieldName: fieldName });
      }
    });

    // validityChecks เป็นข้อความอิสระจากคู่มือ — ไม่มีโครงสร้างให้เทียบค่าข้ามเอกสารได้อัตโนมัติอย่าง
    // ปลอดภัย จึงขึ้นเป็น "ควรตรวจเพิ่มเติมด้วยคน" เสมอ ไม่กระทบสถานะ (ดูหมายเหตุหัวไฟล์)
    validityChecks.forEach(function (check) {
      manualReviewNotes.push({ documentTypeId: docType.id, documentName: docType.documentName, formCode: docType.formCode, check: check });
    });
  }

  return {
    applied: applied, missingFields: missingFields, manualReviewNotes: manualReviewNotes,
    status: missingFields.length > 0 ? STATUS_FIX : null,
  };
}

// ─── entry point ─────────────────────────────────────────────
// opts: { fundSourceId, projectRef, category, amount, files: [{documentTypeId, extractedFields}] }
window.runRuleEngine = async function (opts) {
  var files = opts.files || [];

  var tier1 = await evaluateTier1(opts.fundSourceId, opts.category, opts.amount);
  if (tier1.terminal) {
    return {
      status: tier1.status, evidenceChainId: null, ruleItem: null,
      tier1: tier1, tier2: { applied: false }, tier3: { applied: false }, tier4: { applied: false },
    };
  }

  var tier2 = await evaluateTier2(opts.projectRef, opts.category, opts.amount);
  if (tier2.terminal) {
    return {
      status: tier2.status, evidenceChainId: tier1.ruleItem ? (tier1.ruleItem.evidenceChainId || null) : null,
      ruleItem: tier1.ruleItem,
      tier1: tier1, tier2: tier2, tier3: { applied: false }, tier4: { applied: false },
    };
  }

  var status = worseOf(tier1.status || STATUS_PASS, tier2.status || STATUS_PASS);

  var evidenceChainId = tier1.ruleItem ? (tier1.ruleItem.evidenceChainId || null) : null;
  var tier3 = await evaluateTier3(evidenceChainId, opts.amount, files);
  if (tier3.applied && tier3.status) status = worseOf(status, tier3.status);

  var tier4 = await evaluateTier4(files);
  if (tier4.applied && tier4.status) status = worseOf(status, tier4.status);

  return {
    status: status, evidenceChainId: evidenceChainId, ruleItem: tier1.ruleItem,
    tier1: tier1, tier2: tier2, tier3: tier3, tier4: tier4,
  };
};

window.RULE_ENGINE_STATUS = { PASS: STATUS_PASS, FIX: STATUS_FIX, REJECT: STATUS_REJECT };
window.formatCurrencyTHB = formatCurrency;
