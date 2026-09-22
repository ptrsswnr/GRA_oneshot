// ─────────────────────────────────────────────────────────────
// js/pdf-to-image.js — แปลงหน้าแรกของไฟล์ pdf เป็นรูปภาพ (canvas → PNG) ก่อนส่งให้ js/receipt-ai.js
// อ่าน เพราะ OpenRouter's image_url content type รับแค่รูปภาพ ไม่รับ pdf ตรงๆ — นี่คือ "แปลงไฟล์"
// ไม่ใช่ OCR แยกต่างหาก ตัว AI (vision model) ยังเป็นตัวอ่านตัวหนังสือเหมือนเดิม ใช้ pdf.js จาก CDN
// (ES module — ต้องรันผ่าน http(s), ไม่ใช่ file://, ซึ่งหน้านี้ต้องรันผ่าน http(s) อยู่แล้วเพราะ
// Firestore/Google Drive OAuth ก็ต้องการ http(s) origin เหมือนกัน) — อ่านแค่หน้าแรกของ pdf เท่านั้น
// (เพียงพอสำหรับใบเสร็จ/เอกสารประกอบ 1 หน้าซึ่งเป็นกรณีส่วนใหญ่)
// ─────────────────────────────────────────────────────────────
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.worker.min.mjs";

window.convertPdfFirstPageToImageFile = async function (pdfFile) {
  var arrayBuffer = await pdfFile.arrayBuffer();
  var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  var page = await pdf.getPage(1);
  var viewport = page.getViewport({ scale: 2 });

  var canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;

  var blob = await new Promise(function (resolve) {
    canvas.toBlob(resolve, "image/png");
  });
  return new File([blob], pdfFile.name.replace(/\.pdf$/i, ".png"), { type: "image/png" });
};
