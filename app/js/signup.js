// ─────────────────────────────────────────────────────────────
// js/signup.js — สมัครสมาชิกด้วยอีเมล/รหัสผ่านของ Firebase Auth
// สร้างบัญชีแล้วเขียนเอกสาร users/{uid} ของตัวเอง (อนุญาตตาม firestore.rules เพราะ
// request.auth.uid == userId และ isAdmin ต้องเป็น false ตอน create) แล้วเด้งไป projects.html
// ให้สร้างโครงการวิจัยแรกของตัวเอง (FS-01) — isAdmin ตั้งเป็น false เสมอตอนสมัคร ไม่มี UI ให้ผู้ใช้
// ตั้งตัวเองเป็น admin ต้องเปลี่ยนค่านี้เป็น true ผ่าน Firebase Console เอง (ดู spec หัวข้อ 2)
// ─────────────────────────────────────────────────────────────

(function () {
  var fullNameInput = document.getElementById("fullName");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var confirmPasswordInput = document.getElementById("confirmPassword");
  var warningBox = document.getElementById("warningBox");
  var signupButton = document.getElementById("signupButton");

  function warn(message) {
    warningBox.textContent = "⚠️ " + message;
    warningBox.style.display = "block";
  }
  function clearWarning() {
    warningBox.style.display = "none";
  }

  // ต้องข้ามเช็ค "ล็อกอินอยู่แล้ว → เด้งไป index.html" ระหว่างกำลังสมัครสมาชิกอยู่ (signingUp) เพราะ
  // createUserWithEmailAndPassword ก็ทำให้ auth state เปลี่ยนเหมือนกัน ไม่งั้นจะแย่งกันเปลี่ยนหน้ากับ
  // location.href = "projects.html" ด้านล่าง
  var signingUp = false;
  firebase.auth().onAuthStateChanged(function (user) {
    if (user && !signingUp) location.href = "index.html";
  });

  var errorMessages = {
    "auth/email-already-in-use": "อีเมลนี้มีผู้ใช้งานแล้ว",
    "auth/invalid-email": "รูปแบบอีเมลไม่ถูกต้อง",
    "auth/weak-password": "รหัสผ่านสั้นเกินไป (ต้องอย่างน้อย 6 ตัวอักษร)",
  };

  signupButton.addEventListener("click", async function () {
    clearWarning();

    var fullName = fullNameInput.value.trim();
    var email = emailInput.value.trim();
    var password = passwordInput.value;
    var confirmPassword = confirmPasswordInput.value;

    if (!fullName || !email || !password || !confirmPassword) {
      warn("กรุณากรอกข้อมูลให้ครบ");
      return;
    }
    if (password !== confirmPassword) {
      warn("รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน");
      return;
    }

    signingUp = true;
    signupButton.disabled = true;
    signupButton.textContent = "กำลังสมัครสมาชิก...";
    try {
      var result = await firebase.auth().createUserWithEmailAndPassword(email, password);
      await db.collection("users").doc(result.user.uid).set({
        fullName: fullName,
        email: email,
        isAdmin: false,
      });
      location.href = "projects.html";
    } catch (err) {
      signingUp = false;
      warn(errorMessages[err.code] || err.message);
      signupButton.disabled = false;
      signupButton.textContent = "สมัครสมาชิก";
    }
  });
})();
