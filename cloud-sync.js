/* =====================================================================
   cloud-sync.js — مزامنة حقيقية مع Firebase Realtime Database
   =====================================================================
   • بتقرأ الحسابات من:
       {BASE}/users.json      (كل مستخدم كمفتاح باسم المستخدم)
     وبتقرأ البيانات من:
       {BASE}/val/{students,activityLog,attendanceSessions,tasks,templates,settings}
     وكل قيمة فيها نص JSON (زي ما النسخة الأصلية كانت بتخزّن).
   • pushUsers بيستخدم PATCH لكل حساب (مش بيستبدل القاعدة كلها).
   • لو الشبكة وقعت، البرنامج بيكمل شغل على localStorage وبيرفع أول ما يرجع.
   ===================================================================== */
(function () {
  "use strict";

  const DEFAULT_BASE = "https://servants-preparation-108f3-default-rtdb.europe-west1.firebasedatabase.app/ekhdam";
  const KEY_URL = "e3dad-cloud-url";

  /* مفتاح إيقاف المزامنة (للاختبار أو لو حبيت تشتغل أوفلاين) */
  const isOff = () => {
    try {
      return localStorage.getItem("e3dad-cloud-off") === "1" || /(\?|&)nosync=1/.test(location.search);
    } catch (e) { return false; }
  };

  const getBase = () => {
    try { return (localStorage.getItem(KEY_URL) || DEFAULT_BASE).replace(/\/+$/, ""); }
    catch (e) { return DEFAULT_BASE; }
  };

  let dbKey = "e3dad_khoddam_db_v1";
  let onRemote = null;
  let timer = null;
  let pushing = false;
  let pending = false;
  let lastRemoteSig = "";
  const knownRemote = new Set();      /* أسماء المستخدمين اللي شفناها على السحابة */

  /* ------------------------------ أدوات ------------------------------ */
  const j = async (url, opts) => {
    const res = await fetch(url, Object.assign({ cache: "no-store" }, opts || {}));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  };
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(dbKey) || "null"); } catch (e) { return null; } };
  const writeLocal = (db) => { try { localStorage.setItem(dbKey, JSON.stringify(db)); } catch (e) {} };
  const parseLoose = (v, fallback) => {
    if (v == null) return fallback;
    if (typeof v !== "string") return v;
    try { return JSON.parse(v); } catch (e) { return fallback; }
  };
  const safeBase64 = () => (typeof btoa === "function" ? btoa(unescape(encodeURIComponent(getBase()))).slice(-12) : "x");

  /* --------------------- تحويل بين الشكلين --------------------- */
  function remoteUserToLocal(key, r) {
    r = r || {};
    return {
      remoteKey: String(key),
      id: r.id || ("id" + String(key).toLowerCase()),
      displayName: r.name || key,
      username: String(key).toLowerCase(),
      phone: r.phone || "",
      photo: r.photoUrl || "",
      role: r.role || "khadem",
      permissions: Array.isArray(r.permissions) ? r.permissions : [],
      scopeYears: Array.isArray(r.scopeYears) ? r.scopeYears : [],
      active: r.disabled !== true,
      createdAt: r.addedAt || "",
      lastLogin: r.lastLogin || "",
      passHash: r.passHash || "",
      passSealed: r.passSealed || null,
      passSealedAt: r.passSealedAt || null,
      mustChangePassword: !!r.mustChangePassword,
      systemAdmin: !!r.systemAdmin,
    };
  }

  function localUserToRemote(u) {
    return {
      addedAt: u.createdAt || "",
      disabled: u.active === false,
      id: u.id || "",
      lastLogin: u.lastLogin || "",
      name: u.displayName || u.username || "",
      passHash: u.passHash || "",
      permissions: u.permissions || [],
      phone: u.phone || "",
      photoUrl: u.photo || "",
      role: u.role || "khadem",
      scopeYears: u.scopeYears || [],
      passSealed: u.passSealed || null,
      passSealedAt: u.passSealedAt || null,
      mustChangePassword: !!u.mustChangePassword,
      systemAdmin: !!u.systemAdmin,
    };
  }

  const isSeedish = (u) => !!u && (u.username === "admin" || u.username === "lucaskayser");

  /* دمج: السحابة هي المصدر للحسابات، مع الاحتفاظ بحسابات محلية مش موجودة عليها.
     الحساب الافتراضي اللي بيتزرع أول مرة (ولو لسه محدش دخل بيه) بيتشال. */
  function mergeUsers(remoteUsers, localUsers) {
    const local = Array.isArray(localUsers) ? localUsers : [];
    const byName = new Map(local.map((u) => [String(u.username || "").toLowerCase(), u]));
    const remoteNames = new Set();
    const out = remoteUsers.map((ru) => {
      remoteNames.add(ru.username);
      const old = byName.get(ru.username) || null;
      if (!old) return ru;
      const merged = Object.assign({}, ru);
      if (!merged.remoteKey && old.remoteKey) merged.remoteKey = old.remoteKey;
      if (!merged.passSealed && old.passSealed) merged.passSealed = old.passSealed;
      if (!merged.photo && old.photo) merged.photo = old.photo;
      if ((!merged.scopeYears || !merged.scopeYears.length) && old.scopeYears && old.scopeYears.length) merged.scopeYears = old.scopeYears;
      if (!merged.passHash && old.passHash) merged.passHash = old.passHash;
      return merged;
    });
    local.forEach((u) => {
      const name = String(u.username || "").toLowerCase();
      if (remoteNames.has(name)) return;
      if (isSeedish(u) && u.mustChangePassword && !u.lastLogin) return;  /* بذرة النظام الافتراضية */
      out.push(u);
    });
    return out;
  }

  function mergeData(remoteVal, local) {
    const remote = {
      students: parseLoose(remoteVal.students, []),
      activityLog: parseLoose(remoteVal.activityLog, []),
      attendanceSessions: parseLoose(remoteVal.attendanceSessions, []),
      tasks: parseLoose(remoteVal.tasks, []),
      templates: parseLoose(remoteVal.templates, {}),
      settings: parseLoose(remoteVal.settings, {}),
    };
    const localAt = (local && local.settings && local.settings.updatedAt) || 0;
    const remoteAt = (remote.settings && remote.settings.updatedAt) || 0;
    const useRemote = remoteAt >= localAt;
    if (!useRemote) return local;
    return {
      students: remote.students || [],
      activityLog: remote.activityLog || (local && local.activityLog) || [],
      attendanceSessions: remote.attendanceSessions || [],
      tasks: remote.tasks || [],
      templates: (remote.templates && Object.keys(remote.templates).length) ? remote.templates : (local && local.templates) || {},
      settings: Object.assign({}, (local && local.settings) || {}, remote.settings || {}),
    };
  }

  /* ------------------------------ السحب ------------------------------ */
  async function pull() {
    if (isOff()) return { ok: true, disabled: true, changed: false };
    const base = getBase();
    const [usersRaw, valRaw] = await Promise.all([
      j(base + "/users.json"),
      j(base + "/val.json").catch(() => null),
    ]);
    const local = readLocal() || {};
    const remoteUsers = usersRaw && typeof usersRaw === "object"
      ? Object.keys(usersRaw).map((k) => remoteUserToLocal(k, usersRaw[k]))
      : [];

    const before = JSON.stringify({ u: local.users || [] });
    const merged = { ...local };

    if (remoteUsers.length) {
      merged.users = mergeUsers(remoteUsers, local.users);
      knownRemote.clear();
      remoteUsers.forEach((u) => knownRemote.add(u.username));
    }
    if (valRaw) {
      const data = mergeData(valRaw, local);
      merged.students = data.students;
      merged.activityLog = data.activityLog;
      merged.attendanceSessions = data.attendanceSessions;
      merged.tasks = data.tasks;
      merged.templates = data.templates;
      merged.settings = data.settings;
    }

    const changed = JSON.stringify({ u: merged.users || [] }) !== before;
    const sig = JSON.stringify({ u: merged.users || [], s: (merged.students || []).length, t: merged.settings && merged.settings.updatedAt });
    const remoteChanged = !!sig && sig !== lastRemoteSig && lastRemoteSig !== "";
    lastRemoteSig = sig;

    writeLocal(merged);
    return { ok: true, changed, remoteChanged, users: (merged.users || []).length };
  }

  /* ------------------------------ الرفع ------------------------------ */
  async function push() {
    if (pushing) { pending = true; return { ok: false, busy: true }; }
    pushing = true;
    try {
      const base = getBase();
      const db = readLocal();
      if (!db) return { ok: true };
      const users = Array.isArray(db.users) ? db.users : [];
      const writes = users.map((u) => {
        if (!u.username) return Promise.resolve();
        const payload = localUserToRemote(u);
        const key = u.remoteKey || String(u.username).toLowerCase();
        return fetch(base + "/users/" + encodeURIComponent(key) + ".json", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      });
      /* حذف الحسابات اللي اتشالت من عندنا (اللي كنا شايفينها على السحابة قبل كده) */
      const now = new Set(users.map((u) => String(u.remoteKey || u.username || "").toLowerCase()));
      knownRemote.forEach((name) => {
        if (!now.has(name)) {
          writes.push(fetch(base + "/users/" + encodeURIComponent(name) + ".json", { method: "DELETE" }));
          knownRemote.delete(name);
        }
      });
      const val = {
        students: JSON.stringify(db.students || []),
        activityLog: JSON.stringify((db.activityLog || []).slice(0, 300)),
        attendanceSessions: JSON.stringify(db.attendanceSessions || []),
        tasks: JSON.stringify(db.tasks || []),
        templates: JSON.stringify(db.templates || {}),
        settings: JSON.stringify(db.settings || {}),
      };
      writes.push(fetch(base + "/val.json", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(val),
      }));
      await Promise.all(writes);
      const fresh = readLocal();
      if (fresh && Array.isArray(fresh.users)) {
        let touched = false;
        fresh.users.forEach((u) => {
          if (u && u.username && !u.remoteKey) { u.remoteKey = String(u.username).toLowerCase(); touched = true; }
        });
        if (touched) writeLocal(fresh);
      }
      knownRemote.clear();
      (users || []).forEach((u) => knownRemote.add(String(u.remoteKey || u.username || "").toLowerCase()));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      pushing = false;
      if (pending) { pending = false; setTimeout(push, 800); }
    }
  }

  let pushTimer = null;
  function queuePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { push(); }, 1200);
  }

  async function sync() {
    try {
      const r = await pull();
      if (r.remoteChanged && onRemote) onRemote();
      return r;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** الحسابات اللي على الجهاز ومش موجودة على القاعدة */
  function pendingLocalUsers() {
    const db = readLocal() || {};
    return (db.users || []).filter((u) => u && u.username && !u.remoteKey &&
      !(isSeedish(u) && u.mustChangePassword && !u.lastLogin));
  }

  /** رفع كل حاجة ثم سحب — لزرار «مزامنة الآن» */
  async function syncNow() {
    const p = await push();
    const l = await pull();
    return { ok: !!(p && p.ok), pushed: p, pulled: l };
  }

  /** تحديث وقت آخر دخول على القاعدة (حقل واحد بس) */
  async function touchLogin(username, lastLogin) {
    if (isOff() || !username) return false;
    try {
      const db = readLocal() || {};
      const u = (db.users || []).find((x) => String(x.username).toLowerCase() === String(username).toLowerCase());
      /* بنحدّث وقت الدخول للحسابات الموجودة على القاعدة بس — مش بنكريت حساب جديد بالغلط */
      if (!u || !u.remoteKey) return false;
      const key = u.remoteKey;
      const res = await fetch(getBase() + "/users/" + encodeURIComponent(key) + "/lastLogin.json", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(String(lastLogin || "")),
      });
      return res.ok;
    } catch (e) { return false; }
  }

  const E3Cloud = {
    enabled: true,
    get url() { return getBase(); },
    set url(v) { try { localStorage.setItem(KEY_URL, String(v || "").trim()); } catch (e) {} },
    init(opts) {
      if (opts && opts.dbKey) dbKey = opts.dbKey;
      if (isOff()) { console.info("[E3Cloud] المزامنة متوقفة على الجهاز ده"); return; }
      if (opts && opts.onRemote) onRemote = opts.onRemote;
      if (opts && opts.url) E3Cloud.url = opts.url;
      sync().catch(() => {});
      clearInterval(timer);
      timer = setInterval(() => { if (navigator.onLine) sync().catch(() => {}); }, 25000);
      window.addEventListener("online", () => { sync().catch(() => {}); });
      window.addEventListener("focus", () => { if (navigator.onLine) sync().catch(() => {}); });
      console.info("[E3Cloud] مزامنة Firebase مفعّلة:", getBase());
    },
    sync, pull, push, queuePush, syncNow, touchLogin,
    pendingLocalUsers,
    status() {
      const db = readLocal() || {};
      const users = db.users || [];
      return {
        enabled: !isOff(),
        url: getBase(),
        users: users.length,
        pending: pendingLocalUsers().length,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      };
    },
    /* أدوات للحساب من خارج الواجهة */
    async setUserPassword(username, passHash) {
      const base = getBase();
      const res = await fetch(base + "/users/" + encodeURIComponent(String(username).toLowerCase()) + "/passHash.json", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(passHash),
      });
      return res.ok;
    },
  };

  window.E3Cloud = E3Cloud;
})();
