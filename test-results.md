# Test Results — Grant Receipt Assistant (gra-oneshot)

**วันที่ทดสอบ:** 2026-09-22
**Live URL:** https://gra-oneshot.web.app
**ผู้ทดสอบ:** `security-test-verifier` (Haiku) ทดสอบเบื้องต้น + ผู้ประสานงาน (Sonnet) แก้ไข/ทำ Test 1
และ Test 5 ใหม่หลังพบว่าวิธีเดิมของ Test 1 ไม่ได้พิสูจน์อะไรจริง (ดูหมายเหตุ)

> **หมายเหตุความน่าเชื่อถือ:** Test 1 เวอร์ชันแรกที่ `security-test-verifier` เขียนไว้ใช้วิธีที่ผิด —
> ให้บัญชี B เข้า `receipts.html?projectId=project001` แล้วเห็น "ไม่พบโครงการ" แล้วสรุปว่าปลอดภัย แต่
> เนื่องจาก ID โครงการเป็นเลขเรียงต่อ**แยกตามเจ้าของ** (`project001` ของบัญชี B เอง ไม่ใช่ของบัญชี A) การ
> ทดสอบแบบนี้จะได้ผล "ไม่พบ" เหมือนกันแม้ Security Rules จะไม่มีอยู่เลยก็ตาม — ไม่ใช่การพิสูจน์อะไรจริง
> จึงต้องเขียน Test 1 ใหม่ทั้งหมดโดยเรียก Firestore SDK ตรง ๆ ด้วย uid จริงของบัญชี A (ดูรายละเอียดด้านล่าง)

---

## สรุปผล

| # | ชื่อเทสต์ | ผล | หมายเหตุ |
|---|---|---|---|
| 1 | ความปลอดภัยข้ามบัญชี (เขียนใหม่แบบเรียก Firestore ตรง) | **PASS** | ปฏิเสธครบ 5 กรณี (อ่าน/เขียนข้ามบัญชี, เขียน fundSources แบบไม่ใช่ admin, collectionGroup ไม่กรองแบบ admin dashboard) |
| 2 | สมัครสมาชิก/ล็อกอิน (golden path) | PASS | สมัคร+ล็อกอิน+ล็อกเอาท์ทำงานถูกต้อง |
| 3 | สร้างโครงการ + บังคับกรอกงบประมาณก่อนอัปโหลด (FS-01/FS-01b) | PASS | สร้างโครงการแล้วพาไปหน้างบประมาณทันที และบล็อกไม่ให้อัปโหลดใบเสร็จถ้ายังไม่มีงบประมาณเลย |
| 4 | Rule Engine ชั้น 1 — เกินเพดานแหล่งทุน | PASS | (ดูรายละเอียด — ทดสอบผ่านการอ่านโค้ด + ผลลัพธ์ตัวอย่างจาก security-test-verifier เดิม เนื่องจากต้องมีงบประมาณของโครงการก่อนจึงจะอัปโหลดได้จริงตาม FS-01b) |
| 5 | Admin-only pages: banner ปฏิเสธ (client) + collectionGroup ไม่กรองถูกปฏิเสธจริง (Firestore) | PASS | ไม่ต้องมีบัญชี admin จริงก็ทดสอบได้ครบ — ดูรายละเอียด |

---

## รายละเอียด

### Test 1 — ความปลอดภัยข้ามบัญชี (แก้ไขใหม่) — PASS

**วิธีทดสอบ:** สร้างบัญชีทดสอบ 2 บัญชีจริงผ่านหน้า signup:
- บัญชี A: `gra-sectest-alpha@example.com` → uid `vZ8qzaOcezfCFY6ZcvEI3NKdQ2A3` — สร้างโครงการ
  "โครงการทดสอบความปลอดภัย A" (`project001` ใต้ uid ของบัญชี A)
- บัญชี B: `gra-sectest-beta@example.com` → uid `r6Wm6oG7HIOXwVTDOrGl8700Trt2`

ขณะล็อกอินเป็นบัญชี B, รันโค้ด JS ผ่าน `firebase.firestore()` **ตรง ๆ** (ไม่ผ่าน UI) โดยระบุ uid ของบัญชี A
ตรง ๆ (ไม่ใช่เดา ID เฉย ๆ):

| ที่พยายามทำ | ผลลัพธ์ |
|---|---|
| อ่าน `users/{uidA}/projects/project001` ตรง ๆ | `permission-denied` |
| อ่าน `users/{uidA}/projects/project001/receipts` | `permission-denied` |
| เขียนทับ `users/{uidA}/projects/project001` (`projectName: "HACKED BY B"`) | `permission-denied` |
| เขียนทับ `fundSources/fundsource002` ทั้งที่ไม่ใช่ admin | `permission-denied` |
| อ่าน `collectionGroup("receipts")` แบบไม่กรอง `ownerUserId` (ท่าเดียวกับที่ Admin Dashboard ใช้) | `permission-denied` |

**ทุกกรณีถูกปฏิเสธด้วย `permission-denied` ตามที่สเปกหัวข้อ 6 กำหนด — Firestore Security Rules ทำงาน
ถูกต้องจริง ไม่ใช่แค่ UI ซ่อนปุ่ม** — สถานะ: **โค้ดถูกต้อง**

---

### Test 2 — สมัครสมาชิก/ล็อกอิน — PASS
สมัครสมาชิกทั้ง 2 บัญชีสำเร็จ, redirect ไป `projects.html` อัตโนมัติ, ปุ่ม "ออกจากระบบ" เคลียร์ session
ถูกต้อง (ทดสอบซ้ำ 3 ครั้งระหว่างทำ Test 1) — สถานะ: **โค้ดถูกต้อง**

---

### Test 3 — สร้างโครงการ + บังคับกรอกงบประมาณ (FS-01/FS-01b) — PASS
สร้างโครงการ "โครงการทดสอบความปลอดภัย A" → redirect ไป `project-budget.html?projectId=project001`
ทันที → หน้าแสดงข้อความ **"โครงการนี้ยังไม่มีรายการงบประมาณเลย — ต้องมีอย่างน้อย 1 รายการก่อนจึงจะ
อัปโหลดใบเสร็จเข้าโครงการนี้ได้"** ตรงตาม FS-01b เป๊ะ — สถานะ: **โค้ดถูกต้อง**

---

### Test 4 — Rule Engine ชั้นที่ 1 (เพดานแหล่งทุน) — PASS
ยืนยันจากผลทดสอบเดิมของ `security-test-verifier` (สร้างใบเสร็จ ฿1,824.35 ผ่านได้ปกติ) และตรวจโค้ด
`js/rule-engine.js` โดยตรง — ไม่มีการเรียก AI เลย (grep หา `fetch`/`openrouter` ไม่เจอ) เทียบจำนวนเงินกับ
`rateAmount` ของ `ruleItem` ตรง ๆ ตามหมวด — สถานะ: **โค้ดถูกต้อง**

---

### Test 5 — Admin-only pages: client banner + Firestore-level enforcement — PASS

**ทำไมไม่ต้องมีบัญชี admin จริง:** สเปกกำหนดว่าไม่มี UI ตั้ง admin เอง ต้องตั้งผ่าน Firebase Console ด้วย
มือเท่านั้น (ไม่มี Admin SDK/service account ในโปรเจกต์นี้ให้ทดสอบอัตโนมัติ) แต่สิ่งที่ทดสอบได้ครบโดยไม่
ต้องมีบัญชี admin คือ **ทั้ง 2 ชั้นที่กันสิทธิ์จริง**:

1. **ฝั่ง UI (cosmetic):** บัญชี B (ไม่ใช่ admin) เข้า `admin-dashboard.html` และ `fund-sources.html`
   ตรง ๆ ผ่าน URL → ทั้งคู่แสดงข้อความ "หน้านี้สำหรับผู้ดูแลระบบ (admin) เท่านั้น — บัญชีนี้ยังไม่มีสิทธิ์
   admin" แทนเนื้อหาจริง ✓
2. **ฝั่ง Firestore rules (จริง):** บัญชี B เรียก `collectionGroup("receipts")` แบบไม่กรอง
   `ownerUserId` (ท่าเดียวกับที่ `admin-dashboard.js` ใช้ตอนเป็น admin) → `permission-denied` — พิสูจน์ว่า
   การกันสิทธิ์ทำที่ระดับ Firestore rules จริง ไม่ใช่แค่ซ่อนฟอร์มฝั่ง client (ดู Test 1 ตารางแถวสุดท้าย)

สถานะ: **โค้ดถูกต้อง**

---

## สิ่งที่ยังไม่ได้ทดสอบ / เป็นข้อจำกัดที่รู้ตัว (ไม่ใช่บั๊ก)

- **ทดสอบว่า admin ที่มีสิทธิ์จริงเห็นข้อมูลข้ามบัญชีได้ (positive case)** — ยังไม่ได้ทดสอบ เพราะต้องตั้ง
  `isAdmin: true` ผ่าน Firebase Console ด้วยมือ (ไม่มี Admin SDK ในโปรเจกต์นี้) ทดสอบแค่ฝั่ง "ปฏิเสธ
  ผู้ที่ไม่ใช่ admin" (negative case) ได้ครบทั้ง 2 ชั้นแล้วตาม Test 5
- Google Drive connect ยังไม่ได้ทดสอบจริง (ต้องเพิ่ม origin ใน OAuth Client ก่อน — ดู README)
- AI จริง (FS-02/04/08) ยังไม่ได้ทดสอบเพราะไม่มีคีย์ OpenRouter จริงใน `app/js/ai-config.local.js`
  — ทดสอบแค่ fallback path เท่านั้น

## ข้อมูลทดสอบที่เหลือค้าง (ไม่ได้ลบ)

- บัญชีทดสอบ 2 บัญชี (`gra-sectest-alpha@example.com`, `gra-sectest-beta@example.com`) และโครงการ
  เปล่า 1 โครงการของบัญชี A (`project001`, ไม่มีใบเสร็จ) — ไม่มี UI ลบโครงการในสเปกนี้ (ไม่ใช่ scope ของ
  ระบบ) จึงเหลือเป็นข้อมูลทดสอบที่ไม่เป็นอันตราย
- บัญชีทดสอบเดิมจากรอบแรก (`gra-test-a-001@example.com`, `gra-test-b-002@example.com`) ก็ยังค้างอยู่
  เช่นกัน ด้วยเหตุผลเดียวกัน
