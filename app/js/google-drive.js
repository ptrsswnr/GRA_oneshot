// ─────────────────────────────────────────────────────────────
// js/google-drive.js — อัปโหลดไฟล์แนบใบเสร็จขึ้น Google Drive (แทน Firebase Storage)
// Firebase Storage ไม่ได้ provision ไว้ (ต้องอัปเกรด Blaze plan ก่อน — ดู spec หัวข้อ 0.2) จึงใช้
// Google Drive ของผู้ใช้เอง — auth คนละชั้นกับ Firebase Auth: ผู้ใช้ต้องกดปุ่ม "เชื่อมต่อ Google
// Drive" เพื่อ authorize บัญชี Google ของตัวเอง (Google Identity Services, scope drive.file — แอป
// เห็นเฉพาะไฟล์ที่แอปสร้างเอง ไม่ใช่ทั้งไดรฟ์) แยกจากการล็อกอินแอปด้วย Firebase email/password อีกที
// ต้องโหลด https://accounts.google.com/gsi/client ก่อนไฟล์นี้
//
// ใช้ OAuth Client ID เดียวกับระบบเดิม (โปรเจกต์ GCP เดียวกัน — ดู README.md หัวข้อ Infra) แทนที่จะ
// สร้าง client ใหม่ — ต้องเพิ่ม origin ของเว็บนี้ (https://gra-oneshot.web.app) เข้า "Authorized
// JavaScript origins" ของ client นี้ที่ Google Cloud Console เองก่อน ไม่งั้นปุ่มเชื่อมต่อจะใช้งาน
// ไม่ได้บนโดเมนนี้ (ดู README.md ขั้นตอนที่ต้องทำเอง)
//
// ข้อจำกัดที่รู้อยู่แล้ว (เหมาะกับการทดลอง/สาธิต ไม่ใช่ของจริงระดับโปรดักชัน):
// - access token มีอายุ ~1 ชั่วโมง ไม่มี refresh token (ไม่มี backend เก็บ) — หมดอายุแล้วต้องกด
//   เชื่อมต่อใหม่
// - ไฟล์ที่อัปโหลดถูกตั้งสิทธิ์ "ทุกคนที่มีลิงก์ดูได้" เพื่อให้ admin dashboard เปิดดูไฟล์ของผู้ใช้
//   คนอื่นได้
// - ลบใบเสร็จ (receipts.js) ไม่ได้ลบไฟล์จริงใน Drive ด้วย (ลบแค่เอกสารอ้างอิงใน Firestore)
// ─────────────────────────────────────────────────────────────

var GOOGLE_DRIVE_CLIENT_ID = "748022324743-oov00vjndmbjhqj96qioluakek2u7fi2.apps.googleusercontent.com";
var GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
var GOOGLE_DRIVE_ROOT_FOLDER_NAME = "Grant Receipt Assistant (oneshot)";

var driveAccessToken = null;
var driveTokenExpiresAt = 0;
var driveTokenClient = null;
var driveRootFolderIdCache = null;

function getDriveTokenClient() {
  if (!driveTokenClient) {
    driveTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_DRIVE_CLIENT_ID,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: function () {},
    });
  }
  return driveTokenClient;
}

function requestDriveAccessToken() {
  return new Promise(function (resolve, reject) {
    var client = getDriveTokenClient();
    client.callback = function (response) {
      if (response.error) {
        reject(new Error("เชื่อมต่อ Google Drive ไม่สำเร็จ: " + response.error));
        return;
      }
      driveAccessToken = response.access_token;
      driveTokenExpiresAt = Date.now() + (response.expires_in - 60) * 1000;
      resolve(driveAccessToken);
    };
    client.requestAccessToken({ prompt: driveAccessToken ? "" : "consent" });
  });
}

// เรียกจากปุ่ม "เชื่อมต่อ Google Drive" เท่านั้น (ต้องมาจาก user gesture ตรงๆ ไม่งั้น popup โดนบล็อก)
window.googleDriveConnect = function () {
  return requestDriveAccessToken();
};

window.googleDriveIsConnected = function () {
  return !!driveAccessToken && Date.now() < driveTokenExpiresAt;
};

async function driveApiFetch(url, options) {
  options = options || {};
  options.headers = Object.assign({ Authorization: "Bearer " + driveAccessToken }, options.headers || {});
  var res = await fetch(url, options);
  if (!res.ok) {
    var body = await res.text();
    throw new Error("Google Drive API error " + res.status + ": " + body);
  }
  return res.json();
}

async function ensureFolder(name, parentId) {
  var q = "name='" + name.replace(/'/g, "\\'") + "' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    + " and '" + (parentId || "root") + "' in parents";
  var listResult = await driveApiFetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) + "&fields=files(id,name)");
  if (listResult.files && listResult.files.length > 0) return listResult.files[0].id;

  var created = await driveApiFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    }),
  });
  return created.id;
}

async function ensureReceiptFolder(receiptId) {
  if (!driveRootFolderIdCache) {
    driveRootFolderIdCache = await ensureFolder(GOOGLE_DRIVE_ROOT_FOLDER_NAME, null);
  }
  return ensureFolder(receiptId, driveRootFolderIdCache);
}

async function uploadFileContent(file, folderId) {
  var metadata = { name: file.name, parents: [folderId] };
  var boundary = "grant-receipt-assistant-" + Date.now();
  var fileContent = await file.arrayBuffer();
  var encoder = new TextEncoder();
  var body = new Blob([
    encoder.encode("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) + "\r\n"),
    encoder.encode("--" + boundary + "\r\nContent-Type: " + (file.type || "application/octet-stream") + "\r\n\r\n"),
    fileContent,
    encoder.encode("\r\n--" + boundary + "--"),
  ]);

  return driveApiFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { "Content-Type": "multipart/related; boundary=" + boundary },
    body: body,
  });
}

async function makeFileViewableByAnyoneWithLink(fileId) {
  await driveApiFetch("https://www.googleapis.com/drive/v3/files/" + fileId + "/permissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
}

// อัปโหลดไฟล์แนบ 1 ไฟล์ของใบเสร็จ receiptId ไปไว้ใต้โฟลเดอร์ "Grant Receipt Assistant (oneshot)/{receiptId}"
// ในไดรฟ์ของผู้ใช้ที่เชื่อมต่อ (googleDriveConnect) — คืนค่า { id, webViewLink }
window.googleDriveUploadReceiptFile = async function (file, receiptId) {
  if (!window.googleDriveIsConnected()) {
    throw new Error("ยังไม่ได้เชื่อมต่อ Google Drive หรือหมดอายุแล้ว — กดปุ่ม \"เชื่อมต่อ Google Drive\" อีกครั้ง");
  }
  var folderId = await ensureReceiptFolder(receiptId);
  var uploaded = await uploadFileContent(file, folderId);
  await makeFileViewableByAnyoneWithLink(uploaded.id);
  return uploaded;
};
