# Grant Receipt Assistant — one-shot rebuild (Module 2, การบ้านที่ 4)

🌐 **Live app:** _(ใส่ URL หลัง deploy จริง — ต้องอยู่บรรทัดบนสุดของไฟล์นี้)_
📋 **ผลทดสอบ:** _(ใส่ลิงก์ `test-results.md` หลังทดสอบเสร็จ)_

## นี่คือโฟลเดอร์อะไร

โปรเจกต์ `Grant Receipt Assistant` เดิม (โฟลเดอร์ข้าง ๆ) ทำเสร็จไปแล้วแบบทยอยสร้างทีละสัปดาห์
การบ้านสัปดาห์ที่ 9 ([w9-homework.html](https://cnacha-mfu.github.io/raise2-module2/materials/week9/w9-homework.html))
ต้องการให้สั่ง AI **สร้างระบบทั้งระบบแบบทีเดียวจบ** จากสเปกเดียว แล้วทดสอบ 5 ตัว — โฟลเดอร์นี้คือรอบทำใหม่
เรื่องเดิม (หัวข้อเดิม: ตรวจใบเสร็จทุนวิจัย) ด้วยวิธีนั้น

`grant-receipt-assistant-spec.md` ในโฟลเดอร์นี้คือสเปกที่รวม `SCOPE.md` เดิมเข้ากับสถานะจริงของโค้ด
เดิม (อ่านจาก `CLAUDE.md`/`ACL.md`/`BACKLOG.md` ของโปรเจกต์เดิม แก้ให้ตรงของจริงแล้ว) — เขียนไว้ให้แล้ว
ตามขั้นตอน A.1 ของการบ้าน

## Infra — ใช้ Firebase project เดิม (`grant-receipt-assistant`) แต่คนละ Hosting site

**ตัดสินใจ (2026-09-22):** ใช้ Firebase/GCP project เดียวกับระบบเดิม แทนการสร้างใหม่ เพื่อใช้ Google
Drive OAuth Client ที่ตั้งค่าไว้แล้ว (`748022324743-...apps.googleusercontent.com`) ซ้ำได้เลย ไม่ต้องทำ
ขั้นตอน enable Drive API + สร้าง OAuth consent screen + client ใหม่ทั้งหมด

- **Hosting site ใหม่ (คนละอันกับเว็บเดิม):** `gra-oneshot` → https://gra-oneshot.web.app (ตั้งค่าผ่าน
  `firebase target:apply hosting oneshot gra-oneshot`, `firebase.json` ใช้ `"target": "oneshot"`) — เว็บ
  เดิม `https://grant-receipt-assistant.web.app` ไม่ถูกแตะต้อง
- **Firestore เป็นฐานข้อมูลเดียวกับระบบเดิม** (Firestore ผูกกับ project ไม่ใช่กับ Hosting site) —
  `firestore.rules`/`firestore.indexes.json` ในโฟลเดอร์นี้เป็น **ของเดิมทุกบรรทัด + เพิ่มแค่
  `budgetItems`** ห้ามลบ/แก้ส่วนที่เหลือโดยไม่จำเป็น เพราะ deploy แล้วจะกระทบเว็บเดิมด้วย — ข้อมูลอ้างอิง
  กลาง (`fundSources`/`ruleItems`/`documentTypes`/`evidenceChains`) จริง ๆ **น่าจะมีอยู่แล้ว**ใน Firestore
  จากระบบเดิม ให้ตรวจสอบก่อนว่ามีครบตรงตามสเปกหัวข้อ 3.1 หรือยัง แทนที่จะ seed ทับโดยไม่เช็คก่อน
  (ถ้ามีอยู่แล้วตรงกันก็ไม่ต้อง seed ซ้ำ)
- **ต้องเพิ่ม authorized JavaScript origin ใหม่ใน Google Cloud Console** (บัญชี Google เดียวกับที่สร้าง
  OAuth Client เดิม): เปิด https://console.cloud.google.com/apis/credentials?project=grant-receipt-assistant
  → แก้ OAuth 2.0 Client ID ที่ใช้อยู่ → เพิ่ม `https://gra-oneshot.web.app` เข้า **Authorized JavaScript
  origins** — ไม่ทำขั้นนี้ ปุ่ม "เชื่อมต่อ Google Drive" บนเว็บใหม่จะเชื่อมไม่ได้ (คนละ origin กับที่
  client อนุญาตไว้)
- **Deploy Firestore rules/indexes ต้องขอยืนยันจากคนก่อนเสมอ** เพราะกระทบเว็บ production เดิมที่มีผู้ใช้
  จริงอยู่ (ไม่ใช่ project ทดสอบเปล่า ๆ) — ดูข้อห้ามเดียวกันใน `.claude/agents/data-rules-engineer.md`

## ขั้นตอนถัดไป (ตาม w9-homework.html)

1. เปิด Claude Code ในโฟลเดอร์นี้ สั่งให้อ่าน `grant-receipt-assistant-spec.md` แล้วสรุปกลับมา —
   ถ้าสรุปไม่ตรง แก้สเปกก่อน
2. ให้ AI เสนอแผนทีมผู้ช่วย 3 ตัว (โมเดลต่างกัน คนละหน้าที่ มีข้อห้ามชัดเจน) — **ตรวจแผนก่อนสั่งสร้างจริง**
3. สั่งสร้างระบบทีเดียวจบตามสเปก → deploy จริง (Firebase Hosting + Firestore)
4. ขอแผนทดสอบ 5 ตัว (อ่านแล้วตอบว่าขาดอะไรก่อนรัน) → รันเทสต์ **ห้ามแก้โค้ดแค่ให้เทสต์ผ่าน**
5. เขียน `test-results.md` และ `BACKLOG.md` → เช็คไม่มีคีย์ AI หลุดใน git → เขียน URL ไว้บรรทัดบนสุดของ
   README นี้ → ส่ง URL repo เดียวใน Google Classroom

## เกณฑ์ผ่าน (คัดจากการบ้าน)

1. Deploy ออนไลน์ + Firestore จริง
2. ข้อมูลไม่รั่วข้ามบัญชี (พิสูจน์ด้วยเทสต์ความปลอดภัย)
3. ผู้ช่วย 3 ตัวคนละโมเดล + ไม่มีคีย์ AI หลุด
4. เทสต์ 5 ตัวผ่าน
5. อธิบายระบบตัวเองได้ (ตอบไม่ได้ = ไม่ผ่าน)
6. ของส่งครบ 5 รายการ เปิดดูได้ใน repo
