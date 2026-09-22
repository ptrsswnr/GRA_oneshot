// ─────────────────────────────────────────────────────────────
// js/nav.js — แถบเมนูด้านบนที่ใช้ร่วมกันทุกหน้า (แก้เมนูที่ไฟล์นี้ที่เดียว)
//
// วิธีใช้: ทุกหน้า (ยกเว้น login.html/signup.html) มี <div id="nav"></div> ไว้บนสุดของ body
//
// เมนูของ admin (Admin Dashboard, แหล่งทุน) ไม่ได้เรนเดอร์ไว้ที่นี่ตั้งแต่แรก — js/auth-guard.js
// เป็นคนเพิ่มลิงก์เหล่านี้เข้ามาแทนหลังเช็ค isAdmin จาก Firestore แล้วว่าเป็น true จริง (เรียก
// window.showAdminNavLinks() ที่ไฟล์นี้ export ไว้) บัญชี admin เห็น**เฉพาะ**ลิงก์ admin เท่านั้น
// (ไม่เห็นเมนูของนักวิจัยเลย — โครงการ/ใบเสร็จ/อัปโหลด เป็นเครื่องมือของนักวิจัย ไม่ใช่ของ admin)
//
// ซ่อนแถบเมนูไว้ก่อน (visibility:hidden) ตอนเรนเดอร์ครั้งแรก เพราะตอนนั้นยังไม่รู้ว่า user เป็น admin
// หรือไม่ (auth-guard.js ต้องเช็ค Firestore แบบ async ก่อน) — auth-guard.js ต้องเรียก
// window.revealNav() หลังเช็ค isAdmin เสร็จแล้วเสมอ (ทั้งกรณี admin/ไม่ใช่ admin)
// ─────────────────────────────────────────────────────────────

(function () {
  var menuItems = [
    { href: "index.html", label: "หน้าแรก" },
    { href: "projects.html", label: "โครงการของฉัน" },
    { href: "receipts.html", label: "ใบเสร็จของฉัน" },
    { href: "new-receipt.html", label: "อัปโหลดใบเสร็จใหม่" },
  ];

  window.ADMIN_NAV_ITEMS = [
    { href: "admin-dashboard.html", label: "Admin Dashboard" },
    { href: "fund-sources.html", label: "แหล่งทุน (Admin)" },
  ];

  var currentPage = location.pathname.split("/").pop() || "index.html";

  var html = '<header class="proto-bar">';
  html += '<a href="index.html" class="proto-bar__brand" style="text-decoration:none;">🧾 Grant Receipt Assistant</a>';
  html += '<nav class="proto-bar__nav">';
  menuItems.forEach(function (m) {
    var active = m.href === currentPage ? ' class="active"' : "";
    html += '<a href="' + m.href + '"' + active + ">" + m.label + "</a>";
  });
  html += '</nav>';
  html += '<div class="proto-bar__meta"><span class="role-badge" id="navUser">นักวิจัย/เจ้าของทุน</span></div>';
  html += '</header>';

  var navContainer = document.getElementById("nav");
  if (navContainer) {
    navContainer.innerHTML = html;
    navContainer.style.visibility = "hidden";
  }

  window.revealNav = function () {
    var navContainer = document.getElementById("nav");
    if (navContainer) navContainer.style.visibility = "visible";
  };

  window.showAdminNavLinks = function () {
    var navEl = document.querySelector(".proto-bar__nav");
    if (!navEl) return;
    navEl.innerHTML = "";
    window.ADMIN_NAV_ITEMS.forEach(function (m) {
      var a = document.createElement("a");
      a.href = m.href;
      a.textContent = m.label;
      if (m.href === currentPage) a.className = "active";
      navEl.appendChild(a);
    });
  };
})();
