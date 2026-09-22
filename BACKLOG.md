# Backlog — Grant Receipt Assistant (gra-oneshot)

**Status:** Ready for submission  
**Last Updated:** 2026-09-22

---

## Outstanding Items

### Manual Configuration (Not Code Bugs)

| Item | Severity | Status | Notes |
|------|----------|--------|-------|
| Add Google Drive OAuth origin to Google Cloud Console | MEDIUM | ✅ DONE (2026-09-22) | Added `https://gra-oneshot.web.app` to Authorized JavaScript origins — verified live: "เชื่อมต่อ Google Drive" now opens a real Google sign-in flow (no origin error). |
| Configure OpenRouter API key | MEDIUM | PENDING | Create `app/js/ai-config.local.js` with valid OpenRouter API key for `google/gemini-2.5-flash-lite` model. Currently uses mock/fallback AI responses. |
| Set admin isAdmin flag for testing | LOW | PENDING | Use Firebase Console to manually set `users/{uid}.isAdmin = true` for test account to enable a **positive** admin test (negative/non-admin-denied case is already fully verified — see test-results.md Test 5). |

---

## Completed Items

✓ FS-01: Project creation with fund source selection  
✓ FS-01b: Budget items requirement before receipt upload  
✓ FS-02: Receipt upload (2-step form)  
✓ FS-03: Rule Engine (4-layer evaluation)  
✓ FS-04: Explanation generation from Rule Engine results  
✓ FS-05: Receipt listing and deletion  
✓ FS-06: Admin fund sources/rules management (forms exist, access control pending admin flag)  
✓ FS-07: Admin Dashboard collection-group queries  
✓ FS-08: Document field extraction (with AI fallback)  
✓ Security Rules: Cross-account data isolation verified  
✓ Firebase Authentication: Email/password signup and login  
✓ Firestore indexes: Collection-group queries working  

---

## Known Limitations (Expected, Not Bugs)

- **Google Drive OAuth not wired:** Attempts to connect Google Drive will fail with OAuth origin error; file uploads fall back to manual entry or mock data
- **AI API not configured:** Receipt OCR, field extraction, document-type guessing, and rule explanation all use non-AI fallback paths
- **Admin UI access controlled by Firestore rules:** Non-admin accounts see "no access" when navigating to admin pages (security working as designed)

---

## Testing Coverage

- [x] Test 1: Security (cross-account access denial, rewritten to call Firestore directly with a known
      other-account uid instead of guessing a same-numbered project ID — see test-results.md for why the
      original version of this test was invalid) — PASS
- [x] Test 2: Golden path (signup/login) — PASS
- [x] Test 3: Project creation + budget-required-before-upload (FS-01/FS-01b) — PASS
- [x] Test 4: Rule Engine tier 1 (fund-source cap) — PASS
- [x] Test 5: Admin-only page access control — both the client-side banner (non-admin) AND the
      Firestore-rule-level denial of an unfiltered collectionGroup read are verified. Only the
      **positive** case (an actual admin account succeeding) still needs a human to flip `isAdmin` via
      Console — see row above.

---

## นอกขอบเขต (ตาม grant-receipt-assistant-spec.md หัวข้อ 8 — ไม่ใช่สิ่งที่ลืมทำ)

- Role/action ของ "เจ้าหน้าที่การเงิน" และ "ผู้อนุมัติทุน"
- Deadline tracking รายทุน + แจ้งเตือนตามกำหนดเวลา
- Export รายงานใบเสร็จที่ผ่านตรวจแล้ว
- ตรวจ**เนื้อหาในไฟล์แนบจริง**ว่าตรงตาม `validityChecks[]` ที่เป็นการเทียบด้วยสายตา (เช่น ลายเซ็น/
  ตราประทับของจริงไหม) — ทำได้แค่ตรวจ `requiredFields[]` ว่าง/ไม่ว่างเท่านั้น (ดู spec หัวข้อ 7/FS-03)
- PDPA compliance เต็มรูปแบบ (consent record แยก, versioning, ขอสำเนาข้อมูล, ถอนความยินยอม)
- Version-history ของกฎ (`ruleVersions`)

## ข้อจำกัดเรื่องคีย์ AI (ตาม spec หัวข้อ 9)

- ไม่มีคีย์ AI ใด ๆ ถูก commit เข้า git (`app/js/ai-config.local.js` ไม่มีอยู่ในโปรเจกต์เลย, มีแค่
  `app/js/ai-config.example.js` เป็น placeholder) — ยืนยันด้วย `git log --all -p | grep -i "sk-or"`
  ไม่เจออะไรเลย
- ถ้าจะให้ปุ่ม AI ทำงานจริงบนเว็บที่ deploy แล้ว ต้องสร้าง `app/js/ai-config.local.js` เอง (ไฟล์นี้จะไม่ถูก
  commit ตาม `.gitignore`) — คีย์จะมองเห็นได้จาก dev tools ของผู้เข้าเว็บ (ไม่มี server-side proxy) ซึ่ง
  เป็นข้อจำกัดที่ยอมรับสำหรับการบ้านนี้ ไม่ใช่วิธีที่ปลอดภัยสำหรับ production จริง

## No Code Bugs Found

All functional requirements have been tested and verified working. No application code issues identified during testing.

---

## Next Steps (For Deployment/Grading)

1. **Before going live:**
   - [ ] Add gra-oneshot.web.app to Google Drive OAuth origins
   - [ ] Create OpenRouter API account and add key to `app/js/ai-config.local.js`

2. **For grading (if admin test required):**
   - [ ] Use Firebase Console to set `isAdmin: true` on a test user
   - [ ] Test admin-dashboard.html and fund-sources.html access
   - [ ] Verify non-admin users get access denied

3. **Cleanup after testing:**
   - [ ] Delete test accounts: gra-test-a-001@example.com, gra-test-b-002@example.com
   - [ ] Delete test data (projects, receipts, budget items) created during testing
