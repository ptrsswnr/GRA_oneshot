// ─────────────────────────────────────────────────────────────
// js/ai-explain.js — FS-04: คำอธิบายผลตรวจจาก AI (agentic, อ้างอิงกฎที่มีอยู่จริงเท่านั้น)
//
// ผลตรวจ (ผ่าน/ต้องแก้ไข/ไม่เข้าเงื่อนไข) ตัดสินไปแล้วโดย js/rule-engine.js (โค้ดล้วนๆ) ก่อนไฟล์นี้
// จะถูกเรียก — ไฟล์นี้ไม่เปลี่ยนสถานะนั้นเด็ดขาด แค่แปลงผลตรวจ 4 ชั้นให้เป็นคำอธิบายภาษาที่เข้าใจง่าย
//
// ขั้นตอน (agentic 4 ขั้น ตาม spec):
//   1) อ่านหลายแหล่งข้อมูลจริงจาก Firestore (evidenceChain + documentTypes ที่เกี่ยวข้อง)
//   2) สรุปให้ผู้ใช้ — เรียก AI 1 ครั้ง ส่งเฉพาะข้อมูลที่อ่านมาจริง + ผลตัดสินจริงจาก Rule Engine
//      (ห้ามอ้างอิงความรู้ภายนอก ห้ามเดา/แต่งกฎหรือตัวเลข ห้ามอ้างว่าตรวจไฟล์แนบจริงแล้ว)
//   3) เขียนผลลง receipt.aiExplanation (caller เป็นคนเขียนจริง — ฟังก์ชันนี้แค่ return ข้อความ)
//   4) บันทึก log ลง agentLogs (usedAi, model, evidenceChainId, documentTypeIds, finalExplanation,
//      durationMs) — ทำเสมอไม่ว่าจะใช้ AI สำเร็จหรือ fallback
//
// ถ้าไม่มีคีย์ AI หรือเรียกไม่สำเร็จ → fallback เป็นข้อความที่สร้างจากข้อมูล Firestore ล้วนๆ (ไม่ต้อง
// พึ่ง AI เลย) ต่อท้ายด้วยรายชื่อเอกสารที่ยังขาด (ชั้นที่ 3) และ field ที่ขาด/ไม่ผ่าน (ชั้นที่ 4) —
// ระบบต้องทำงานได้เต็มรูปแบบแม้ไม่มี AI เลย (ดู spec หัวข้อ 7/9)
// ─────────────────────────────────────────────────────────────

async function gatherEvidenceSources(evidenceChainId) {
  if (!evidenceChainId) return { evidenceChain: null, documentTypes: [] };

  var chainDoc = await db.collection("evidenceChains").doc(evidenceChainId).get();
  if (!chainDoc.exists) return { evidenceChain: null, documentTypes: [] };
  var chain = Object.assign({ id: chainDoc.id }, chainDoc.data());

  var documentTypeIds = [];
  (chain.steps || []).forEach(function (step) {
    (step.documentTypeIds || []).forEach(function (id) {
      if (documentTypeIds.indexOf(id) === -1) documentTypeIds.push(id);
    });
  });
  (chain.conditionalSteps || []).forEach(function (cs) {
    ((cs.addStep && cs.addStep.documentTypeIds) || []).forEach(function (id) {
      if (documentTypeIds.indexOf(id) === -1) documentTypeIds.push(id);
    });
  });

  var documentTypes = [];
  for (var i = 0; i < documentTypeIds.length; i++) {
    var doc = await db.collection("documentTypes").doc(documentTypeIds[i]).get();
    if (doc.exists) documentTypes.push(Object.assign({ id: doc.id }, doc.data()));
  }
  return { evidenceChain: chain, documentTypes: documentTypes };
}

function docName(documentTypes, id) {
  var match = documentTypes.filter(function (d) { return d.id === id; })[0];
  if (!match) return id;
  return match.documentName + (match.formCode && match.formCode !== "-" ? " (" + match.formCode + ")" : "");
}

// สร้างข้อความอธิบายเต็มรูปแบบจากข้อมูลจริงล้วนๆ (ไม่ใช้ AI) — ใช้เป็น fallback เมื่อไม่มี AI/AI ล้มเหลว
// และใช้เป็น "ข้อมูลตั้งต้น" ที่ป้อนให้ AI สรุปต่อเมื่อมี AI ด้วย (กันไม่ให้ AI ต้องแต่งตัวเลข/ชื่อเอกสาร
// เอง — ทุกตัวเลข/ชื่อเอกสารในข้อความนี้มาจาก Firestore ตรงๆ ทั้งหมด)
function buildDeterministicSummary(ruleEngineResult, sources) {
  var lines = [];
  var r = ruleEngineResult;

  lines.push("สถานะ: " + r.status);

  if (r.tier1) lines.push("ชั้นที่ 1 (เพดานแหล่งทุน): " + r.tier1.reason);
  if (r.tier2 && r.tier2.applied) lines.push("ชั้นที่ 2 (งบประมาณโครงการ): " + r.tier2.reason);

  if (r.tier3 && r.tier3.applied) {
    if (r.tier3.missingSteps.length > 0) {
      var missingNames = r.tier3.missingSteps.map(function (step) {
        return (step.documentTypeIds || []).map(function (id) { return docName(sources.documentTypes, id); }).join(" หรือ ");
      });
      lines.push("ชั้นที่ 3 (เอกสารประกอบ \"" + sources.evidenceChain.chainName + "\"): ยังขาดเอกสารต่อไปนี้ — " + missingNames.join(" ; "));
    } else {
      lines.push("ชั้นที่ 3 (เอกสารประกอบ \"" + sources.evidenceChain.chainName + "\"): แนบเอกสารบังคับครบทุกขั้นตอนแล้ว");
    }
  }

  if (r.tier4 && r.tier4.applied) {
    if (r.tier4.missingFields.length > 0) {
      var fieldLines = r.tier4.missingFields.map(function (f) {
        return (f.documentName || f.documentTypeId) + (f.formCode && f.formCode !== "-" ? " (" + f.formCode + ")" : "") + ": ไม่พบ/ไม่ได้กรอก \"" + f.fieldName + "\"";
      });
      lines.push("ชั้นที่ 4 (เนื้อหาเอกสาร): ยังขาดข้อมูลต่อไปนี้ — " + fieldLines.join(" ; "));
    } else {
      lines.push("ชั้นที่ 4 (เนื้อหาเอกสาร): ข้อมูลที่ต้องมีครบตามที่ตรวจอัตโนมัติได้แล้ว");
    }
    if (r.tier4.manualReviewNotes.length > 0) {
      var reviewLines = r.tier4.manualReviewNotes.map(function (n) {
        return (n.documentName || n.documentTypeId) + ": " + n.check;
      });
      lines.push("ควรตรวจเพิ่มเติมด้วยคน (ไม่กระทบสถานะ): " + reviewLines.join(" ; "));
    }
  }

  return lines.join("\n");
}

async function summarizeWithAi(opts, sources, deterministicSummary) {
  var lines = [];
  lines.push("คุณคือผู้ช่วยอธิบายผลตรวจใบเสร็จทุนวิจัยของมหาวิทยาลัย ข้อมูลด้านล่างนี้คือผลตรวจจริงที่ระบบ" +
    "ตัดสินไปแล้วด้วยโค้ด (ไม่ใช่หน้าที่ของคุณ ห้ามเปลี่ยนสถานะ/ผลตรวจนี้เด็ดขาด) และข้อมูลกฎ/เอกสารจริงที่" +
    "ดึงมาจากฐานข้อมูลของระบบ");
  lines.push("ห้ามใช้ความรู้ภายนอกหรือกฎ/ระเบียบอื่นใดนอกเหนือจากที่ให้มานี้เด็ดขาด ห้ามสมมติกฎ เอกสาร ตัวเลข " +
    "หรือเงื่อนไขเพิ่มเอง ถ้าข้อมูลไม่พอให้บอกตรงๆ ว่าไม่พอ");
  lines.push("คุณไม่เห็นไฟล์ที่ผู้ใช้แนบจริง ห้ามอ้างว่าตรวจสอบไฟล์แนบแล้วหรือครบ/ไม่ครบ — บอกแค่ว่าตามกฎ" +
    "ต้องมีอะไรบ้างจากข้อมูลด้านล่างเท่านั้น");
  lines.push("");
  lines.push("ข้อมูลใบเสร็จ: หมวด \"" + opts.category + "\" ยอดเงิน " + opts.amount + " บาท");
  lines.push("");
  lines.push("ผลตรวจจริงจากระบบ (คัดลอกมาให้ครบทุกบรรทัด ห้ามตัดทอนข้อมูลตัวเลข/ชื่อเอกสารที่ระบุไว้):");
  lines.push(deterministicSummary);
  lines.push("");
  lines.push("หน้าที่ของคุณ: เขียนคำอธิบายภาษาไทยที่เข้าใจง่าย (ไม่ใช้ศัพท์บัญชี) ไม่เกิน 8 ประโยค โดย:");
  lines.push("1) สรุปผลตรวจตามที่ระบบตัดสินไว้ข้างต้น (ห้ามเปลี่ยนผลเอง)");
  lines.push("2) ถ้าตกที่ชั้น 2 (งบประมาณ) ให้บอกตัวเลขจริง: ของบไว้เท่าไร ใช้ไปแล้วเท่าไร (รวมใบนี้) เกินไปเท่าไร");
  lines.push("3) ถ้าตกที่ชั้น 3 (เอกสารไม่ครบ) ให้ระบุชื่อเอกสารที่ยังขาดทีละรายการ");
  lines.push("4) ถ้าตกที่ชั้น 4 (เนื้อหาเอกสาร) ให้ระบุชื่อเอกสาร + ชื่อ field ที่ขาด/ไม่ผ่านทีละรายการ");
  lines.push("5) ถ้ามีรายการ \"ควรตรวจเพิ่มเติมด้วยคน\" ให้แสดงแยกจากรายการที่ทำให้ตกสถานะจริงๆ ชัดเจน ไม่ปนกัน");
  lines.push("6) ถ้าผลตรวจไม่ผ่าน ให้บอกวิธีแก้ไขที่ทำได้จริงจากข้อมูลที่ให้มาเท่านั้น ห้ามแนะนำสิ่งที่ไม่มีอยู่ในข้อมูลนี้");

  var response = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + window.OPENROUTER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: "user", content: lines.join("\n") }],
    }),
  });

  if (!response.ok) {
    var errBody = await response.text();
    throw new Error("OpenRouter API error " + response.status + ": " + errBody.slice(0, 200));
  }

  var result = await response.json();
  var content = result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
  if (!content) throw new Error("OpenRouter ไม่ส่งข้อความกลับมา");
  return content.trim();
}

// opts: { receiptRef, evidenceChainId, category, amount, ruleEngineResult }
// คืนค่าเป็นคำอธิบายสุดท้าย (string) — caller เขียนทับ receipt.aiExplanation เอง ฟังก์ชันนี้เขียน
// เฉพาะ agentLogs (ไม่ throw ออกไปนอกฟังก์ชัน ยกเว้นเขียน agentLogs ล้มเหลว) เพื่อไม่ให้การอธิบาย
// เพิ่มเติมที่ล้มเหลวไปบล็อกการบันทึกใบเสร็จที่ทำสำเร็จไปแล้ว
window.runAiExplain = async function (opts) {
  var startedAt = Date.now();
  var sources = await gatherEvidenceSources(opts.evidenceChainId);
  var deterministicSummary = buildDeterministicSummary(opts.ruleEngineResult, sources);

  var explanation;
  var usedAi = false;
  try {
    if (window.OPENROUTER_API_KEY) {
      explanation = await summarizeWithAi(opts, sources, deterministicSummary);
      usedAi = true;
    } else {
      explanation = deterministicSummary;
    }
  } catch (err) {
    explanation = deterministicSummary + "\n\n(หมายเหตุ: เรียก AI อธิบายเพิ่มเติมไม่สำเร็จ — " + err.message + " แสดงผลตรวจจากข้อมูลจริงล้วนๆ แทน)";
  }

  await opts.receiptRef.collection("agentLogs").add({
    kind: "explanation",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    usedAi: usedAi,
    model: usedAi ? OPENROUTER_MODEL : null,
    category: opts.category,
    amount: opts.amount,
    finalStatus: opts.ruleEngineResult.status,
    evidenceChainId: opts.evidenceChainId || null,
    documentTypeIds: sources.documentTypes.map(function (d) { return d.id; }),
    finalExplanation: explanation,
    durationMs: Date.now() - startedAt,
  });

  return explanation;
};
