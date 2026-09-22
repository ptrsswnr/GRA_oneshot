// ─────────────────────────────────────────────────────────────
// js/admin-dashboard.js — FS-07: Admin Dashboard — ใบเสร็จของนักวิจัยทุกคนในระบบ (ไม่ใช่แค่ของตัวเอง)
//
// ใช้ collectionGroup("receipts").orderBy("uploadedAt","desc") แบบไม่มี .where("ownerUserId",...)
// เลย — นี่คือจุดที่ทำให้หน้านี้เป็นมุมมองระดับ admin ข้ามผู้ใช้ทั้งหมด ต้องอาศัย isAdmin() bypass ใน
// firestore.rules ถึงจะอ่านผ่าน (ผู้ใช้ทั่วไปเรียก query แบบนี้จะโดน permission-denied)
//
// **backward-compat**: ฐานข้อมูลนี้เป็นฐานเดียวกับระบบเดิม ซึ่งมีใบเสร็จ/ไฟล์เก่าใช้ชื่อ field แบบเดิม
// (confirmedAmount/confirmedDate/confirmedCategory/confirmedVendorName/isExported,
// originalFileName/fileType/fileSizeBytes/sortOrder) — หน้านี้เห็นใบเสร็จของ "ทุกคน" รวมของเก่าด้วย
// จึงต้องอ่าน field ชื่อใหม่ก่อนเสมอ แล้ว fallback เป็นชื่อเก่าถ้าค่าใหม่เป็น undefined ไม่งั้นใบเสร็จ
// เก่าจะโชว์ว่างในตาราง/สถิติ
// ─────────────────────────────────────────────────────────────

(async function () {
  var adminCheck = document.getElementById("admin-check");
  var adminOnly = document.getElementById("admin-only");
  var loadState = document.getElementById("load-state");
  var dashboardContent = document.getElementById("dashboard-content");

  var STATUS_BAR_CLASS = { "ผ่าน": "pass", "ต้องแก้ไข": "fix", "ไม่เข้าเงื่อนไข": "reject" };
  var STATUS_CHIP_CLASS = { "ผ่าน": "chip-status--pass", "ต้องแก้ไข": "chip-status--fix", "ไม่เข้าเงื่อนไข": "chip-status--reject" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function formatCurrency(amount) {
    if (typeof amount !== "number") return "-";
    return "฿" + amount.toLocaleString("th-TH", { minimumFractionDigits: 2 });
  }
  function receiptAmount(r) { return typeof r.amount === "number" ? r.amount : r.confirmedAmount; }
  function receiptCategory(r) { return r.category != null ? r.category : r.confirmedCategory; }
  function receiptVendorName(r) { return r.vendorName != null ? r.vendorName : r.confirmedVendorName; }

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

  var userCache = {};
  var projectCache = {};
  var fundSourceCache = {};

  async function getUser(uid) {
    if (!(uid in userCache)) {
      var doc = await db.collection("users").doc(uid).get();
      userCache[uid] = doc.exists ? doc.data() : null;
    }
    return userCache[uid];
  }
  async function getProject(ref) {
    var key = ref.path;
    if (!(key in projectCache)) {
      var doc = await ref.get();
      projectCache[key] = doc.exists ? doc.data() : null;
    }
    return projectCache[key];
  }
  async function getFundSourceName(fundSourceId) {
    if (!fundSourceId) return null;
    if (!(fundSourceId in fundSourceCache)) {
      var doc = await db.collection("fundSources").doc(fundSourceId).get();
      fundSourceCache[fundSourceId] = doc.exists ? doc.data().fundSourceName : null;
    }
    return fundSourceCache[fundSourceId];
  }

  function barRowsHtml(counts, classMap) {
    var maxCount = Math.max.apply(null, Object.keys(counts).map(function (k) { return counts[k]; }).concat([1]));
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).map(function (key) {
      var count = counts[key];
      var pct = Math.max(4, Math.round((count / maxCount) * 100));
      var fillClass = classMap && classMap[key] ? " bar-row__fill--" + classMap[key] : "";
      return (
        '<div class="bar-row">' +
          '<div class="bar-row__label">' + esc(key) + '</div>' +
          '<div class="bar-row__track"><div class="bar-row__fill' + fillClass + '" style="width:' + pct + '%;"></div></div>' +
          '<div class="bar-row__value">' + count + '</div>' +
        '</div>'
      );
    }).join("");
  }

  function renderStats(rows) {
    var totalAmount = 0;
    var statusCounts = {};
    var researcherIds = {};
    var projectKeys = {};

    rows.forEach(function (r) {
      var amount = receiptAmount(r.receipt);
      if (typeof amount === "number") totalAmount += amount;
      var status = r.receipt.status || "ไม่ทราบสถานะ";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      if (r.receipt.ownerUserId) researcherIds[r.receipt.ownerUserId] = true;
      if (r.projectKey) projectKeys[r.projectKey] = true;
    });

    document.getElementById("statTotalReceipts").textContent = rows.length.toLocaleString("th-TH");
    document.getElementById("statTotalAmount").textContent = totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 });
    document.getElementById("statResearchers").textContent =
      Object.keys(researcherIds).length + " / " + Object.keys(projectKeys).length;
    document.getElementById("statPass").textContent = statusCounts["ผ่าน"] || 0;
    document.getElementById("statFix").textContent = statusCounts["ต้องแก้ไข"] || 0;
    document.getElementById("statReject").textContent = statusCounts["ไม่เข้าเงื่อนไข"] || 0;

    return statusCounts;
  }

  function renderBreakdowns(rows, statusCounts) {
    document.getElementById("statusBreakdown").innerHTML = barRowsHtml(statusCounts, STATUS_BAR_CLASS);

    var categoryCounts = {};
    var fundSourceCounts = {};
    rows.forEach(function (r) {
      var category = receiptCategory(r.receipt) || "(ไม่ระบุหมวด)";
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      fundSourceCounts[r.fundSourceName] = (fundSourceCounts[r.fundSourceName] || 0) + 1;
    });
    document.getElementById("categoryBreakdown").innerHTML = barRowsHtml(categoryCounts);
    document.getElementById("fundSourceBreakdown").innerHTML = barRowsHtml(fundSourceCounts);
  }

  function renderTable(rows) {
    var tbody = document.getElementById("receiptTableBody");
    tbody.innerHTML = rows.map(function (r) {
      var receipt = r.receipt;
      var chipClass = STATUS_CHIP_CLASS[receipt.status] || "chip-status--pending";
      var uploadedAt = receipt.uploadedAt && receipt.uploadedAt.toDate ? receipt.uploadedAt.toDate().toLocaleDateString("th-TH") : "-";
      return (
        '<tr>' +
          '<td>' + esc(uploadedAt) + '</td>' +
          '<td>' + esc(r.ownerName) + '<br><span class="text-tiny">' + esc(r.ownerEmail) + '</span></td>' +
          '<td>' + esc(r.projectName) + '</td>' +
          '<td>' + esc(r.fundSourceName) + '</td>' +
          '<td>' + esc(receiptCategory(receipt)) + '</td>' +
          '<td>' + esc(receiptVendorName(receipt)) + '</td>' +
          '<td>' + esc(formatCurrency(receiptAmount(receipt))) + '</td>' +
          '<td><span class="chip-status ' + chipClass + '">' + esc(receipt.status || "ไม่ทราบสถานะ") + '</span></td>' +
          '<td>' + (r.fileCount > 0 ? r.fileCount + " ไฟล์" : "-") + '</td>' +
          '<td class="text-small">' + esc(receipt.aiExplanation) + '</td>' +
        '</tr>'
      );
    }).join("");
  }

  try {
    var snapshot = await db.collectionGroup("receipts").orderBy("uploadedAt", "desc").get();

    if (snapshot.empty) {
      loadState.innerHTML = '<div class="banner banner--info"><p class="text-body">ยังไม่มีใบเสร็จในระบบเลย</p></div>';
      return;
    }

    var rows = await Promise.all(snapshot.docs.map(async function (doc) {
      var receipt = doc.data();
      var projectRef = doc.ref.parent.parent;
      var project = projectRef ? await getProject(projectRef) : null;
      var fundSourceName = project ? await getFundSourceName(project.fundSourceId) : null;
      var owner = receipt.ownerUserId ? await getUser(receipt.ownerUserId) : null;
      var filesSnap = await doc.ref.collection("files").get();

      return {
        receipt: receipt,
        projectKey: projectRef ? projectRef.path : null,
        projectName: project ? project.projectName : "(ไม่พบโครงการ — โครงสร้างข้อมูลเก่า)",
        fundSourceName: fundSourceName || "(ไม่พบแหล่งทุน)",
        ownerName: (owner && owner.fullName) || "(ไม่พบผู้ใช้)",
        ownerEmail: (owner && owner.email) || "-",
        fileCount: filesSnap.size,
      };
    }));

    var statusCounts = renderStats(rows);
    renderBreakdowns(rows, statusCounts);
    renderTable(rows);

    loadState.style.display = "none";
    dashboardContent.style.display = "block";
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
          '<p class="text-body"><strong>โหลดข้อมูลไม่สำเร็จ:</strong> ' + esc(err.message) + '</p></div>';
    }
    console.error(err);
  }
})();
