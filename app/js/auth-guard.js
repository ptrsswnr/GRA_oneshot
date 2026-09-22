// ─────────────────────────────────────────────────────────────
// js/auth-guard.js — ต้องโหลดหลัง js/nav.js บนทุกหน้าที่ต้องล็อกอินก่อนใช้งาน
// (ทุกหน้าใน app/ ยกเว้น login.html/signup.html)
//
// - ถ้ายังไม่ได้ล็อกอิน → เด้งไป login.html ทันที
// - ถ้าล็อกอินอยู่ → เติมอีเมล + ปุ่มออกจากระบบลงใน #navUser (nav.js เรนเดอร์ span ว่างไว้ให้แล้ว)
//   แล้ว resolve window.AUTH_READY ด้วย user object ให้สคริปต์ของหน้านั้นๆ await ก่อนเรียก
//   Firestore ทุกครั้ง — ต้อง await เสมอ เพราะ onAuthStateChanged เป็น async แม้ผู้ใช้จะล็อกอินค้าง
//   ไว้จากรอบก่อนก็ตาม
// - อ่าน users/{uid} ของตัวเองเพื่อเช็ค isAdmin ด้วย (แยกจาก resolve(user) ด้านล่าง ไม่บล็อกกัน) ถ้า
//   true จะเรียก window.showAdminNavLinks() (จาก js/nav.js) เพื่อสลับเมนูเป็นเมนู admin
// - nav.js ซ่อนแถบเมนูไว้ตั้งแต่เรนเดอร์ครั้งแรก จึงต้องเรียก window.revealNav() เสมอหลังเช็ค isAdmin
//   เสร็จ ไม่ว่าผลจะเป็น admin หรือไม่ก็ตาม — ถ้าลืมเรียก เมนูจะซ่อนค้างมองไม่เห็นเลย
// ─────────────────────────────────────────────────────────────

(function () {
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  window.AUTH_READY = new Promise(function (resolve) {
    firebase.auth().onAuthStateChanged(function (user) {
      if (!user) {
        location.href = "login.html";
        return;
      }

      var navUser = document.getElementById("navUser");
      if (navUser) {
        navUser.innerHTML =
          esc(user.email) +
          ' · <a href="#" id="logoutButton">ออกจากระบบ</a>';
        var logoutButton = document.getElementById("logoutButton");
        logoutButton.addEventListener("click", function (e) {
          e.preventDefault();
          firebase.auth().signOut().then(function () {
            location.href = "login.html";
          });
        });
      }

      if (window.db) {
        db.collection("users").doc(user.uid).get().then(function (doc) {
          if (doc.exists && doc.data().isAdmin === true && window.showAdminNavLinks) {
            window.showAdminNavLinks();
          }
        }).catch(function () {}).then(function () {
          if (window.revealNav) window.revealNav();
        });
      } else if (window.revealNav) {
        window.revealNav();
      }

      resolve(user);
    });
  });
})();
