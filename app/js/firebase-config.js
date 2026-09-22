// ─────────────────────────────────────────────────────────────
// js/firebase-config.js — ตั้งค่าการเชื่อมต่อ Firebase
//
// ใช้โปรเจกต์ Firebase เดียวกับระบบเดิม "Grant Receipt Assistant" (ดู README.md หัวข้อ Infra) —
// ค่าคอนฟิกด้านล่างจึงต้องตรงกับของเดิมทุกตัว (Firestore เป็นฐานข้อมูลเดียวกัน มีแค่ Hosting site
// ใหม่คนละอันคือ gra-oneshot) apiKey ของเว็บแอปไม่ใช่ความลับ — ความปลอดภัยจริงมาจาก Firestore
// Security Rules ไม่ใช่การซ่อนค่านี้
//
// ใช้ Firebase JS SDK แบบ "compat" (โหลดด้วย <script> ธรรมดา ไม่ใช่ module) เพื่อให้เปิดตรงจากไฟล์
// (file://) ได้เหมือนโปรเจกต์เดิม — ต้องโหลดหลัง firebase-app-compat.js, firebase-auth-compat.js
// (ทุกหน้า) และ firebase-firestore-compat.js (เฉพาะหน้าที่ต้องใช้ Firestore) เท่านั้น
// ─────────────────────────────────────────────────────────────

var firebaseConfig = {
  apiKey: "AIzaSyBS1Pi2xs3RTQQFG5ox6HDK1iOPnjFY5iE",
  authDomain: "grant-receipt-assistant.firebaseapp.com",
  projectId: "grant-receipt-assistant",
  storageBucket: "grant-receipt-assistant.firebasestorage.app",
  messagingSenderId: "748022324743",
  appId: "1:748022324743:web:d75edfffdb66c50ad354a2",
  measurementId: "G-783V7JH4S4",
};

firebase.initializeApp(firebaseConfig);
if (firebase.firestore) {
  window.db = firebase.firestore();
}
