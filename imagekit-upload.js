/* =====================================================================
   imagekit-upload.js — رفع صور الدارسين والخدام والشعار إلى ImageKit
   =====================================================================
   • بيجيب توقيع مؤقت من /api/imagekit-auth (السيرفر)
   • بيرفع على https://upload.imagekit.io/api/v1/files/upload
   • بيرجّع رابط الصورة (URL) بدل تخزين Base64 الضخم في قاعدة البيانات
   • لو الرفع فشل (أوفلاين / خطأ) — الكود الأصلي بيحتفظ بالنسخة المحلية
   ===================================================================== */
(function () {
  "use strict";

  const AUTH_URL = "/api/imagekit-auth";
  const CONFIG_URL = "/api/imagekit-config";
  const UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";

  const FOLDERS = {
    students: "/e3dad/students", // صور الدارسين
    servants: "/e3dad/servants", // صور الخدام
    logo: "/e3dad/logo",         // شعار / صورة الخدمة
  };

  let cfgCache = null;
  let cfgAt = 0;

  async function getConfig(force) {
    if (!force && cfgCache && Date.now() - cfgAt < 5 * 60 * 1000) return cfgCache;
    const res = await fetch(CONFIG_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("تعذر قراءة إعدادات الرفع (HTTP " + res.status + ")");
    cfgCache = await res.json();
    cfgAt = Date.now();
    return cfgCache;
  }

  async function getAuth() {
    const res = await fetch(AUTH_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("تعذر تجهيز توقيع الرفع (HTTP " + res.status + ")");
    const out = await res.json();
    if (!out || !out.ok || !out.signature || !out.token || !out.expire) {
      throw new Error("توقيع الرفع غير صالح — راجع إعدادات السيرفر");
    }
    return out;
  }

  function folderFor(kind) {
    return FOLDERS[kind] || FOLDERS.students;
  }

  function safeName(kind) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return (
      kind +
      "-" +
      d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) +
      ".jpg"
    );
  }

  /* رفع DataURL (بعد التصغير) إلى ImageKit — بيرجّع {url, fileId, ...} */
  async function uploadDataURL(dataURL, opts) {
    opts = opts || {};
    const kind = opts.kind || "students";

    if (!dataURL || typeof dataURL !== "string") throw new Error("لا توجد صورة للرفع");
    if (!/^data:image\//.test(dataURL) && !/^blob:/.test(dataURL) && !/^https?:\/\//.test(dataURL)) {
      throw new Error("صيغة الصورة غير مدعومة");
    }

    const authP = getAuth();
    const cfgP = getConfig().catch(() => null);
    const [auth] = await Promise.all([authP, cfgP]);

    const fd = new FormData();
    fd.append("file", dataURL);
    fd.append("fileName", opts.fileName || safeName(kind));
    fd.append("folder", folderFor(kind));
    fd.append("publicKey", auth.publicKey);
    fd.append("signature", auth.signature);
    fd.append("expire", String(auth.expire));
    fd.append("token", auth.token);
    fd.append("useUniqueFileName", "true");
    if (opts.tags) fd.append("tags", opts.tags);

    const res = await fetch(UPLOAD_URL, { method: "POST", body: fd });
    let out = null;
    try { out = await res.json(); } catch (e) { out = null; }

    if (!res.ok || !out || !out.url) {
      const msg = (out && (out.message || out.error)) || ("HTTP " + res.status);
      throw new Error("فشل الرفع إلى ImageKit: " + msg);
    }
    return out;
  }

  /* فحص سريع: هل الرفع السحابي شغال؟ */
  async function status() {
    try {
      const cfg = await getConfig(true);
      if (!cfg || !cfg.enabled) {
        return { ok: false, reason: "الإعدادات العامة ناقصة على السيرفر (Public Key / Endpoint)" };
      }
      const auth = await getAuth();
      if (!auth || !auth.ok) return { ok: false, reason: "توقيع الرفع غير متاح" };
      return { ok: true, urlEndpoint: cfg.urlEndpoint || "" };
    } catch (e) {
      return { ok: false, reason: (e && e.message) || "خطأ غير معروف" };
    }
  }

  window.E3ImageKit = {
    getConfig,
    getAuth,
    uploadDataURL,
    folderFor,
    status,
  };
})();
