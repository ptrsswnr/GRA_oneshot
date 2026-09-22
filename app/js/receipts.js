// ─────────────────────────────────────────────────────────────
// js/receipts.js — FS-05: รายการใบเสร็จของฉัน (ทุกโครงการ) กรองตามโครงการได้ผ่าน ?projectId= —
// อ่านจาก collectionGroup("receipts") กรอง .where("ownerUserId","==",uid) เพื่อไม่ให้เห็นของคนอื่น
//
// **backward-compat**: ฐานข้อมูลนี้เป็นฐานเดียวกับระบบเดิม ("Grant Receipt Assistant") ซึ่งมีใบเสร็จ
// เก่าใช้ชื่อ field แบบเดิม (confirmedAmount/confirmedDate/confirmedCategory/confirmedVendorName,
// ไฟล์เก่าใช้ originalFileName/fileType/fileSizeBytes/sortOrder) — อ่าน field ชื่อใหม่ตามสเปกก่อนเสมอ
// (amount/date/category/vendorName) แล้ว fallback เป็นชื่อเก่าถ้าค่าใหม่เป็น undefined ไม่งั้นใบเสร็จ
// เก่าจะโชว์ว่าง เขียนใหม่ **ต้องใช้ชื่อ field ใหม่เท่านั้น** (ไม่มีที่ไหนในโค้ดนี้เขียน field ชื่อเก่า)
//
// ปุ่มลบต่อใบเสร็จ — ลบเฉพาะของตัวเอง (firestore.rules อนุญาตเจ้าของ write ซึ่งครอบคลุม delete) —
// cascade ลบ subcollection "files" และ "agentLogs" ไปด้วย (ไม่ลบไฟล์จริงใน Google Drive)
// ─────────────────────────────────────────────────────────────

var STATUS_CHIP_CLASS = {
  "ผ่าน": "chip-status--pass",
  "ต้องแก้ไข": "chip-status--fix",
  "ไม่เข้าเงื่อนไข": "chip-status--reject",
};

function receiptAmount(r) { return typeof r.amount === "number" ? r.amount : r.confirmedAmount; }
function receiptDate(r) { return r.date != null ? r.date : r.confirmedDate; }
function receiptCategory(r) { return r.category != null ? r.category : r.confirmedCategory; }
function receiptVendorName(r) { return r.vendorName != null ? r.vendorName : r.confirmedVendorName; }
function fileDisplayName(f) { return f.originalFileName || f.fileReference || "(ไม่ทราบชื่อไฟล์)"; }

function formatCurrency(amount) {
  if (typeof amount !== "number") return "-";
  return "฿" + amount.toLocaleString("th-TH", { minimumFractionDigits: 2 });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function filesHtml(files) {
  if (!files || files.length === 0) {
    return '<p class="text-small">ไฟล์แนบ: ไม่มี</p>';
  }
  var links = files
    .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); })
    .map(function (f) {
      if (f.fileReference) {
        return '<a href="' + esc(f.fileReference) + '" target="_blank" rel="noopener">📎 ' + esc(fileDisplayName(f)) + '</a>';
      }
      return '<span>📎 ' + esc(fileDisplayName(f)) + '</span>';
    })
    .join(" · ");
  return '<p class="text-small">ไฟล์แนบ: ' + links + '</p>';
}

function receiptCardHtml(receiptPath, receipt, files, projectName) {
  var chipClass = STATUS_CHIP_CLASS[receipt.status] || "chip-status--pending";
  var calloutKind = chipClass.indexOf("pass") > -1 ? "pass" : chipClass.indexOf("fix") > -1 ? "fix" : "reject";

  var html = '<div class="receipt-entry" data-receipt-path="' + esc(receiptPath) + '">';
  html +=
    '<div class="receipt-card">' +
      '<div class="receipt-card__thumb">🧾</div>' +
      '<div class="receipt-card__body">' +
        '<div class="receipt-card__amount">' + esc(formatCurrency(receiptAmount(receipt))) + '</div>' +
        '<div class="receipt-card__meta">' + esc(projectName || "(ไม่พบโครงการ)") + ' · ' + esc(receiptDate(receipt)) + ' · ' + esc(receiptCategory(receipt)) + ' · ' + esc(receiptVendorName(receipt)) + '</div>' +
      '</div>' +
      '<div class="receipt-card__status">' +
        '<span class="chip-status ' + chipClass + '">' + esc(receipt.status || "ไม่ทราบสถานะ") + '</span>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="delete-receipt">ลบ</button>' +
    '</div>';

  html += filesHtml(files);

  if (receipt.aiExplanation) {
    html +=
      '<div class="rule-callout rule-callout--' + calloutKind + '">' +
        '<p class="rule-callout__explain">' + esc(receipt.aiExplanation) + '</p>' +
      '</div>';
  }
  html += '</div>';
  return html;
}

(function () {
  var loadState = document.getElementById("load-state");
  var list = document.getElementById("receipt-list");
  var pageIntro = document.getElementById("pageIntro");

  var filterProjectId = new URLSearchParams(location.search).get("projectId");

  function showEmptyState() {
    loadState.innerHTML = filterProjectId
      ? '<div class="banner banner--info"><p class="text-body">โครงการนี้ยังไม่มีใบเสร็จ — ' +
        '<a href="new-receipt.html?projectId=' + esc(filterProjectId) + '">อัปโหลดใบเสร็จแรก</a></p></div>'
      : '<div class="banner banner--warning">' +
        '<p class="text-body">ยังไม่มีใบเสร็จเลย — ไปที่หน้า ' +
        '<a href="projects.html">โครงการของฉัน</a> เพื่อสร้างโครงการ+งบประมาณ แล้วอัปโหลดใบเสร็จก่อน</p>' +
        '</div>';
    loadState.style.display = "block";
    list.style.display = "none";
  }

  async function loadReceipts() {
    try {
      var user = await window.AUTH_READY;

      if (filterProjectId) {
        var projectDoc = await db.collection("users").doc(user.uid).collection("projects").doc(filterProjectId).get();
        var filterProjectName = projectDoc.exists ? projectDoc.data().projectName : "(ไม่พบโครงการ)";
        pageIntro.innerHTML =
          '<h1>ใบเสร็จของโครงการ: ' + esc(filterProjectName) + '</h1>' +
          '<p class="text-body">' +
            '<a href="projects.html">← กลับไปโครงการของฉัน</a> · ' +
            '<a href="new-receipt.html?projectId=' + esc(filterProjectId) + '" class="btn btn-primary btn-sm">อัปโหลดใบเสร็จในโครงการนี้</a>' +
          '</p>';
      }

      var snapshot = await db.collectionGroup("receipts")
        .where("ownerUserId", "==", user.uid)
        .orderBy("uploadedAt", "desc")
        .get();

      var docs = snapshot.docs;
      if (filterProjectId) {
        docs = docs.filter(function (doc) {
          var projectRef = doc.ref.parent.parent;
          return projectRef && projectRef.id === filterProjectId;
        });
      }

      if (docs.length === 0) {
        showEmptyState();
        return;
      }

      var htmlParts = await Promise.all(docs.map(async function (doc) {
        var filesSnapshot = await doc.ref.collection("files").get();
        var files = filesSnapshot.docs.map(function (f) { return f.data(); });
        var receipt = doc.data();

        var projectRef = doc.ref.parent.parent;
        var projectName = "(ข้อมูลจากโครงสร้างเก่า — ไม่มีโครงการอ้างอิง)";
        if (projectRef) {
          var projectSnap = await projectRef.get();
          projectName = projectSnap.exists ? projectSnap.data().projectName : "(ไม่พบโครงการ)";
        }

        return receiptCardHtml(doc.ref.path, receipt, files, projectName);
      }));

      list.innerHTML = htmlParts.join("");
      list.style.display = "block";
      loadState.style.display = "none";
    } catch (err) {
      var createIndexLink = String(err.message || "").match(/https:\/\/console\.firebase\.google\.com\S*/);

      if (createIndexLink) {
        loadState.innerHTML =
          '<div class="banner banner--warning">' +
            '<p class="text-body"><strong>ยังไม่มี Firestore index สำหรับ query นี้</strong> — ต้องสร้าง index ' +
            '1 ครั้งใน Firebase Console ก่อน (ทำครั้งเดียว)</p>' +
            '<p class="text-body"><a href="' + esc(createIndexLink[0]) + '" target="_blank" rel="noopener" class="btn btn-primary btn-sm">' +
              'เปิด Firebase Console เพื่อสร้าง Index' +
            '</a></p>' +
          '</div>';
      } else {
        loadState.innerHTML =
          '<div class="banner banner--error">' +
            '<p class="text-body"><strong>โหลดข้อมูลไม่สำเร็จ:</strong> ' + esc(err.message) + '</p>' +
          '</div>';
      }
      console.error(err);
    }
  }

  list.addEventListener("click", async function (e) {
    var button = e.target.closest('button[data-action="delete-receipt"]');
    if (!button) return;

    var entry = button.closest("[data-receipt-path]");
    var receiptPath = entry.dataset.receiptPath;

    if (!confirm("ลบใบเสร็จนี้? การลบนี้ย้อนกลับไม่ได้")) return;

    button.disabled = true;
    button.textContent = "กำลังลบ...";
    try {
      var receiptRef = db.doc(receiptPath);

      var filesSnapshot = await receiptRef.collection("files").get();
      for (var i = 0; i < filesSnapshot.docs.length; i++) await filesSnapshot.docs[i].ref.delete();

      var agentLogsSnapshot = await receiptRef.collection("agentLogs").get();
      for (var j = 0; j < agentLogsSnapshot.docs.length; j++) await agentLogsSnapshot.docs[j].ref.delete();

      await receiptRef.delete();

      entry.remove();
      if (list.children.length === 0) showEmptyState();
    } catch (err) {
      alert("ลบใบเสร็จไม่สำเร็จ: " + err.message);
      button.disabled = false;
      button.textContent = "ลบ";
    }
  });

  loadReceipts();
})();
