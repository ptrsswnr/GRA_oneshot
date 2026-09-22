// ─────────────────────────────────────────────────────────────
// js/receipt-ai.js — เรียก OpenRouter (โมเดล google/gemini-2.5-flash-lite, vision) 3 งาน:
//   1) analyzeReceiptWithAI()      — FS-02: อ่านผู้ขาย/วันที่/จำนวนเงิน/หมวด จากรูปใบเสร็จ
//   2) guessDocumentTypeWithAI()   — FS-02: เดาว่าไฟล์แนบ 1 ไฟล์เป็นเอกสารประเภทไหน (จากตัวเลือก
//                                    ที่จำกัดเฉพาะ documentTypeIds ของ evidence chain ที่ผูกกับหมวด)
//   3) extractDocumentFieldsWithAI() — FS-08: ดึงข้อความ field–value ตาม requiredFields ของ
//                                    documentType นั้น (ห้ามประเมิน/ตัดสินถูกผิด แค่ดึงข้อความ)
//
// AI ทั้ง 3 งานนี้ "เสนอ" ข้อมูลเท่านั้น — นักวิจัยต้องตรวจ/ยืนยัน/แก้ก่อนใช้จริงเสมอ (ดู FS-02/FS-08)
// และ**ไม่มีงานใดใน 3 งานนี้ตัดสินสถานะผ่าน/ไม่ผ่าน** — การตัดสินเป็นหน้าที่ของ js/rule-engine.js
// (โค้ดล้วนๆ) เท่านั้น ตาม FS-03
//
// ต้องมี window.OPENROUTER_API_KEY (จาก js/ai-config.local.js) — ถ้าไม่มี หรือเรียกไม่สำเร็จ
// ผู้เรียก (new-receipt.js / project-budget.js) ต้อง fallback เอง ไม่ throw ค้างจนหน้าใช้งานไม่ได้
// ─────────────────────────────────────────────────────────────

var OPENROUTER_MODEL = "google/gemini-2.5-flash-lite";
var OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function fileToDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () { reject(reader.error); };
    reader.readAsDataURL(file);
  });
}

// โมเดลบางตัวห่อ JSON ด้วย ```json ... ``` ทั้งที่ขอให้ตอบ JSON ล้วนแล้ว — ตัดออกก่อน parse
function extractJson(text) {
  var fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

async function callOpenRouterVision(promptText, dataUrl) {
  var response = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + window.OPENROUTER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: promptText },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    var errBody = await response.text();
    throw new Error("OpenRouter API error " + response.status + ": " + errBody.slice(0, 200));
  }

  var result = await response.json();
  var content = result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
  if (!content) {
    throw new Error("OpenRouter ไม่ส่งข้อความกลับมา");
  }
  return content;
}

// 1) FS-02 — อ่านใบเสร็จจากไฟล์รูปภาพด้วย AI จริง — คืนค่า { amount, date, category, vendorName }
// (ชื่อ field ตรงกับ schema ของ receipts ใน spec หัวข้อ 3 — ไม่ใช่ confirmedX แบบโปรเจกต์เดิม)
window.analyzeReceiptWithAI = async function (file, categories) {
  var dataUrl = await fileToDataUrl(file);
  var prompt =
    "อ่านใบเสร็จรับเงินในรูปนี้ แล้วตอบกลับเป็น JSON เท่านั้น (ห้ามมีข้อความอื่นนอกเหนือจาก JSON) รูปแบบ:\n" +
    '{"vendorName": string, "date": "YYYY-MM-DD", "amount": number, "category": string}\n' +
    "amount ต้องเป็นตัวเลขล้วน ไม่มีสัญลักษณ์สกุลเงินหรือคอมมา\n" +
    "category ต้องเลือกจากรายการนี้เท่านั้น (ตอบตามตัวสะกดเป๊ะๆ): " + categories.join(", ");

  var content = await callOpenRouterVision(prompt, dataUrl);
  var parsed = extractJson(content);
  var amount = typeof parsed.amount === "number" ? parsed.amount : parseFloat(parsed.amount);
  if (isNaN(amount)) {
    throw new Error("อ่านยอดเงินจากใบเสร็จไม่ได้");
  }

  return {
    amount: Math.round(amount * 100) / 100,
    date: parsed.date || "",
    category: categories.indexOf(parsed.category) !== -1 ? parsed.category : "",
    vendorName: parsed.vendorName || "",
  };
};

// 2) FS-02 — เดาว่าไฟล์แนบนี้เป็นเอกสารประเภทไหน จากตัวเลือกที่จำกัดไว้แล้ว (candidateDocTypes:
// [{id, documentName, formCode}]) — คืนค่า documentTypeId ที่เดา หรือ null ถ้าเดาไม่ได้/ไม่ตรงตัวเลือก
// AI แค่ "เดา" เป็นค่าเริ่มต้นในดรอปดาวน์ — นักวิจัยต้องยืนยัน/แก้ก่อนส่งเสมอ (ไม่ใช่ผู้ตัดสิน)
window.guessDocumentTypeWithAI = async function (file, candidateDocTypes) {
  var dataUrl = await fileToDataUrl(file);
  var optionsText = candidateDocTypes.map(function (d) {
    return d.id + " = " + d.documentName + (d.formCode && d.formCode !== "-" ? " (" + d.formCode + ")" : "");
  }).join("\n");
  var prompt =
    "ไฟล์แนบนี้เป็นเอกสารประเภทไหน? เลือกจากรายการนี้เท่านั้น แล้วตอบ id ที่ตรงที่สุดกลับมาเป็น JSON " +
    "ล้วนๆ รูปแบบ {\"documentTypeId\": \"<id>\"} ถ้าไม่แน่ใจ/ไม่ตรงกับรายการเลย ให้ตอบ " +
    '{"documentTypeId": null}\n\nตัวเลือก:\n' + optionsText;

  var content = await callOpenRouterVision(prompt, dataUrl);
  var parsed = extractJson(content);
  var validIds = candidateDocTypes.map(function (d) { return d.id; });
  return validIds.indexOf(parsed.documentTypeId) !== -1 ? parsed.documentTypeId : null;
};

// FS-01b(ข) — อ่านไฟล์รูป/PDF ของประมาณการงบประมาณโครงการ แล้วเสนอรายการ [{categoryName,
// estimatedAmount, unit, note}] ให้นักวิจัยตรวจ/แก้ก่อนบันทึกเอง (AI แค่เสนอ ไม่บันทึกตรงให้ —
// ดู FS-01b) categories ที่ตอบต้องตรงตัวสะกดกับรายการหมวดจริงเท่านั้น เพื่อให้จับคู่ตอนตรวจใบเสร็จ
// (FS-03 ชั้นที่ 2) ได้ตรงๆ ด้วยชื่อหมวด
window.analyzeBudgetEstimateWithAI = async function (file, categories) {
  var dataUrl = await fileToDataUrl(file);
  var prompt =
    "อ่านเอกสารประมาณการงบประมาณโครงการวิจัยในไฟล์นี้ แล้วตอบกลับเป็น JSON เท่านั้น (ห้ามมีข้อความอื่น" +
    "นอกเหนือจาก JSON) รูปแบบเป็น array ของรายการ:\n" +
    '[{"categoryName": string, "estimatedAmount": number, "unit": string, "note": string}]\n' +
    "categoryName ต้องเลือกจากรายการนี้เท่านั้น (ตอบตามตัวสะกดเป๊ะๆ) — ถ้ารายการในเอกสารไม่ตรงกับ" +
    "หมวดใดเลย ให้ข้ามรายการนั้นไปเลย ไม่ต้องเดา: " + categories.join(", ") + "\n" +
    "estimatedAmount ต้องเป็นตัวเลขล้วน ไม่มีสัญลักษณ์สกุลเงินหรือคอมมา";

  var content = await callOpenRouterVision(prompt, dataUrl);
  var parsed = extractJson(content);
  if (!Array.isArray(parsed)) throw new Error("AI ไม่ได้ตอบเป็นรายการ (array) ตามที่ขอ");

  return parsed
    .filter(function (item) { return categories.indexOf(item.categoryName) !== -1; })
    .map(function (item) {
      var estimatedAmount = typeof item.estimatedAmount === "number" ? item.estimatedAmount : parseFloat(item.estimatedAmount);
      return {
        categoryName: item.categoryName,
        estimatedAmount: isNaN(estimatedAmount) ? 0 : Math.round(estimatedAmount * 100) / 100,
        unit: item.unit || "",
        note: item.note || "",
      };
    });
};

// 3) FS-08 — ดึงข้อความที่เห็นจริงในไฟล์มาเป็นคู่ field–value ตาม requiredFields ของ documentType
// ที่เลือกไว้แล้วเท่านั้น — ห้ามประเมิน/ตัดสินว่าถูกต้องหรือไม่ (แค่ transcribe) คืนค่า
// { [fieldName]: value|"" } — ค่าที่ AI บอกว่า "ไม่พบ" ให้คืนเป็นสตริงว่างเสมอ (ให้ผู้ใช้กรอกเอง)
window.extractDocumentFieldsWithAI = async function (file, requiredFields) {
  var dataUrl = await fileToDataUrl(file);
  var prompt =
    "ดึงข้อความที่เห็นจริงในไฟล์นี้มาเป็นคู่ field–value เท่านั้น ห้ามประเมิน/ตัดสินว่าถูกต้องหรือไม่ " +
    "ห้ามคาดเดาค่าที่ไม่เห็นในไฟล์ ถ้าไม่พบข้อมูลของ field ใดให้ใส่ค่าว่าง \"\" สำหรับ field นั้น\n" +
    "field ที่ต้องดึง (ตอบให้ครบทุก field นี้ในรูปแบบ JSON ล้วนๆ เท่านั้น {\"<ชื่อ field>\": \"<ข้อความที่พบ หรือ ว่าง>\"}):\n" +
    requiredFields.join("\n");

  var content = await callOpenRouterVision(prompt, dataUrl);
  var parsed = extractJson(content);
  var result = {};
  requiredFields.forEach(function (fieldName) {
    var value = parsed[fieldName];
    result[fieldName] = (value == null || value === "ไม่พบ") ? "" : String(value);
  });
  return result;
};
