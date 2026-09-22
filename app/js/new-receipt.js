// ─────────────────────────────────────────────────────────────
// js/new-receipt.js — อัปโหลดใบเสร็จใหม่ 2 ขั้นตอนหลัก (ตาม spec หัวข้อ 4/5):
//   ขั้นตอนที่ 1: เลือกโครงการ + แนบไฟล์ + ยินยอมความเป็นส่วนตัว + เชื่อมต่อ Google Drive
//                 (เช็ค FS-01b ก่อน: โครงการนี้ต้องมี budgetItems อย่างน้อย 1 รายการแล้ว)
//   ขั้นตอนที่ 2: (FS-02) AI อ่านผู้ขาย/วันที่/จำนวนเงิน/หมวด จากไฟล์แรกที่แนบ ให้ตรวจ/แก้ +
//                 ต่อไฟล์: เลือก documentTypeId (AI เดาให้เป็นค่าเริ่มต้น) + (FS-08) AI ดึง
//                 requiredFields ของเอกสารประเภทนั้นมาให้ตรวจ/แก้/ยืนยันก่อนปุ่มส่งตรวจจะกดได้
//   กดส่งตรวจ  → (FS-03) เรียก js/rule-engine.js (โค้ดล้วนๆ ตัดสินสถานะ) → บันทึกใบเสร็จ+ไฟล์ขึ้น
//                Google Drive → (FS-04) เรียก js/ai-explain.js อธิบายผล → ขั้นตอนที่ 3: แสดงผลตรวจ
// ─────────────────────────────────────────────────────────────

var MAX_FILES = 5;
var MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
var ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "pdf"];
var SAMPLE_VENDORS = [
  "ร้านถ่ายเอกสาร ABC", "ร้านเครื่องเขียนสยาม", "ร้านอาหารครัวคุณแม่",
  "บริษัท ทัวร์แอนด์แทรเวล จำกัด", "ร้านวัสดุก่อสร้าง ใจดี", "ร้านกาแฟดอยหลวง",
];

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function fileExtension(fileName) {
  return fileName.split(".").pop().toLowerCase();
}

(async function () {
  var projectSelect = document.getElementById("projectId");
  var categorySelect = document.getElementById("category");
  var fileInput = document.getElementById("receiptFiles");
  var warningBox = document.getElementById("warningBox");
  var fileStatusBox = document.getElementById("fileStatus");
  var privacyConsentCard = document.getElementById("privacyConsentCard");
  var privacyConsentCheckbox = document.getElementById("privacyConsentCheckbox");
  var noBudgetWarning = document.getElementById("noBudgetWarning");

  var stepEl = { 1: document.getElementById("step1"), 2: document.getElementById("step2"), 3: document.getElementById("step3") };
  var dotEl = { 1: document.getElementById("stepDot1"), 2: document.getElementById("stepDot2"), 3: document.getElementById("stepDot3") };

  function warn(message) {
    warningBox.textContent = "⚠️ " + message;
    warningBox.style.display = "block";
  }
  function clearWarning() {
    warningBox.style.display = "none";
  }
  function goToStep(n) {
    [1, 2, 3].forEach(function (i) {
      stepEl[i].hidden = i !== n;
      dotEl[i].classList.remove("is-current", "is-done");
      if (i < n) dotEl[i].classList.add("is-done");
      if (i === n) dotEl[i].classList.add("is-current");
    });
    window.scrollTo(0, 0);
  }

  var user = await window.AUTH_READY;

  // ยินยอมความเป็นส่วนตัวครั้งแรก (FS-02) — เก็บ timestamp เดียวบน users/{uid} ไม่ใช่ consent
  // record เต็มรูปแบบ (ดู spec หัวข้อ 7 "PDPA เบามาก")
  var userDoc = await db.collection("users").doc(user.uid).get();
  var privacyConsentAlreadyGiven = userDoc.exists && !!userDoc.data().privacyConsentAcceptedAt;
  if (!privacyConsentAlreadyGiven) privacyConsentCard.style.display = "block";

  // โครงการของผู้ใช้คนนี้ + fundSourceId ของแต่ละโครงการ (ใช้ตอนเรียก Rule Engine)
  var projectFundSourceId = {};
  var userProjects = await db.collection("users").doc(user.uid).collection("projects").get();
  if (userProjects.empty) {
    var noProjectOption = document.createElement("option");
    noProjectOption.value = "";
    noProjectOption.textContent = "ยังไม่มีโครงการวิจัย — ไปที่หน้า \"โครงการของฉัน\" ก่อน";
    noProjectOption.disabled = true;
    projectSelect.appendChild(noProjectOption);
  } else {
    userProjects.forEach(function (doc) {
      var option = document.createElement("option");
      option.value = doc.id;
      option.textContent = doc.data().projectName;
      projectSelect.appendChild(option);
      projectFundSourceId[doc.id] = doc.data().fundSourceId;
    });
  }

  var preselectProjectId = new URLSearchParams(location.search).get("projectId");
  if (preselectProjectId && projectFundSourceId.hasOwnProperty(preselectProjectId)) {
    projectSelect.value = preselectProjectId;
  }

  window.ALL_CATEGORIES.forEach(function (category) {
    var option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categorySelect.appendChild(option);
  });

  // ─── FS-01b gate: โครงการที่เลือกต้องมี budgetItems อย่างน้อย 1 รายการ ───
  async function projectHasBudgetItems(projectId) {
    var snap = await db.collection("users").doc(user.uid).collection("projects").doc(projectId)
      .collection("budgetItems").limit(1).get();
    return !snap.empty;
  }

  function nextReceiptId() {
    return db.collectionGroup("receipts").where("ownerUserId", "==", user.uid).get().then(function (snapshot) {
      var maxNumber = 0;
      snapshot.forEach(function (doc) {
        var m = doc.id.match(/^receipt(\d+)$/);
        if (m) maxNumber = Math.max(maxNumber, parseInt(m[1], 10));
      });
      return "receipt" + String(maxNumber + 1).padStart(3, "0");
    });
  }

  function validateFiles(files) {
    if (files.length > MAX_FILES) return "แนบไฟล์ได้สูงสุด " + MAX_FILES + " ไฟล์ต่อใบเสร็จ 1 รายการ (ตอนนี้เลือกไว้ " + files.length + " ไฟล์)";
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var ext = fileExtension(f.name);
      if (ALLOWED_EXTENSIONS.indexOf(ext) === -1) return "ไฟล์ \"" + f.name + "\" ไม่ใช่ชนิดที่รองรับ (รองรับเฉพาะ jpg/png/pdf)";
      if (f.size > MAX_FILE_SIZE_BYTES) return "ไฟล์ \"" + f.name + "\" มีขนาดเกิน 5 MB";
    }
    return null;
  }

  function randomAiData() {
    var category = window.ALL_CATEGORIES[Math.floor(Math.random() * (window.ALL_CATEGORIES.length - 1))]; // ไม่สุ่มหมวดสุดท้าย (ไม่มี ruleItem)
    var amount = Math.round((Math.random() * 4700 + 100) * 100) / 100;
    var daysAgo = Math.floor(Math.random() * 14);
    var date = new Date();
    date.setDate(date.getDate() - daysAgo);
    var vendor = SAMPLE_VENDORS[Math.floor(Math.random() * SAMPLE_VENDORS.length)];
    return { amount: amount, date: date.toISOString().slice(0, 10), category: category, vendorName: vendor };
  }

  var connectDriveButton = document.getElementById("connectDriveButton");
  var driveConnectStatus = document.getElementById("driveConnectStatus");
  function refreshDriveConnectStatus() {
    driveConnectStatus.textContent = window.googleDriveIsConnected() ? "✅ เชื่อมต่อแล้ว" : "";
  }
  refreshDriveConnectStatus();

  connectDriveButton.addEventListener("click", async function () {
    connectDriveButton.disabled = true;
    connectDriveButton.textContent = "กำลังเชื่อมต่อ...";
    try {
      await window.googleDriveConnect();
      refreshDriveConnectStatus();
    } catch (err) {
      driveConnectStatus.innerHTML = '<span style="color:var(--color-error);">⚠️ ' + esc(err.message) + '</span>';
    } finally {
      connectDriveButton.disabled = false;
      connectDriveButton.textContent = "เชื่อมต่อ Google Drive";
    }
  });

  fileInput.addEventListener("change", function () {
    var files = Array.from(fileInput.files);
    var error = files.length > 0 ? validateFiles(files) : null;
    if (error) {
      fileStatusBox.innerHTML = '<span style="color:var(--color-error);">⚠️ ' + error + '</span>';
    } else if (files.length > 0) {
      fileStatusBox.textContent = "เลือกไว้ " + files.length + " ไฟล์ (" + files.map(function (f) { return f.name; }).join(", ") + ")";
    } else {
      fileStatusBox.textContent = "";
    }
  });

  projectSelect.addEventListener("change", function () {
    noBudgetWarning.style.display = "none";
  });

  // ═══════════════════════════════════════════════════════════
  // ขั้นตอนที่ 1 → 2
  // ═══════════════════════════════════════════════════════════
  var fileStates = []; // [{file, documentTypeId, requiredFields, extractedFields, aiOriginalFields, confirmed, usedAiForFields}]
  var currentEvidence = { evidenceChainId: null, candidateDocTypes: [] }; // ของหมวดที่เลือกอยู่ตอนนี้

  document.getElementById("step1Button").addEventListener("click", async function () {
    clearWarning();
    noBudgetWarning.style.display = "none";

    if (!privacyConsentAlreadyGiven && !privacyConsentCheckbox.checked) {
      warn("กรุณายอมรับเงื่อนไขเรื่องความเป็นส่วนตัวก่อนอัปโหลดใบเสร็จ");
      return;
    }
    if (!projectSelect.value) {
      warn("กรุณาเลือกโครงการวิจัยก่อน");
      return;
    }
    var files = Array.from(fileInput.files);
    var fileError = files.length > 0 ? validateFiles(files) : null;
    if (fileError) {
      warn(fileError);
      return;
    }

    var step1Button = document.getElementById("step1Button");
    step1Button.disabled = true;
    step1Button.textContent = "กำลังตรวจสอบงบประมาณโครงการ...";
    var hasBudget;
    try {
      hasBudget = await projectHasBudgetItems(projectSelect.value);
    } catch (err) {
      warn("ตรวจสอบงบประมาณโครงการไม่สำเร็จ: " + err.message);
      step1Button.disabled = false;
      step1Button.textContent = "อัปโหลดและอ่านข้อมูลด้วย AI";
      return;
    }
    step1Button.disabled = false;
    step1Button.textContent = "อัปโหลดและอ่านข้อมูลด้วย AI";

    if (!hasBudget) {
      noBudgetWarning.innerHTML =
        '⚠️ โครงการนี้ยังไม่มีรายการงบประมาณ (budgetItems) เลย — ต้องกรอกงบประมาณก่อนถึงจะอัปโหลด' +
        'ใบเสร็จเข้าโครงการนี้ได้ <a href="project-budget.html?projectId=' + esc(projectSelect.value) + '">ไปกรอกงบประมาณตอนนี้</a>';
      noBudgetWarning.style.display = "block";
      return;
    }

    if (!privacyConsentAlreadyGiven) {
      privacyConsentAlreadyGiven = true;
      privacyConsentCard.style.display = "none";
      await db.collection("users").doc(user.uid).set(
        { privacyConsentAcceptedAt: firebase.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    goToStep(2);
    document.getElementById("aiProcessing").hidden = false;
    document.getElementById("reviewForm").hidden = true;

    // FS-02: ไฟล์รูปภาพ (jpg/png) ส่งให้ AI จริงอ่านได้ตรงๆ — ไฟล์ pdf ต้องแปลงเป็นรูปภาพก่อน
    var imageFile = files.filter(function (f) { var ext = fileExtension(f.name); return ext === "jpg" || ext === "jpeg" || ext === "png"; })[0];
    var pdfFile = !imageFile && files.filter(function (f) { return fileExtension(f.name) === "pdf"; })[0];
    var aiSourceFile = imageFile || pdfFile;

    var aiData;
    var aiModeNote;
    var usedRealAi = false;
    if (aiSourceFile && window.OPENROUTER_API_KEY) {
      try {
        var fileForAi = imageFile || await window.convertPdfFirstPageToImageFile(pdfFile);
        aiData = await window.analyzeReceiptWithAI(fileForAi, window.ALL_CATEGORIES);
        aiModeNote = "อ่านด้วย AI จริง (OpenRouter) จากไฟล์ " + aiSourceFile.name;
        usedRealAi = true;
      } catch (err) {
        warn("AI อ่านใบเสร็จไม่สำเร็จ (" + err.message + ") — ใช้ข้อมูลตัวอย่างแทนชั่วคราว");
        aiData = randomAiData();
        aiModeNote = "AI อ่านไม่สำเร็จ — ใช้ข้อมูลตัวอย่างแทน";
      }
    } else {
      aiData = randomAiData();
      aiModeNote = aiSourceFile
        ? "ยังไม่ได้ตั้งค่า OpenRouter API key — ใช้ข้อมูลตัวอย่างแทน (ดู js/ai-config.example.js)"
        : "ไม่ได้แนบไฟล์ — ใช้ข้อมูลตัวอย่างแทน (โหมดสาธิต)";
    }

    document.getElementById("aiSuggestionLabel").style.display = usedRealAi ? "block" : "none";
    document.getElementById("amount").value = aiData.amount;
    document.getElementById("date").value = aiData.date;
    categorySelect.value = aiData.category;
    document.getElementById("vendorName").value = aiData.vendorName;

    var fileNameText = files.length > 0
      ? files.map(function (f) { return f.name; }).join(", ") + " — " + aiModeNote
      : aiModeNote;
    document.getElementById("fileNameDisplay").textContent = fileNameText;

    // เตรียม fileStates ต่อไฟล์ที่แนบ — ต้องรู้ evidenceChain ของหมวดที่ AI/ผู้ใช้เลือกก่อน ถึงจะรู้
    // ตัวเลือก documentTypeId ที่จำกัดไว้ (FS-02)
    fileStates = files.map(function (f) {
      return { file: f, documentTypeId: null, requiredFields: null, extractedFields: {}, aiOriginalFields: {}, confirmed: true, usedAiForFields: false };
    });

    await refreshEvidenceChainForCategory(categorySelect.value);
    await renderFileCards();

    document.getElementById("aiProcessing").hidden = true;
    document.getElementById("reviewForm").hidden = false;
    recomputeSubmitEnabled();
  });

  categorySelect.addEventListener("change", async function () {
    await refreshEvidenceChainForCategory(categorySelect.value);
    await renderFileCards();
    recomputeSubmitEnabled();
  });

  // หา evidenceChainId ของ ruleItem ที่ตรงกับหมวดนี้ในแหล่งทุนของโครงการที่เลือก + รายชื่อ
  // documentTypeIds ที่ปรากฏใน steps/conditionalSteps ของ evidence chain นั้น (FS-02: จำกัดตัวเลือก
  // ไม่ใช่ทั้ง 16+ ชนิดในระบบ) ถ้าหมวดนี้ไม่มี evidence chain ผูกอยู่เลย ให้ข้าม (candidateDocTypes ว่าง)
  async function refreshEvidenceChainForCategory(category) {
    currentEvidence = { evidenceChainId: null, candidateDocTypes: [] };
    var fundSourceId = projectFundSourceId[projectSelect.value];
    if (!fundSourceId || !category) return;

    try {
      var ruleVersionsSnap = await db.collection("fundSources").doc(fundSourceId)
        .collection("ruleVersions").where("isActive", "==", true).limit(1).get();
      if (ruleVersionsSnap.empty) return;
      var ruleItemsSnap = await ruleVersionsSnap.docs[0].ref.collection("ruleItems")
        .where("categoryName", "==", category).limit(1).get();
      if (ruleItemsSnap.empty) return;
      var evidenceChainId = ruleItemsSnap.docs[0].data().evidenceChainId;
      if (!evidenceChainId) return;

      var chainDoc = await db.collection("evidenceChains").doc(evidenceChainId).get();
      if (!chainDoc.exists) return;
      var chain = chainDoc.data();
      var docTypeIds = [];
      (chain.steps || []).forEach(function (s) { (s.documentTypeIds || []).forEach(function (id) { if (docTypeIds.indexOf(id) === -1) docTypeIds.push(id); }); });
      (chain.conditionalSteps || []).forEach(function (cs) { ((cs.addStep && cs.addStep.documentTypeIds) || []).forEach(function (id) { if (docTypeIds.indexOf(id) === -1) docTypeIds.push(id); }); });

      var candidateDocTypes = [];
      for (var i = 0; i < docTypeIds.length; i++) {
        var d = await db.collection("documentTypes").doc(docTypeIds[i]).get();
        if (d.exists) candidateDocTypes.push(Object.assign({ id: d.id }, d.data()));
      }
      currentEvidence = { evidenceChainId: evidenceChainId, candidateDocTypes: candidateDocTypes };
    } catch (err) {
      console.warn("โหลด evidence chain ของหมวดนี้ไม่สำเร็จ:", err);
    }
  }

  var fileCardsContainer = document.getElementById("fileCardsContainer");

  async function renderFileCards() {
    fileCardsContainer.innerHTML = "";
    if (fileStates.length === 0) return;

    if (currentEvidence.candidateDocTypes.length === 0) {
      // หมวดนี้ไม่มี evidence chain ผูกอยู่ — ข้ามขั้นตอนเลือกชนิดเอกสาร/ดึงข้อมูลทั้งหมด
      fileStates.forEach(function (fs) { fs.documentTypeId = null; fs.requiredFields = null; fs.confirmed = true; });
      fileCardsContainer.innerHTML = '<p class="text-small">หมวดนี้ไม่มีชุดเอกสารประกอบ (evidence chain) กำหนดไว้ — ไม่ต้องระบุประเภทเอกสารต่อไฟล์</p>';
      return;
    }

    for (var i = 0; i < fileStates.length; i++) {
      renderOneFileCard(i);
    }
    // เดางานชนิดเอกสารด้วย AI เป็นค่าเริ่มต้น (ถ้ามีคีย์) — ทำหลังเรนเดอร์ dropdown ไว้แล้วทุกใบ
    for (var j = 0; j < fileStates.length; j++) {
      await guessAndApplyDocumentType(j);
    }
  }

  function fileCardId(i) { return "fileCard-" + i; }

  function renderOneFileCard(i) {
    var fs = fileStates[i];
    var options = '<option value="">— เลือกประเภทเอกสาร —</option>' +
      currentEvidence.candidateDocTypes.map(function (d) {
        return '<option value="' + esc(d.id) + '">' + esc(d.documentName) + (d.formCode && d.formCode !== "-" ? " (" + esc(d.formCode) + ")" : "") + '</option>';
      }).join("");

    var card = document.createElement("div");
    card.className = "file-doc-card";
    card.id = fileCardId(i);
    card.innerHTML =
      '<div class="file-doc-card__name">📎 ' + esc(fs.file.name) + '</div>' +
      '<div class="field">' +
        '<label>ประเภทเอกสาร (จำกัดเฉพาะชนิดที่กฎของหมวดนี้กำหนด)</label>' +
        '<select class="file-doctype-select" data-file-index="' + i + '">' + options + '</select>' +
      '</div>' +
      '<div class="file-fields-area" data-file-index="' + i + '"></div>';
    fileCardsContainer.appendChild(card);

    card.querySelector(".file-doctype-select").addEventListener("change", async function (e) {
      var idx = parseInt(e.target.dataset.fileIndex, 10);
      fileStates[idx].documentTypeId = e.target.value || null;
      await handleDocumentTypeChosen(idx);
      recomputeSubmitEnabled();
    });
  }

  async function guessAndApplyDocumentType(i) {
    var fs = fileStates[i];
    var select = document.querySelector('.file-doctype-select[data-file-index="' + i + '"]');
    if (!select) return;

    if (window.OPENROUTER_API_KEY) {
      try {
        var ext = fileExtension(fs.file.name);
        var imageForGuess = fs.file;
        if (ext === "pdf") imageForGuess = await window.convertPdfFirstPageToImageFile(fs.file);
        var guessedId = await window.guessDocumentTypeWithAI(imageForGuess, currentEvidence.candidateDocTypes);
        if (guessedId) {
          select.value = guessedId;
          fs.documentTypeId = guessedId;
        }
      } catch (err) {
        console.warn("เดาประเภทเอกสารด้วย AI ไม่สำเร็จ (ไฟล์ " + fs.file.name + "):", err);
      }
    }
    await handleDocumentTypeChosen(i);
  }

  // FS-08: หลังเลือก documentTypeId ให้ไฟล์นี้แล้ว — ถ้า documentType มี requiredFields ไม่ว่าง
  // ให้ดึงข้อมูล (AI หรือช่องว่างให้กรอกเอง) มาแสดงเป็นฟอร์มที่แก้ไขได้ + ต้องกดยืนยันก่อนส่งตรวจได้
  async function handleDocumentTypeChosen(i) {
    var fs = fileStates[i];
    var area = document.querySelector('.file-fields-area[data-file-index="' + i + '"]');
    if (!area) return;

    if (!fs.documentTypeId) {
      fs.requiredFields = null;
      fs.confirmed = false;
      area.innerHTML = "";
      return;
    }

    var docType = currentEvidence.candidateDocTypes.filter(function (d) { return d.id === fs.documentTypeId; })[0];
    var requiredFields = (docType && docType.requiredFields) || [];
    fs.requiredFields = requiredFields;

    if (requiredFields.length === 0) {
      fs.confirmed = true;
      area.innerHTML = '<p class="text-small">เอกสารประเภทนี้ไม่มี field ที่ต้องดึง/ตรวจเพิ่มเติม</p>';
      return;
    }

    fs.confirmed = false;
    area.innerHTML = '<p class="text-small">🤖 กำลังดึงข้อมูลจากไฟล์...</p>';

    var extracted = {};
    fs.usedAiForFields = false;
    if (window.OPENROUTER_API_KEY) {
      try {
        var ext = fileExtension(fs.file.name);
        var imageForExtract = fs.file;
        if (ext === "pdf") imageForExtract = await window.convertPdfFirstPageToImageFile(fs.file);
        extracted = await window.extractDocumentFieldsWithAI(imageForExtract, requiredFields);
        fs.usedAiForFields = true;
      } catch (err) {
        console.warn("ดึงข้อมูลเอกสารด้วย AI ไม่สำเร็จ (ไฟล์ " + fs.file.name + "):", err);
        requiredFields.forEach(function (name) { extracted[name] = ""; });
      }
    } else {
      requiredFields.forEach(function (name) { extracted[name] = ""; });
    }

    fs.aiOriginalFields = Object.assign({}, extracted);
    fs.extractedFields = Object.assign({}, extracted);

    renderFieldsForm(i, requiredFields, area);
  }

  function renderFieldsForm(i, requiredFields, area) {
    var fs = fileStates[i];
    var rowsHtml = requiredFields.map(function (fieldName, fieldIndex) {
      var value = fs.extractedFields[fieldName] || "";
      return (
        '<div class="extracted-field-row">' +
          '<div class="extracted-field-row__label">' + esc(fieldName) + '</div>' +
          '<input type="text" class="extracted-field-row__input extracted-field-input" ' +
            'data-file-index="' + i + '" data-field-name="' + esc(fieldName) + '" value="' + esc(value) + '">' +
        '</div>'
      );
    }).join("");

    area.innerHTML =
      (fs.usedAiForFields
        ? '<p class="text-small">🤖 AI ดึงข้อมูลให้แล้ว — ตรวจสอบ/แก้ไขให้ถูกต้องก่อนยืนยัน (field ที่ AI ไม่พบจะว่างไว้ให้กรอกเอง)</p>'
        : '<p class="text-small">ยังไม่มี AI อ่านให้ (ไม่มีคีย์ หรือ AI ไม่สำเร็จ) — กรุณากรอกข้อมูลจากเอกสารด้วยตัวเอง</p>') +
      rowsHtml +
      '<label class="row row-align-center" style="gap:6px; margin-top:6px; cursor:pointer;">' +
        '<input type="checkbox" class="confirm-fields-checkbox" data-file-index="' + i + '">' +
        '<span class="text-small">ฉันตรวจสอบข้อมูลด้านบนแล้วและยืนยันว่าถูกต้อง</span>' +
      '</label>';

    area.querySelectorAll(".extracted-field-input").forEach(function (input) {
      input.addEventListener("input", function (e) {
        var idx = parseInt(e.target.dataset.fileIndex, 10);
        var fieldName = e.target.dataset.fieldName;
        fileStates[idx].extractedFields[fieldName] = e.target.value;
      });
    });
    area.querySelector(".confirm-fields-checkbox").addEventListener("change", function (e) {
      var idx = parseInt(e.target.dataset.fileIndex, 10);
      fileStates[idx].confirmed = e.target.checked;
      recomputeSubmitEnabled();
    });
  }

  function recomputeSubmitEnabled() {
    var step2Button = document.getElementById("step2Button");
    var amountOk = parseFloat(document.getElementById("amount").value) > 0;
    var dateOk = !!document.getElementById("date").value;
    var categoryOk = !!categorySelect.value;
    var allFilesReady = fileStates.every(function (fs) {
      if (currentEvidence.candidateDocTypes.length === 0) return true; // ไม่มี evidence chain ให้เลือก
      if (!fs.documentTypeId) return false; // ต้องเลือกประเภทเอกสารก่อน
      return fs.confirmed === true;
    });
    step2Button.disabled = !(amountOk && dateOk && categoryOk && allFilesReady);
  }
  document.getElementById("amount").addEventListener("input", recomputeSubmitEnabled);
  document.getElementById("date").addEventListener("input", recomputeSubmitEnabled);

  // ─── ขั้นตอนที่ 2 → 1 (ย้อนกลับ) ───
  document.getElementById("backToStep1Button").addEventListener("click", function () {
    clearWarning();
    goToStep(1);
  });

  // ═══════════════════════════════════════════════════════════
  // ขั้นตอนที่ 2 → 3 (ส่งเข้าตรวจ)
  // ═══════════════════════════════════════════════════════════
  document.getElementById("step2Button").addEventListener("click", async function () {
    clearWarning();

    var values = {
      projectId: projectSelect.value,
      amount: parseFloat(document.getElementById("amount").value),
      date: document.getElementById("date").value,
      category: categorySelect.value,
      vendorName: document.getElementById("vendorName").value.trim(),
    };

    if (!values.projectId || !values.amount || !values.date || !values.category) {
      warn("กรอกไม่ครบ — ต้องมียอดเงิน วันที่ และหมวดค่าใช้จ่ายก่อนส่งตรวจ");
      return;
    }

    if (fileStates.length > 0 && !window.googleDriveIsConnected()) {
      warn('มีไฟล์แนบแต่ยังไม่ได้เชื่อมต่อ Google Drive (หรือหมดอายุแล้ว) — กดปุ่ม "เชื่อมต่อ Google Drive" ในขั้นตอนที่ 1 ก่อนแล้วลองอีกครั้ง');
      return;
    }

    var step2Button = document.getElementById("step2Button");
    step2Button.disabled = true;
    try {
      var projectRef = db.collection("users").doc(user.uid).collection("projects").doc(values.projectId);

      step2Button.textContent = "กำลังตรวจสอบตามกฎ 4 ชั้น (Rule Engine)...";
      var ruleEngineFiles = fileStates.map(function (fs) {
        return { documentTypeId: fs.documentTypeId, extractedFields: fs.extractedFields };
      });
      var ruleEngineResult = await window.runRuleEngine({
        fundSourceId: projectFundSourceId[values.projectId],
        projectRef: projectRef,
        category: values.category,
        amount: values.amount,
        files: ruleEngineFiles,
      });

      step2Button.textContent = "กำลังบันทึกข้อมูลใบเสร็จ...";
      var newReceiptId = await nextReceiptId();
      var receiptRef = projectRef.collection("receipts").doc(newReceiptId);

      await receiptRef.set({
        ownerUserId: user.uid,
        category: values.category,
        amount: values.amount,
        vendorName: values.vendorName,
        date: values.date,
        status: ruleEngineResult.status,
        aiExplanation: "", // เติมทีหลังจาก FS-04 ด้านล่าง (เขียนก่อนเพื่อให้เอกสารมีอยู่ตอนอัปโหลดไฟล์)
        evidenceChainId: ruleEngineResult.evidenceChainId || null,
        fileReference: null,
        uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      var firstFileReference = null;
      for (var i = 0; i < fileStates.length; i++) {
        var fs = fileStates[i];
        step2Button.textContent = "กำลังอัปโหลดไฟล์ขึ้น Google Drive " + (i + 1) + "/" + fileStates.length + "...";
        var driveFile = await window.googleDriveUploadReceiptFile(fs.file, receiptRef.id);
        if (i === 0) firstFileReference = driveFile.webViewLink;

        await receiptRef.collection("files").add({
          fileReference: driveFile.webViewLink,
          documentTypeId: fs.documentTypeId || null,
          extractedFields: fs.extractedFields || {},
          extractedFieldsWasAi: !!fs.usedAiForFields,
          originalFileName: fs.file.name,
          sortOrder: i + 1,
          uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        // FS-08: บันทึก audit trail แยกจาก log ของ FS-04 — ใช้ AI ดึงสำเร็จไหม, ผู้ใช้แก้ค่าที่ AI
        // ดึงมาไหม (wasEdited ต่อ field)
        if (fs.requiredFields && fs.requiredFields.length > 0) {
          var fieldLogs = fs.requiredFields.map(function (fieldName) {
            return {
              fieldName: fieldName,
              aiValue: fs.aiOriginalFields[fieldName] || "",
              finalValue: fs.extractedFields[fieldName] || "",
              wasEdited: (fs.aiOriginalFields[fieldName] || "") !== (fs.extractedFields[fieldName] || ""),
            };
          });
          await receiptRef.collection("agentLogs").add({
            kind: "extraction",
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            fileIndex: i,
            originalFileName: fs.file.name,
            documentTypeId: fs.documentTypeId,
            usedAi: !!fs.usedAiForFields,
            model: fs.usedAiForFields ? "google/gemini-2.5-flash-lite" : null,
            fields: fieldLogs,
          });
        }
      }

      if (firstFileReference) {
        await receiptRef.update({ fileReference: firstFileReference });
      }

      // FS-04: AI อธิบายผลตรวจ (agentic) + fallback ถ้าไม่มี AI/AI ล้มเหลว — เขียน agentLogs เอง
      var finalExplanation;
      try {
        step2Button.textContent = "กำลังให้ AI อธิบายผลตรวจ...";
        finalExplanation = await window.runAiExplain({
          receiptRef: receiptRef,
          evidenceChainId: ruleEngineResult.evidenceChainId,
          category: values.category,
          amount: values.amount,
          ruleEngineResult: ruleEngineResult,
        });
      } catch (explainErr) {
        console.warn("AI อธิบายผลตรวจไม่สำเร็จ:", explainErr);
        finalExplanation = "สถานะ: " + ruleEngineResult.status + " (ไม่สามารถสร้างคำอธิบายเพิ่มเติมได้)";
      }
      await receiptRef.update({ aiExplanation: finalExplanation });

      var projectName = projectSelect.options[projectSelect.selectedIndex].textContent;
      showCheckResult(values, { status: ruleEngineResult.status, aiExplanation: finalExplanation }, projectName);
      goToStep(3);
    } catch (err) {
      warn("บันทึกไม่สำเร็จ: " + err.message + " (เช็ค Firestore Rules หรือการเชื่อมต่อ Google Drive ว่าเปิดให้เขียนได้หรือยัง)");
    } finally {
      step2Button.disabled = false;
      step2Button.textContent = "ส่งเข้าตรวจกับ Rule Engine";
    }
  });

  var STATUS_CHIP_CLASS = { "ผ่าน": "chip-status--pass", "ต้องแก้ไข": "chip-status--fix", "ไม่เข้าเงื่อนไข": "chip-status--reject" };
  var STATUS_CALLOUT_KIND = { "ผ่าน": "pass", "ต้องแก้ไข": "fix", "ไม่เข้าเงื่อนไข": "reject" };

  function formatCurrency(amount) {
    if (typeof amount !== "number") return "-";
    return "฿" + amount.toLocaleString("th-TH", { minimumFractionDigits: 2 });
  }

  function showCheckResult(values, checkResult, projectName) {
    var chipClass = STATUS_CHIP_CLASS[checkResult.status] || "chip-status--pending";
    var calloutKind = STATUS_CALLOUT_KIND[checkResult.status] || "reject";

    document.getElementById("checkResult").innerHTML =
      '<div class="receipt-entry">' +
        '<div class="receipt-card">' +
          '<div class="receipt-card__thumb">🧾</div>' +
          '<div class="receipt-card__body">' +
            '<div class="receipt-card__amount">' + esc(formatCurrency(values.amount)) + '</div>' +
            '<div class="receipt-card__meta">' + esc(projectName) + ' · ' + esc(values.date) + ' · ' + esc(values.category) + ' · ' + esc(values.vendorName) + '</div>' +
          '</div>' +
          '<div class="receipt-card__status"><span class="chip-status ' + chipClass + '">' + esc(checkResult.status) + '</span></div>' +
        '</div>' +
        '<div class="rule-callout rule-callout--' + calloutKind + '">' +
          '<p class="rule-callout__explain">' + esc(checkResult.aiExplanation) + '</p>' +
        '</div>' +
      '</div>';
  }

  // ─── ขั้นตอนที่ 3 → เริ่มใหม่ ───
  document.getElementById("uploadAgainButton").addEventListener("click", function () {
    clearWarning();
    projectSelect.value = "";
    fileInput.value = "";
    fileStatusBox.textContent = "";
    fileStates = [];
    fileCardsContainer.innerHTML = "";
    document.getElementById("amount").value = "";
    document.getElementById("date").value = "";
    document.getElementById("vendorName").value = "";
    goToStep(1);
  });
})();
