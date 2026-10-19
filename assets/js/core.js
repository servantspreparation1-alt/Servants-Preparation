/* =====================================================================
   اعداد خدام ادمن — النواة المشتركة (core)
   • الوضع الليلي / النهاري
   • تشفير كلمات السر وفتحها لإدارة السيستم فقط
   • أدوات عامة (تجزئة، تحقق، أدوات نصية)
   بتتحمّل في كل الصفحات قبل أي سكربت تاني.
   ===================================================================== */
(function () {
  "use strict";

  const LS_THEME = "e3dad-theme";
  const OWNER = "lucaskayser";          /* اسم مستخدم قديم — للتوافق فقط، مش بيظهر لأي حد */
  const SYSTEM_ADMIN_LABEL = "إدارة السيستم";

  /* ------------------------------ تخزين آمن ------------------------------
     localStorage ممكن يرمي استثناء (وضع خاص / iframe مقيّد / Safari) —
     فبنستخدم غلاف بيرجع لذاكرة مؤقتة بدل ما التطبيق يقع.
  ---------------------------------------------------------------------- */
  const store = (function () {
    let ok = true;
    const mem = {};
    try { localStorage.setItem("__e3t", "1"); localStorage.removeItem("__e3t"); }
    catch (e) { ok = false; }
    const api = {
      ok,
      mem,
      getItem(k) { try { return ok ? localStorage.getItem(k) : (k in mem ? mem[k] : null); } catch (e) { return k in mem ? mem[k] : null; } },
      setItem(k, v) { v = String(v); try { if (ok) localStorage.setItem(k, v); else mem[k] = v; } catch (e) { mem[k] = v; } },
      removeItem(k) { try { if (ok) localStorage.removeItem(k); else delete mem[k]; } catch (e) { delete mem[k]; } },
    };
    return api;
  })();

  /* ------------------------------ أدوات ------------------------------ */
  const uid = () => "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = (n) => (n || "خ").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
  const today = () => new Date().toISOString().slice(0, 10);
  const isLucasOwner = (u) => !!u && (
    u.systemAdmin === true ||
    String(u.username || "").toLowerCase() === OWNER ||
    String(u.id || "").toLowerCase() === "idlucas0001"
  );
  /** الاسم اللي بيظهر للناس بدل أي اسم شخصي */
  const isSystemAdmin = isLucasOwner;
  const toArabicDigits = (n) => String(n ?? "").replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
  const arNum = (n) => String(n ?? "").replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);

  /* ------------------------------ التجزئة (SHA-256) ------------------------------ */
  async function hashPassword(pw, salt) {
    const txt = (salt || "") + "::" + pw;
    try {
      if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest("SHA-256", utf8.enc(txt));
        return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch (e) {}
    return fallbackHash(pw, salt);
  }
  function fallbackHash(pw, salt) {
    const txt = (salt || "") + "::" + pw;
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < txt.length; i++) {
      const c = txt.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    return "fb" + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }
  async function verifyPassword(pw, username, stored) {
    if (!stored) return false;
    if ((await hashPassword(pw, username)) === stored) return true;
    return fallbackHash(pw, username) === stored;
  }

  /* ------------------------------ تنظيف المستخدمين ------------------------------ */
  function cleanUsers(users) {
    const list = Array.isArray(users)
      ? users
      : users && typeof users === "object"
      ? Object.keys(users).map((k) => {
          const u = users[k];
          return u && typeof u === "object" ? { ...u, id: u.id || k } : u;
        })
      : [];
    return list
      .map((u) => {
        if (typeof u === "string") { try { u = JSON.parse(u); } catch (e) { return null; } }
        if (!u || typeof u !== "object" || Array.isArray(u)) return null;
        const v = { ...u };
        if (v.password) v.passHash = fallbackHash(String(v.password), String(v.username || "").toLowerCase());
        delete v.password;
        if (isLucasOwner(v)) {
          /* حساب إدارة السيستم: ثابت، مخفي، ومن غير أي اسم شخصي */
          v.systemAdmin = true;
          v.displayName = SYSTEM_ADMIN_LABEL;
          v.active = true;
          v.hidden = false;
          v.role = "amin";
          v.scopeYears = [];
          delete v.phone;
        }
        return v;
      })
      .filter(Boolean);
  }

  /* =====================================================================
     خزنة كلمات السر (Secrets Vault)
     الفكرة: تشفير غير متماثل — عشان أي حد يقدر "يقفل" كلمة سر،
     لكن إدارة السيستم فقط هو اللي يقدر "يفتحها".

     • RSA-OAEP 2048  → المفتاح العام بيتخزن في قاعدة البيانات (مفتوح، مش سر).
     • المفتاح الخاص بيتخزن مشفّر بـ AES-GCM، ومفتاحه بيتولّد من كلمة سر إدارة السيستم.
     • يعني: أمين إعداد الخدام يقدر يعيّن كلمة سر جديدة (بتتقفل بالمفتاح العام)،
       لكن ميقدرش يقرأها. إدارة السيستم بس هو اللي يقدر يقرأها.
     ===================================================================== */
  const VAULT_VERSION = 1;
  const PBKDF2_ITER = 200000;

  const b64 = {
    enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
    dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  };
  const subtle = () => {
    if (!window.crypto || !crypto.subtle) throw new Error("المتصفح مش بيدعم التشفير — لازم HTTPS أو localhost و متصفح حديث");
    return crypto.subtle;
  };

  /* ترميز/فك ترميز UTF-8 — مع بديل لو المتصفح/البيئة مش فيها TextEncoder */
  const utf8 = {
    enc(str) {
      const TE = window.TextEncoder;
      if (TE) return new TE().encode(String(str));
      const bin = unescape(encodeURIComponent(String(str)));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    dec(buf) {
      const TD = window.TextDecoder;
      if (TD) return new TD().decode(buf);
      const b = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
      return decodeURIComponent(escape(bin));
    },
  };

  const newSalt = () => b64.enc(crypto.getRandomValues(new Uint8Array(16)));

  async function deriveWrapKey(password, saltB64) {
    const base = await subtle().importKey("raw", utf8.enc(String(password)), "PBKDF2", false, ["deriveKey"]);
    return subtle().deriveKey(
      { name: "PBKDF2", salt: b64.dec(saltB64), iterations: PBKDF2_ITER, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }
  async function aesSeal(plain, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, utf8.enc(String(plain)));
    return { iv: b64.enc(iv), ct: b64.enc(ct) };
  }
  async function aesOpenRaw(blob, key) {
    if (!blob || !blob.ct || !blob.iv) return null;
    return subtle().decrypt({ name: "AES-GCM", iv: b64.dec(blob.iv) }, key, b64.dec(blob.ct));
  }
  async function aesOpen(blob, key) {
    const raw = await aesOpenRaw(blob, key);
    return raw ? utf8.dec(raw) : null;
  }

  /** تجهيز خزنة جديدة — بترجع بيانات عامة تتخزن في الإعدادات */
  async function createVault(ownerPassword) {
    const kp = await subtle().generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true, ["encrypt", "decrypt"]
    );
    const pubRaw = await subtle().exportKey("spki", kp.publicKey);
    const privRaw = await subtle().exportKey("pkcs8", kp.privateKey);
    const salt = newSalt();
    const wrapKey = await deriveWrapKey(ownerPassword, salt);
    const privIv = crypto.getRandomValues(new Uint8Array(12));
    const privCt = await subtle().encrypt({ name: "AES-GCM", iv: privIv }, wrapKey, privRaw);
    return {
      v: VAULT_VERSION,
      salt,
      pub: b64.enc(pubRaw),
      priv: { iv: b64.enc(privIv), ct: b64.enc(privCt) },
      createdAt: new Date().toISOString(),
    };
  }

  /** فتح المفتاح الخاص بكلمة سر إدارة السيستم */
  async function unlockVault(vaultMeta, ownerPassword) {
    if (!vaultMeta || !vaultMeta.priv) throw new Error("مفيش خزنة متسجلة على الجهاز");
    const wrapKey = await deriveWrapKey(ownerPassword, vaultMeta.salt);
    let privRaw;
    try { privRaw = await aesOpenRaw(vaultMeta.priv, wrapKey); }
    catch (e) { throw new Error("كلمة سر إدارة السيستم غلط — مفتاح الخزنة مش بيفتح"); }
    if (!privRaw) throw new Error("مفيش مفتاح خاص متسجل");
    return subtle().importKey("pkcs8", privRaw, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["decrypt"]);
  }

  /** إعادة تأمين نفس المفتاح الخاص بكلمة سر جديدة */
  async function rekeyVault(meta, oldPassword, newPassword) {
    if (!meta || !meta.priv) throw new Error("مفيش خزنة متسجلة");
    const wrapOld = await deriveWrapKey(oldPassword, meta.salt);
    let privRaw;
    try { privRaw = await aesOpenRaw(meta.priv, wrapOld); }
    catch (e) { throw new Error("كلمة السر الحالية غلط — مفتاح الخزنة مش بيفتح"); }
    const salt = newSalt();
    const wrapNew = await deriveWrapKey(newPassword, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle().encrypt({ name: "AES-GCM", iv }, wrapNew, privRaw);
    return { ...meta, salt, priv: { iv: b64.enc(iv), ct: b64.enc(ct) }, rotatedAt: new Date().toISOString() };
  }

  /** قفل كلمة سر بالمفتاح العام (متاح لأي حساب إداري) */
  async function sealWithPublic(pubB64, plain) {
    const key = await subtle().importKey("spki", b64.dec(pubB64), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const ct = await subtle().encrypt({ name: "RSA-OAEP" }, key, utf8.enc(String(plain)));
    return { v: VAULT_VERSION, ct: b64.enc(ct) };
  }
  /** فتح كلمة سر بالمفتاح الخاص (إدارة السيستم فقط) */
  async function openWithPrivate(privKey, blob) {
    if (!blob || !blob.ct) return null;
    const pt = await subtle().decrypt({ name: "RSA-OAEP" }, privKey, b64.dec(blob.ct));
    return utf8.dec(pt);
  }

  /* =====================================================================
     الوضع الليلي / النهاري
     ===================================================================== */
  const THEME_COLOR = { light: "#f8f8f3", dark: "#0e1622" };
  const theme = {
    get() {
      try { const t = store.getItem(LS_THEME); if (t === "dark" || t === "light") return t; } catch (e) {}
      return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    },
    apply(t, animate) {
      const html = document.documentElement;
      if (animate) { html.classList.add("theme-anim"); setTimeout(() => html.classList.remove("theme-anim"), 320); }
      html.setAttribute("data-theme", t);
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", THEME_COLOR[t] || THEME_COLOR.light));
      document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
        const dark = t === "dark";
        b.setAttribute("aria-pressed", String(dark));
        b.title = dark ? "الوضع النهاري" : "الوضع الليلي";
        const ic = b.querySelector(".tico"); if (ic) ic.textContent = dark ? "☀️" : "🌙";
        const lb = b.querySelector(".tlabel"); if (lb) lb.textContent = dark ? "نهاري" : "ليلي";
      });
      window.dispatchEvent(new CustomEvent("e3:theme", { detail: { theme: t } }));
    },
    set(t, animate = true) { try { store.setItem(LS_THEME, t); } catch (e) {} theme.apply(t, animate); },
    toggle() { theme.set(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"); },
    init() {
      theme.apply(theme.get(), false);
      if (window.matchMedia) {
        const mq = matchMedia("(prefers-color-scheme: dark)");
        const onChange = () => { try { if (!store.getItem(LS_THEME)) theme.apply(theme.get(), true); } catch (e) {} };
        mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener && mq.addListener(onChange);
      }
      document.addEventListener("click", (e) => {
        const b = e.target.closest("[data-theme-toggle]");
        if (b) { e.preventDefault(); theme.toggle(); }
      });
    },
  };

  /* =====================================================================
     تصدير
     ===================================================================== */
  window.E3 = {
    VERSION: "3.0.0",
    OWNER_USERNAME: OWNER,
    SYSTEM_ADMIN_LABEL,
    DB_KEY: "e3dad_khoddam_db_v1",
    SESSION_KEY: "e3dad_khoddam_session_v1",
    OWNER_SESSION_MS: 7 * 24 * 3600 * 1000,
    SESSION_MS: 12 * 3600 * 1000,
    theme, store,
    vault: {
      newSalt, createVault, unlockVault, rekeyVault, sealWithPublic, openWithPrivate, b64,
      canSeal: (u) => !!(u && u.passSealed && u.passSealed.ct),
      /** المفتاح العام — متاح لكل الحسابات (بيتقفل بيه) */
      pub: null,
      /** المفتاح الخاص — في الذاكرة بس، وبيتمسح مع أي إعادة تحميل */
      privKey: null,
      loadMeta(settings) { if (settings && settings.vault && settings.vault.pub) E3.vault.pub = settings.vault.pub; },
      async seal(plain) {
        if (!E3.vault.pub) throw new Error("مفيش مفتاح خزنة على الجهاز");
        return sealWithPublic(E3.vault.pub, plain);
      },
      async open(blob) {
        if (!E3.vault.privKey) throw new Error("الخزنة مقفولة");
        return openWithPrivate(E3.vault.privKey, blob);
      },
    },
    uid, esc, initials, today, isLucasOwner, isSystemAdmin, cleanUsers, arNum, toArabicDigits,
  };

  /* دوال عامة للتوافق مع الكود القديم */
  window.uid = window.uid || uid;
  window.esc = window.esc || esc;
  window.initials = window.initials || initials;
  window.today = window.today || today;
  window.hashPassword = window.hashPassword || hashPassword;
  window.fallbackHash = window.fallbackHash || fallbackHash;
  window.verifyPassword = window.verifyPassword || verifyPassword;
  window.isLucasOwner = window.isLucasOwner || isLucasOwner;
  window.isSystemAdmin = window.isSystemAdmin || isSystemAdmin;
  /** الاسم الظاهر لأي حساب — إدارة السيستم دايمًا من غير أي اسم شخصي */
  window.displayNameOf = function (u) {
    if (!u) return "";
    if (isLucasOwner(u)) return SYSTEM_ADMIN_LABEL;
    return u.displayName || u.username || "";
  };
  /** أفاتار: درع لإدارة السيستم، وإلا الصورة أو الحروف */
  window.avatarOf = function (u, escFn) {
    if (!u) return '<span>؟</span>';
    if (u.photo) return '<img src="' + u.photo + '" alt="">';
    if (isLucasOwner(u)) return '<span aria-label="إدارة السيستم">🛡️</span>';
    const ini = initials(u.displayName || u.username || "خ");
    return '<span>' + (escFn ? escFn(ini) : ini) + '</span>';
  };
  window.cleanUsers = window.cleanUsers || cleanUsers;
  window.toArabicDigits = window.toArabicDigits || toArabicDigits;
})();
