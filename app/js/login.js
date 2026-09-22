// ─────────────────────────────────────────────────────────────
// js/login.js — ฟอร์มเข้าสู่ระบบด้วยอีเมล/รหัสผ่านของ Firebase Auth
// ไม่มี nav.js/auth-guard.js ในหน้านี้ (หน้านี้เองคือทางเข้าก่อนมี auth-guard ได้)
// ─────────────────────────────────────────────────────────────

(function () {
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var warningBox = document.getElementById("warningBox");
  var loginButton = document.getElementById("loginButton");

  function warn(message) {
    warningBox.textContent = "⚠️ " + message;
    warningBox.style.display = "block";
  }
  function clearWarning() {
    warningBox.style.display = "none";
  }

  firebase.auth().onAuthStateChanged(function (user) {
    if (user) location.href = "index.html";
  });

  var errorMessages = {
    "auth/invalid-credential": "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    "auth/user-not-found": "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    "auth/wrong-password": "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    "auth/invalid-email": "รูปแบบอีเมลไม่ถูกต้อง",
    "auth/too-many-requests": "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่ภายหลัง",
    "auth/user-disabled": "บัญชีนี้ถูกระงับการใช้งาน",
  };

  loginButton.addEventListener("click", async function () {
    clearWarning();

    var email = emailInput.value.trim();
    var password = passwordInput.value;

    if (!email || !password) {
      warn("กรุณากรอกอีเมลและรหัสผ่าน");
      return;
    }

    loginButton.disabled = true;
    loginButton.textContent = "กำลังเข้าสู่ระบบ...";
    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
      location.href = "index.html";
    } catch (err) {
      warn(errorMessages[err.code] || err.message);
      loginButton.disabled = false;
      loginButton.textContent = "เข้าสู่ระบบ";
    }
  });
})();
