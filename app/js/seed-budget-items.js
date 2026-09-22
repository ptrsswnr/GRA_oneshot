// ─────────────────────────────────────────────────────────────
// js/seed-budget-items.js — ใส่ตัวอย่างรายการประมาณการค่าใช้จ่ายของโครงการ (budgetItems)
//
// ทำไมมีเฉพาะ budgetItems: Firestore ของโปรเจกต์นี้เป็นฐานเดียวกับระบบเดิม (ดู README.md หัวข้อ Infra)
// ข้อมูลอ้างอิงกลางตามสเปกหัวข้อ 3.1 — fundSources 1 / ruleVersions 1 / ruleItems 22 /
// documentTypes 16 / evidenceChains 5 — ถูก seed ไว้แล้วจากระบบเดิม ตรวจสอบแล้วว่าตรงกับสเปกหัวข้อ 3.1
// ทุกรายการ จึง**ไม่ seed ซ้ำ**ที่นี่ (เขียนทับข้อมูลที่เว็บ production เดิมใช้อยู่จริงโดยไม่จำเป็น)
// เหลือแค่ budgetItems ที่เป็น collection ใหม่ของระบบนี้ (สเปกหัวข้อ 3 + FS-01b) ซึ่งยังไม่มีในฐานข้อมูล
//
// สิทธิ์: firestore.rules ให้เขียน users/{userId}/projects/{projectId}/budgetItems ได้เฉพาะเจ้าของ
// (request.auth.uid == userId) — admin อ่านได้อย่างเดียว เขียนของคนอื่นไม่ได้ สคริปต์นี้จึงเขียนลง
// โครงการของบัญชีที่ล็อกอินอยู่เท่านั้น
//
// ใช้ .set() กับ doc id คงที่ (budgetitem001/budgetitem002) เหมือน seed.js ของโปรเจกต์เดิม เพื่อให้กดซ้ำ
// ได้อย่างปลอดภัย ไม่เกิดรายการซ้ำ
//
// ตาม FS-01b: budgetItems เป็นข้อมูลที่ "ผู้ใช้กรอกเอง" ไม่ใช่ข้อมูลระเบียบตายตัว — จึง seed แค่ตัวอย่าง
// 2 รายการไว้ทดสอบ Rule Engine ชั้นที่ 2 เท่านั้น ห้ามแต่งชุดข้อมูลปลอมขนาดใหญ่
// ─────────────────────────────────────────────────────────────

// ตัวอย่าง 2 รายการ — ชื่อหมวดต้องตรงกับ categoryName ของ ruleItems จริง (สเปกหัวข้อ 3.1) เป๊ะ ๆ
// เพราะ Rule Engine ชั้นที่ 2 จับคู่ด้วยชื่อหมวดตรง ๆ ไม่มี fuzzy-match (FS-01b)
//  - "ค่าวัสดุสำนักงาน"        : ruleItem เพดานตามจริง 5,000 บาท → ตั้งงบไว้ 10,000 บาท
//    ใช้ทดสอบได้ทั้งใบที่ผ่านชั้น 1+2 (เช่น 3,000) และใบที่ตกชั้น 1 แต่ยังอยู่ในงบชั้น 2 (เช่น 6,500)
//  - "ค่าที่พัก (เดินทางปฏิบัติงาน)" : ruleItem เพดานตามจริง 1,800 บาท/วัน → ตั้งงบไว้ 5,400 บาท (3 วัน)
//    ใช้ทดสอบยอดสะสมชั้นที่ 2 (ใบที่ 4 ของหมวดนี้จะทำให้เกินงบ → "ต้องแก้ไข")
// หมวดอื่นที่ไม่มีในรายการนี้จะไม่มี budgetItem คู่กัน → ใบเสร็จหมวดนั้นต้องได้ "ไม่เข้าเงื่อนไข"
// ตาม FS-03 ชั้นที่ 2 (ใช้ทดสอบเคสนี้ได้เลยโดยไม่ต้องเพิ่มข้อมูล)
var BUDGET_ITEM_EXAMPLES = [
  {
    docId: "budgetitem001",
    categoryName: "ค่าวัสดุสำนักงาน",
    estimatedAmount: 10000,
    unit: "บาท",
    note: "ตัวอย่างสำหรับทดสอบ — ประมาณการค่าวัสดุสำนักงานตลอดโครงการ",
  },
  {
    docId: "budgetitem002",
    categoryName: "ค่าที่พัก (เดินทางปฏิบัติงาน)",
    estimatedAmount: 5400,
    unit: "วัน",
    note: "ตัวอย่างสำหรับทดสอบ — ประมาณการ 3 วัน × 1,800 บาท/วัน",
  },
];

var signInNotice = document.getElementById("signInNotice");
var seedForm = document.getElementById("seedForm");
var projectSelect = document.getElementById("projectSelect");
var seedButton = document.getElementById("seedBudgetItemsButton");
var resultBox = document.getElementById("seedResult");

var currentUser = null;
var projectsById = {};

seedButton.addEventListener("click", seedBudgetItems);

if (!window.firebase || !window.db) {
  // js/firebase-config.js เป็นไฟล์ของ app-builder — ถ้ายังไม่มี หน้านี้จะทำงานไม่ได้
  showNotice(
    "⚠️ ยังเชื่อมต่อ Firebase ไม่ได้ — ต้องมีไฟล์ js/firebase-config.js (ตั้งค่าโปรเจกต์ " +
    "grant-receipt-assistant) อยู่ในโฟลเดอร์ app/js/ ก่อน แล้วรีเฟรชหน้านี้อีกครั้ง"
  );
} else {
  firebase.auth().onAuthStateChanged(handleAuthStateChanged);
}

async function handleAuthStateChanged(user) {
  currentUser = user;
  if (!user) {
    showNotice("⚠️ ยังไม่ได้ล็อกอิน — กรุณาล็อกอินที่หน้า login.html ก่อน แล้วกลับมาเปิดหน้านี้อีกครั้ง");
    seedForm.hidden = true;
    return;
  }

  showNotice("ล็อกอินอยู่ในชื่อ " + (user.email || user.uid) + " — จะใส่ข้อมูลลงโครงการของบัญชีนี้เท่านั้น");

  try {
    await loadProjectOptions(user.uid);
  } catch (err) {
    showNotice("❌ อ่านรายการโครงการไม่สำเร็จ: " + err.message);
  }
}

// อ่านโครงการของบัญชีที่ล็อกอินอยู่มาทำ dropdown — ถ้ายังไม่มีโครงการเลย ให้ไปสร้างที่ projects.html ก่อน
async function loadProjectOptions(uid) {
  var snapshot = await db.collection("users").doc(uid).collection("projects").get();
  projectsById = {};
  projectSelect.innerHTML = "";

  snapshot.forEach(function (doc) {
    var project = doc.data();
    projectsById[doc.id] = project;
    var option = document.createElement("option");
    option.value = doc.id;
    option.textContent = (project.projectName || "(ไม่มีชื่อโครงการ)") + " — " + doc.id;
    projectSelect.appendChild(option);
  });

  if (snapshot.empty) {
    seedForm.hidden = true;
    showResult(
      "บัญชีนี้ยังไม่มีโครงการเลย — ไปสร้างโครงการที่หน้า projects.html ก่อน แล้วค่อยกลับมากดปุ่มนี้"
    );
    return;
  }

  seedForm.hidden = false;
  showResult("เลือกโครงการแล้วกดปุ่มเพื่อใส่ตัวอย่างงบประมาณ " + BUDGET_ITEM_EXAMPLES.length + " รายการ");
}

// ตรวจว่าชื่อหมวดของตัวอย่างมีอยู่จริงใน ruleItems ของแหล่งทุนที่โครงการนี้ผูกอยู่หรือไม่
// (แค่เตือน ไม่บล็อก — FS-01b ให้ผู้ใช้กรอกหมวดเองได้ แต่ถ้าชื่อไม่ตรงกับ ruleItem จะจับคู่ชั้นที่ 2 ไม่ได้)
async function findRuleItemCategoryNames(fundSourceId) {
  if (!fundSourceId) return [];

  var versionsSnapshot = await db.collection("fundSources").doc(fundSourceId)
    .collection("ruleVersions").get();

  var activeVersionId = null;
  versionsSnapshot.forEach(function (doc) {
    if (doc.data().isActive === true && !activeVersionId) activeVersionId = doc.id;
  });
  if (!activeVersionId && !versionsSnapshot.empty) activeVersionId = versionsSnapshot.docs[0].id;
  if (!activeVersionId) return [];

  var ruleItemsSnapshot = await db.collection("fundSources").doc(fundSourceId)
    .collection("ruleVersions").doc(activeVersionId)
    .collection("ruleItems").get();

  var categoryNames = [];
  ruleItemsSnapshot.forEach(function (doc) {
    var categoryName = doc.data().categoryName;
    if (categoryName) categoryNames.push(categoryName);
  });
  return categoryNames;
}

async function seedBudgetItems() {
  var projectId = projectSelect.value;
  if (!currentUser || !projectId) return;

  seedButton.disabled = true;
  showResult("กำลังใส่ข้อมูล…");

  try {
    var project = projectsById[projectId] || {};
    var knownCategoryNames = await findRuleItemCategoryNames(project.fundSourceId);

    var unmatchedCategoryNames = [];
    var projectRef = db.collection("users").doc(currentUser.uid)
      .collection("projects").doc(projectId);

    for (var example of BUDGET_ITEM_EXAMPLES) {
      var { docId, ...budgetItemFields } = example;
      if (knownCategoryNames.length && knownCategoryNames.indexOf(example.categoryName) === -1) {
        unmatchedCategoryNames.push(example.categoryName);
      }
      await projectRef.collection("budgetItems").doc(docId).set(Object.assign({}, budgetItemFields, {
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      }));
    }

    var existingSnapshot = await projectRef.collection("budgetItems").get();
    var lines = [];
    existingSnapshot.forEach(function (doc) {
      var item = doc.data();
      lines.push("  · " + doc.id + " — " + item.categoryName + " : " +
        Number(item.estimatedAmount).toLocaleString("th-TH") + " บาท (" + (item.unit || "-") + ")");
    });

    showResult(
      "✅ ใส่ตัวอย่างงบประมาณเสร็จแล้ว\n" +
      "path: users/" + currentUser.uid + "/projects/" + projectId + "/budgetItems\n" +
      "เขียนไป " + BUDGET_ITEM_EXAMPLES.length + " รายการ · ตอนนี้โครงการนี้มีทั้งหมด " +
      existingSnapshot.size + " รายการ\n\n" + lines.join("\n") +
      (unmatchedCategoryNames.length
        ? "\n\n⚠️ ชื่อหมวดต่อไปนี้ไม่ตรงกับ ruleItems ของแหล่งทุนที่โครงการนี้ผูกอยู่ (" +
          (project.fundSourceId || "ไม่ระบุแหล่งทุน") + ") — Rule Engine ชั้นที่ 2 จะจับคู่ไม่ได้: " +
          unmatchedCategoryNames.join(", ")
        : "") +
      "\n\nตรวจดูได้ที่หน้า project-budget.html ของโครงการนี้ หรือใน Firebase Console"
    );
  } catch (err) {
    showResult(
      "❌ ใส่ข้อมูลไม่สำเร็จ: " + err.message +
      "\n\n(budgetItems เขียนได้เฉพาะเจ้าของโครงการเท่านั้น — ตรวจว่าล็อกอินด้วยบัญชีเจ้าของโครงการนี้อยู่)"
    );
  } finally {
    seedButton.disabled = false;
  }
}

function showNotice(message) {
  signInNotice.textContent = message;
}

function showResult(message) {
  resultBox.textContent = message;
}
