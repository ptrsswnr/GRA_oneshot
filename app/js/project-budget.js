// ─────────────────────────────────────────────────────────────
// js/project-budget.js — FS-01b: กรอก/แก้/ลบรายการประมาณการค่าใช้จ่าย (budgetItems) ของโครงการ
// หนึ่งโครงการ (users/{uid}/projects/{projectId}/budgetItems) — บังคับต้องมีอย่างน้อย 1 รายการ
// ก่อนอัปโหลดใบเสร็จเข้าโครงการนั้นได้ (เช็คจริงที่ new-receipt.js อีกที หน้านี้แค่เตือน/ให้กรอก)
//
// กรอกได้ 2 ทาง: (ก) กรอกมือทีละแถวในตาราง (ข) แนบไฟล์รูป/PDF ให้ AI เสนอรายการมาให้ก่อน — ทั้งสองทาง
// นักวิจัยต้องตรวจ/แก้ค่าในตาราง "ก่อน" กดบันทึกเสมอ (AI ไม่เขียนตรงลง Firestore ให้)
// ─────────────────────────────────────────────────────────────

(async function () {
  var pageIntro = document.getElementById("pageIntro");
  var warningBox = document.getElementById("warningBox");
  var loadState = document.getElementById("load-state");
  var budgetTableBody = document.getElementById("budgetTableBody");
  var noBudgetBanner = document.getElementById("noBudgetBanner");

  var categorySelect = document.getElementById("newCategoryName");
  var amountInput = document.getElementById("newEstimatedAmount");
  var unitInput = document.getElementById("newUnit");
  var noteInput = document.getElementById("newNote");
  var addButton = document.getElementById("addBudgetItemButton");

  var aiFileInput = document.getElementById("budgetAiFile");
  var aiAnalyzeButton = document.getElementById("budgetAiAnalyzeButton");
  var aiStatus = document.getElementById("budgetAiStatus");
  var aiStagingSection = document.getElementById("aiStagingSection");
  var aiStagingBody = document.getElementById("aiStagingBody");
  var aiSaveSelectedButton = document.getElementById("aiSaveSelectedButton");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function warn(message) {
    warningBox.textContent = "⚠️ " + message;
    warningBox.style.display = "block";
  }
  function clearWarning() {
    warningBox.style.display = "none";
  }
  function formatCurrency(amount) {
    if (typeof amount !== "number") return "-";
    return "฿" + amount.toLocaleString("th-TH", { minimumFractionDigits: 2 });
  }

  window.ALL_CATEGORIES.forEach(function (name) {
    var option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    categorySelect.appendChild(option);
  });

  var user = await window.AUTH_READY;
  var projectId = new URLSearchParams(location.search).get("projectId");

  if (!projectId) {
    loadState.innerHTML = '<div class="banner banner--error"><p class="text-body">ไม่พบ projectId ใน URL — กลับไปที่ <a href="projects.html">โครงการของฉัน</a> แล้วเลือกโครงการก่อน</p></div>';
    return;
  }

  var projectRef = db.collection("users").doc(user.uid).collection("projects").doc(projectId);
  var projectDoc = await projectRef.get();
  if (!projectDoc.exists) {
    loadState.innerHTML = '<div class="banner banner--error"><p class="text-body">ไม่พบโครงการนี้ (หรือไม่ใช่โครงการของบัญชีนี้) — กลับไปที่ <a href="projects.html">โครงการของฉัน</a></p></div>';
    return;
  }
  var project = projectDoc.data();
  pageIntro.innerHTML =
    '<h1>งบประมาณโครงการ: ' + esc(project.projectName) + '</h1>' +
    '<p class="text-body">' +
      '<a href="projects.html">← กลับไปโครงการของฉัน</a> · ' +
      '<a href="new-receipt.html?projectId=' + esc(projectId) + '" class="btn btn-primary btn-sm">อัปโหลดใบเสร็จในโครงการนี้</a>' +
    '</p>';

  function budgetRowHtml(id, item) {
    return (
      '<tr data-budget-id="' + esc(id) + '">' +
        '<td>' + esc(item.categoryName) + '</td>' +
        '<td class="text-mono">' + esc(formatCurrency(item.estimatedAmount)) + '</td>' +
        '<td>' + esc(item.unit || "-") + '</td>' +
        '<td class="text-small">' + esc(item.note || "-") + '</td>' +
        '<td><button type="button" class="btn btn-ghost btn-sm" data-action="delete-budget-item">ลบ</button></td>' +
      '</tr>'
    );
  }

  async function loadBudgetItems() {
    var snapshot = await projectRef.collection("budgetItems").get();
    if (snapshot.empty) {
      budgetTableBody.innerHTML = "";
      noBudgetBanner.style.display = "block";
    } else {
      budgetTableBody.innerHTML = snapshot.docs.map(function (doc) { return budgetRowHtml(doc.id, doc.data()); }).join("");
      noBudgetBanner.style.display = "none";
    }
    loadState.style.display = "none";
    return snapshot.docs;
  }

  try {
    await loadBudgetItems();
  } catch (err) {
    loadState.innerHTML = '<div class="banner banner--error"><p class="text-body"><strong>โหลดข้อมูลไม่สำเร็จ:</strong> ' + esc(err.message) + '</p></div>';
    return;
  }

  budgetTableBody.addEventListener("click", async function (e) {
    var button = e.target.closest('button[data-action="delete-budget-item"]');
    if (!button) return;
    var row = button.closest("[data-budget-id]");
    var id = row.dataset.budgetId;
    if (!confirm("ลบรายการงบประมาณนี้?")) return;
    button.disabled = true;
    try {
      await projectRef.collection("budgetItems").doc(id).delete();
      await loadBudgetItems();
    } catch (err) {
      warn("ลบไม่สำเร็จ: " + err.message);
      button.disabled = false;
    }
  });

  // ─── (ก) กรอกมือทีละแถว ───
  addButton.addEventListener("click", async function () {
    clearWarning();
    var categoryName = categorySelect.value;
    var estimatedAmount = parseFloat(amountInput.value);
    var unit = unitInput.value.trim();
    var note = noteInput.value.trim();

    if (!categoryName) { warn("กรุณาเลือกหมวดค่าใช้จ่าย"); return; }
    if (isNaN(estimatedAmount) || estimatedAmount <= 0) { warn("กรุณากรอกจำนวนเงินประมาณการให้ถูกต้อง"); return; }

    addButton.disabled = true;
    addButton.textContent = "กำลังบันทึก...";
    try {
      await projectRef.collection("budgetItems").add({
        categoryName: categoryName,
        estimatedAmount: estimatedAmount,
        unit: unit,
        note: note,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      amountInput.value = "";
      unitInput.value = "";
      noteInput.value = "";
      await loadBudgetItems();
    } catch (err) {
      warn("บันทึกไม่สำเร็จ: " + err.message);
    } finally {
      addButton.disabled = false;
      addButton.textContent = "เพิ่มรายการ";
    }
  });

  // ─── (ข) แนบไฟล์ให้ AI เสนอรายการ ───
  var stagingItems = [];

  function fileExtension(fileName) {
    return fileName.split(".").pop().toLowerCase();
  }

  function stagingRowHtml(index, item) {
    var options = window.ALL_CATEGORIES.map(function (name) {
      return '<option value="' + esc(name) + '"' + (name === item.categoryName ? " selected" : "") + '>' + esc(name) + '</option>';
    }).join("");
    return (
      '<tr data-staging-index="' + index + '">' +
        '<td><input type="checkbox" class="staging-include" checked></td>' +
        '<td><select class="staging-category">' + options + '</select></td>' +
        '<td><input type="number" class="staging-amount input-mono" value="' + esc(item.estimatedAmount) + '"></td>' +
        '<td><input type="text" class="staging-unit" value="' + esc(item.unit) + '"></td>' +
        '<td><input type="text" class="staging-note" value="' + esc(item.note) + '"></td>' +
      '</tr>'
    );
  }

  function renderStaging() {
    aiStagingBody.innerHTML = stagingItems.map(function (item, i) { return stagingRowHtml(i, item); }).join("");
    aiStagingSection.style.display = stagingItems.length > 0 ? "block" : "none";
  }

  aiAnalyzeButton.addEventListener("click", async function () {
    clearWarning();
    var file = aiFileInput.files[0];
    if (!file) { warn("กรุณาเลือกไฟล์รูป/PDF ของประมาณการงบประมาณก่อน"); return; }
    if (!window.OPENROUTER_API_KEY) {
      warn("ยังไม่ได้ตั้งค่า OpenRouter API key (js/ai-config.local.js) — ใช้วิธีกรอกมือด้านบนแทนได้เลย");
      return;
    }

    aiAnalyzeButton.disabled = true;
    aiStatus.textContent = "🤖 กำลังให้ AI อ่านไฟล์...";
    try {
      var ext = fileExtension(file.name);
      var imageFile = file;
      if (ext === "pdf") {
        imageFile = await window.convertPdfFirstPageToImageFile(file);
      } else if (["jpg", "jpeg", "png"].indexOf(ext) === -1) {
        throw new Error("รองรับเฉพาะไฟล์ .jpg, .png, .pdf");
      }
      var candidates = await window.analyzeBudgetEstimateWithAI(imageFile, window.ALL_CATEGORIES);
      if (candidates.length === 0) {
        aiStatus.textContent = "AI ไม่พบรายการที่จับคู่กับหมวดในระบบได้เลย — ลองกรอกมือแทน";
      } else {
        stagingItems = candidates;
        renderStaging();
        aiStatus.textContent = "🤖 AI เสนอ " + candidates.length + " รายการ — ตรวจ/แก้ไขค่าด้านล่างก่อนกดบันทึก (AI ไม่ได้บันทึกให้ตรงๆ)";
      }
    } catch (err) {
      aiStatus.textContent = "⚠️ AI อ่านไฟล์ไม่สำเร็จ (" + err.message + ") — ลองกรอกมือแทน";
    } finally {
      aiAnalyzeButton.disabled = false;
    }
  });

  aiSaveSelectedButton.addEventListener("click", async function () {
    clearWarning();
    var rows = Array.from(aiStagingBody.querySelectorAll("tr"));
    var toSave = [];
    rows.forEach(function (row) {
      if (!row.querySelector(".staging-include").checked) return;
      var estimatedAmount = parseFloat(row.querySelector(".staging-amount").value);
      if (isNaN(estimatedAmount) || estimatedAmount <= 0) return;
      toSave.push({
        categoryName: row.querySelector(".staging-category").value,
        estimatedAmount: estimatedAmount,
        unit: row.querySelector(".staging-unit").value.trim(),
        note: row.querySelector(".staging-note").value.trim(),
      });
    });

    if (toSave.length === 0) {
      warn("ไม่มีรายการที่เลือกไว้ (หรือจำนวนเงินไม่ถูกต้อง)");
      return;
    }

    aiSaveSelectedButton.disabled = true;
    aiSaveSelectedButton.textContent = "กำลังบันทึก...";
    try {
      for (var i = 0; i < toSave.length; i++) {
        await projectRef.collection("budgetItems").add(Object.assign({}, toSave[i], {
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }));
      }
      stagingItems = [];
      renderStaging();
      aiStatus.textContent = "";
      aiFileInput.value = "";
      await loadBudgetItems();
    } catch (err) {
      warn("บันทึกไม่สำเร็จ: " + err.message);
    } finally {
      aiSaveSelectedButton.disabled = false;
      aiSaveSelectedButton.textContent = "บันทึกรายการที่เลือกลงงบประมาณ";
    }
  });
})();
