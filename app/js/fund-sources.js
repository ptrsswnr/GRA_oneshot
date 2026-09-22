// ─────────────────────────────────────────────────────────────
// js/fund-sources.js — FS-06: หน้า "จัดการแหล่งทุน" สำหรับ admin เท่านั้น
// ไม่มีระบบ role/custom-claim จริง — เช็คจาก field isAdmin บนเอกสาร users/{uid} ของตัวเอง (ต้องเปิด
// Firebase Console แล้วตั้งค่าเองด้วยมือ) หน้านี้เช็คสิทธิ์ฝั่ง client เพื่อซ่อน/แสดงฟอร์มเท่านั้น —
// ตัวบังคับจริงคือ firestore.rules ที่เช็ค isAdmin ก่อนอนุญาตเขียน fundSources เสมอ
//
// แต่ละ fundSource มี ruleVersion ที่ active อยู่แค่เวอร์ชันเดียวที่แก้ไขได้ตรงๆ ผ่านหน้านี้ (ไม่มี UI
// จัดการประวัติหลายเวอร์ชัน — ดู spec หัวข้อ 8 นอกขอบเขต) ruleItem แต่ละอันมี: categoryName, rateType,
// rateAmount, unit, requiredEvidenceType, note, evidenceChainId (ตรงตาม spec หัวข้อ 3)
// ─────────────────────────────────────────────────────────────

(async function () {
  var adminCheck = document.getElementById("admin-check");
  var adminOnly = document.getElementById("admin-only");
  var fundSourceNameInput = document.getElementById("fundSourceName");
  var fundSourceCodeInput = document.getElementById("fundSourceCode");
  var warningBox = document.getElementById("warningBox");
  var addFundSourceButton = document.getElementById("addFundSourceButton");
  var loadState = document.getElementById("load-state");
  var fundSourceList = document.getElementById("fund-source-list");

  var RATE_TYPES = ["เพดานตามจริง", "เหมาจ่าย", "ต่อหน่วย", "ตามข้อเสนอโครงการ"];

  var evidenceChainsById = {};

  function warn(message) {
    warningBox.textContent = "⚠️ " + message;
    warningBox.style.display = "block";
  }
  function clearWarning() {
    warningBox.style.display = "none";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var user = await window.AUTH_READY;

  var userDoc = await db.collection("users").doc(user.uid).get();
  var isAdmin = userDoc.exists && userDoc.data().isAdmin === true;

  if (!isAdmin) {
    adminCheck.innerHTML =
      '<div class="banner banner--error">' +
        '<p class="text-body">หน้านี้สำหรับผู้ดูแลระบบ (admin) เท่านั้น — บัญชีนี้ยังไม่มีสิทธิ์ admin</p>' +
      '</div>';
    return;
  }

  adminCheck.style.display = "none";
  adminOnly.style.display = "block";

  function nextFundSourceId(existingDocs) {
    var maxNumber = 0;
    existingDocs.forEach(function (doc) {
      var m = doc.id.match(/^fundsource(\d+)$/);
      if (m) maxNumber = Math.max(maxNumber, parseInt(m[1], 10));
    });
    return "fundsource" + String(maxNumber + 1).padStart(3, "0");
  }

  // legacy ruleItem ที่อาจ seed ไว้แบบเก่า (มีแค่ categoryName/maxAmount) — normalize ให้แสดง/แก้ไขได้
  // เหมือนกันหมด (ไม่ควรเจอในข้อมูลจริงของระบบนี้ เพราะ seed ตรงตาม spec หัวข้อ 3.1 อยู่แล้ว แต่กันไว้)
  function normalizeRuleItem(data) {
    if (data.rateType) return Object.assign({ evidenceChainId: null }, data);
    return Object.assign({}, data, {
      rateType: "เพดานตามจริง",
      rateAmount: data.maxAmount != null ? data.maxAmount : null,
      unit: null,
      requiredEvidenceType: data.requiredEvidenceType || "",
      note: data.note || "",
      evidenceChainId: data.evidenceChainId || null,
    });
  }

  function ruleItemRowHtml(fsId, riId, ri) {
    var item = normalizeRuleItem(ri);
    var rateText = item.rateAmount != null
      ? "฿" + Number(item.rateAmount).toLocaleString("th-TH") + (item.unit ? " / " + esc(item.unit) : "")
      : "-";
    var chainText = item.evidenceChainId
      ? (evidenceChainsById[item.evidenceChainId] || item.evidenceChainId)
      : "(ไม่ระบุชุดเอกสาร)";
    return (
      '<div class="row row-align-center" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--color-border-default);" data-fs-id="' + esc(fsId) + '" data-ri-id="' + esc(riId) + '">' +
        '<span class="text-small" style="flex:1 1 130px;">' + esc(item.categoryName) + '</span>' +
        '<span class="text-small" style="flex:1 1 110px;">' + esc(item.rateType) + '</span>' +
        '<span class="text-small text-mono" style="flex:1 1 110px;">' + rateText + '</span>' +
        '<span class="text-tiny" style="flex:1 1 110px;">' + esc(item.requiredEvidenceType) + '</span>' +
        '<span class="text-tiny" style="flex:1 1 150px;">' + esc(chainText) + '</span>' +
        '<span class="text-tiny" style="flex:1 1 130px;">' + esc(item.note) + '</span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="delete-rule-item">ลบ</button>' +
      '</div>'
    );
  }

  function addRuleItemFormHtml(fsId) {
    var options = RATE_TYPES.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join("");
    var chainOptions = '<option value="">(ไม่ระบุชุดเอกสาร)</option>' +
      Object.keys(evidenceChainsById).map(function (id) {
        return '<option value="' + esc(id) + '">' + esc(evidenceChainsById[id]) + '</option>';
      }).join("");
    return (
      '<div class="row" style="margin-top:12px; flex-wrap:wrap;" data-fs-id="' + esc(fsId) + '">' +
        '<input type="text" class="ri-category" placeholder="หมวด เช่น ค่าวัสดุสำนักงาน" style="flex:1 1 140px;">' +
        '<select class="ri-rate-type" style="flex:1 1 130px;">' + options + '</select>' +
        '<input type="number" class="ri-rate-amount" placeholder="จำนวนเงิน" style="flex:1 1 100px;">' +
        '<input type="text" class="ri-unit" placeholder="หน่วย (ถ้ามี)" style="flex:1 1 90px;">' +
        '<input type="text" class="ri-evidence" placeholder="เอกสารที่ต้องใช้" style="flex:1 1 120px;">' +
        '<select class="ri-evidence-chain" style="flex:1 1 160px;" title="ชุดเอกสารที่ต้องมีครบ (evidenceChains)">' + chainOptions + '</select>' +
        '<input type="text" class="ri-note" placeholder="หมายเหตุ" style="flex:1 1 140px;">' +
        '<button type="button" class="btn btn-secondary btn-sm" data-action="add-rule-item">เพิ่มกฎ</button>' +
      '</div>'
    );
  }

  async function fundSourceCardHtml(fsDoc) {
    var fs = fsDoc.data();
    var ruleVersionsSnap = await db.collection("fundSources").doc(fsDoc.id).collection("ruleVersions").where("isActive", "==", true).limit(1).get();
    var ruleItemsHtml = "";
    if (!ruleVersionsSnap.empty) {
      var activeVersion = ruleVersionsSnap.docs[0];
      var ruleItemsSnap = await activeVersion.ref.collection("ruleItems").get();
      ruleItemsHtml = ruleItemsSnap.docs.map(function (d) { return ruleItemRowHtml(fsDoc.id, d.id, d.data()); }).join("");
    }

    return (
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between; align-items:flex-start;">' +
          '<div><h4>' + esc(fs.fundSourceName) + '</h4><p class="text-small text-mono">' + esc(fs.fundSourceCode) + '</p></div>' +
          '<button type="button" class="btn btn-destructive btn-sm" data-action="delete-fund-source" data-fs-id="' + esc(fsDoc.id) + '">ลบแหล่งทุน</button>' +
        '</div>' +
        (ruleItemsHtml || '<p class="text-small" style="margin-top:8px;">ยังไม่มีกฎใบเสร็จ — เพิ่มด้านล่างได้เลย</p>') +
        addRuleItemFormHtml(fsDoc.id) +
      '</div>'
    );
  }

  async function loadFundSourceList() {
    var snapshot = await db.collection("fundSources").get();

    if (snapshot.empty) {
      loadState.innerHTML = '<div class="banner banner--info"><p class="text-body">ยังไม่มีแหล่งทุนในระบบ — เพิ่มรายการแรกด้านบนได้เลย</p></div>';
      fundSourceList.style.display = "none";
      return snapshot.docs;
    }

    var cardsHtml = await Promise.all(snapshot.docs.map(fundSourceCardHtml));
    fundSourceList.innerHTML = cardsHtml.join("");
    fundSourceList.style.display = "block";
    loadState.style.display = "none";
    return snapshot.docs;
  }

  try {
    var evidenceChainsSnap = await db.collection("evidenceChains").get();
    evidenceChainsSnap.forEach(function (doc) {
      evidenceChainsById[doc.id] = doc.data().chainName || doc.id;
    });
  } catch (chainErr) {
    // ไม่มีสิทธิ์อ่านหรือยังไม่เคย seed — ปล่อย evidenceChainsById ว่างไว้ dropdown จะมีแค่ "(ไม่ระบุชุดเอกสาร)"
  }

  var existingDocs;
  try {
    existingDocs = await loadFundSourceList();
  } catch (err) {
    loadState.innerHTML = '<div class="banner banner--error"><p class="text-body"><strong>โหลดข้อมูลไม่สำเร็จ:</strong> ' + esc(err.message) + '</p></div>';
    existingDocs = [];
  }

  addFundSourceButton.addEventListener("click", async function () {
    clearWarning();

    var fundSourceName = fundSourceNameInput.value.trim();
    var fundSourceCode = fundSourceCodeInput.value.trim();

    if (!fundSourceName || !fundSourceCode) {
      warn("กรุณากรอกชื่อและรหัสแหล่งทุนให้ครบ");
      return;
    }

    addFundSourceButton.disabled = true;
    addFundSourceButton.textContent = "กำลังเพิ่มแหล่งทุน...";
    try {
      var newFundSourceId = nextFundSourceId(existingDocs);
      await db.collection("fundSources").doc(newFundSourceId).set({
        fundSourceName: fundSourceName,
        fundSourceCode: fundSourceCode,
      });

      fundSourceNameInput.value = "";
      fundSourceCodeInput.value = "";
      existingDocs = await loadFundSourceList();
    } catch (err) {
      warn("เพิ่มแหล่งทุนไม่สำเร็จ: " + err.message + " (เช็คว่าบัญชีนี้มี isAdmin: true ใน Firestore)");
    } finally {
      addFundSourceButton.disabled = false;
      addFundSourceButton.textContent = "เพิ่มแหล่งทุน";
    }
  });

  async function getOrCreateActiveRuleVersion(fsId) {
    var ruleVersionsRef = db.collection("fundSources").doc(fsId).collection("ruleVersions");
    var activeSnap = await ruleVersionsRef.where("isActive", "==", true).limit(1).get();
    if (!activeSnap.empty) return activeSnap.docs[0].ref;

    var allSnap = await ruleVersionsRef.get();
    var maxNumber = 0;
    allSnap.forEach(function (doc) {
      var m = doc.id.match(/^ruleversion(\d+)$/);
      if (m) maxNumber = Math.max(maxNumber, parseInt(m[1], 10));
    });
    var newId = "ruleversion" + String(maxNumber + 1).padStart(3, "0");
    var newRef = ruleVersionsRef.doc(newId);
    await newRef.set({
      versionLabel: newId,
      isActive: true,
      fundSourceId: fsId,
      importedByUserId: user.uid,
    });
    return newRef;
  }

  fundSourceList.addEventListener("click", async function (e) {
    var button = e.target.closest("button[data-action]");
    if (!button) return;
    clearWarning();

    if (button.dataset.action === "delete-fund-source") {
      var fsId = button.dataset.fsId;
      if (!confirm("ลบแหล่งทุนนี้และกฎใบเสร็จทั้งหมดของมัน? โครงการที่ผูกกับแหล่งทุนนี้อยู่จะแสดง \"ไม่พบแหล่งทุน\" หลังจากนี้")) return;

      button.disabled = true;
      button.textContent = "กำลังลบ...";
      try {
        var ruleVersionsRef = db.collection("fundSources").doc(fsId).collection("ruleVersions");
        var ruleVersionsSnap = await ruleVersionsRef.get();
        for (var i = 0; i < ruleVersionsSnap.docs.length; i++) {
          var rv = ruleVersionsSnap.docs[i];
          var ruleItemsSnap = await rv.ref.collection("ruleItems").get();
          for (var j = 0; j < ruleItemsSnap.docs.length; j++) await ruleItemsSnap.docs[j].ref.delete();
          await rv.ref.delete();
        }
        await db.collection("fundSources").doc(fsId).delete();
        existingDocs = await loadFundSourceList();
      } catch (err) {
        warn("ลบแหล่งทุนไม่สำเร็จ: " + err.message);
        button.disabled = false;
        button.textContent = "ลบแหล่งทุน";
      }
      return;
    }

    if (button.dataset.action === "add-rule-item") {
      var formRow = button.closest("[data-fs-id]");
      var addFsId = formRow.dataset.fsId;
      var categoryName = formRow.querySelector(".ri-category").value.trim();
      var rateType = formRow.querySelector(".ri-rate-type").value;
      var rateAmountRaw = formRow.querySelector(".ri-rate-amount").value;
      var unit = formRow.querySelector(".ri-unit").value.trim();
      var requiredEvidenceType = formRow.querySelector(".ri-evidence").value.trim();
      var evidenceChainId = formRow.querySelector(".ri-evidence-chain").value || null;
      var note = formRow.querySelector(".ri-note").value.trim();

      if (!categoryName) {
        warn("กรุณากรอกชื่อหมวดค่าใช้จ่าย");
        return;
      }

      button.disabled = true;
      button.textContent = "กำลังเพิ่ม...";
      try {
        var activeVersionRef = await getOrCreateActiveRuleVersion(addFsId);
        var ruleItemsRef = activeVersionRef.collection("ruleItems");
        var existingItemsSnap = await ruleItemsRef.get();
        var maxItemNumber = 0;
        existingItemsSnap.forEach(function (doc) {
          var m = doc.id.match(/^ruleitem(\d+)$/);
          if (m) maxItemNumber = Math.max(maxItemNumber, parseInt(m[1], 10));
        });
        var newItemId = "ruleitem" + String(maxItemNumber + 1).padStart(3, "0");
        await ruleItemsRef.doc(newItemId).set({
          categoryName: categoryName,
          rateType: rateType,
          rateAmount: rateAmountRaw === "" ? null : parseFloat(rateAmountRaw),
          unit: unit || null,
          requiredEvidenceType: requiredEvidenceType,
          evidenceChainId: evidenceChainId,
          note: note,
        });
        existingDocs = await loadFundSourceList();
      } catch (err) {
        warn("เพิ่มกฎไม่สำเร็จ: " + err.message);
        button.disabled = false;
        button.textContent = "เพิ่มกฎ";
      }
      return;
    }

    if (button.dataset.action === "delete-rule-item") {
      var itemRow = button.closest("[data-fs-id][data-ri-id]");
      var delFsId = itemRow.dataset.fsId;
      var delRiId = itemRow.dataset.riId;

      button.disabled = true;
      button.textContent = "กำลังลบ...";
      try {
        var activeVersionRefForDelete = await getOrCreateActiveRuleVersion(delFsId);
        await activeVersionRefForDelete.collection("ruleItems").doc(delRiId).delete();
        existingDocs = await loadFundSourceList();
      } catch (err) {
        warn("ลบกฎไม่สำเร็จ: " + err.message);
        button.disabled = false;
        button.textContent = "ลบ";
      }
    }
  });
})();
