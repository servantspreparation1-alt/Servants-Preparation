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

  /* =====================================================================
     🔐 إعداد المصادقة — Firebase Auth (دخول مجهول Anonymous)
     ---------------------------------------------------------------------
     ليه؟ لأن القاعدة دلوقتي مكشوفة: أي حد يعرف اللينك يقدر يقرأ ويعدّل
     ويمسح كل حاجة (الدارسين، أرقام التليفونات، وكلمات السر).
     الحل: التطبيق بيعمل «دخول مجهول» على Firebase، والقاعدة ترفض أي
     طلب من غير توكن (rules: auth != null).
     • الـ Web API Key مش سري — ده بيبان عادي في أي موقع Firebase.
     • تجيبه من: Firebase Console ⚙️ إعدادات المشروع → Your apps
       → SDK setup and configuration → apiKey
     • لو سايبه فاضي: المزامنة هتشتغل زي الأول (من غير مصادقة) — بس
       القاعدة هتفضل مكشوفة وهنطبع تحذير في الـ Console.
     ===================================================================== */
  const DEFAULT_WEB_API_KEY = "AIzaSyBv2WM1ukqyY9VcfDKjb-5a4RlTXimeEss";   /* Web API Key — مش سري، بيبان في أي موقع Firebase */
  const KEY_FB_API = "e3dad-fb-apikey";
  const KEY_FB_SESSION = "e3dad-fb-session";

  const getApiKey = () => {
    try { return localStorage.getItem(KEY_FB_API) || DEFAULT_WEB_API_KEY || ""; }
    catch (e) { return DEFAULT_WEB_API_KEY || ""; }
  };
  const readSession = () => { try { return JSON.parse(localStorage.getItem(KEY_FB_SESSION) || "null"); } catch (e) { return null; } };
  const saveSession = (s) => { try { if (s) localStorage.setItem(KEY_FB_SESSION, JSON.stringify(s)); else localStorage.removeItem(KEY_FB_SESSION); } catch (e) {} };

  let fbToken = null, fbExp = 0, fbRefresh = null, fbSigning = null;

  async function fbSignIn() {
    const key = getApiKey();
    if (!key) return null;
    if (fbSigning) return fbSigning;
    fbSigning = (async () => {
      const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + encodeURIComponent(key), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnSecureToken: true }),
      });
      if (!res.ok) throw new Error("signIn HTTP " + res.status);
      const d = await res.json();
      return { idToken: d.idToken, refreshToken: d.refreshToken, exp: Date.now() + Number(d.expiresIn || 3600) * 1000 };
    })();
    try { return await fbSigning; } finally { fbSigning = null; }
  }

  async function fbRefreshToken(refresh) {
    const key = getApiKey();
    if (!key || !refresh) return null;
    const res = await fetch("https://securetoken.googleapis.com/v1/token?key=" + encodeURIComponent(key), {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(refresh),
    });
    if (!res.ok) throw new Error("refresh HTTP " + res.status);
    const d = await res.json();
    return { idToken: d.id_token, refreshToken: d.refresh_token, exp: Date.now() + Number(d.expires_in || 3600) * 1000 };
  }

  /* توكن ساري — أو null لو المصادقة مش مفعّلة (وقتها بنكمل زي ما كنا) */
  async function fbAuthToken(force) {
    const key = getApiKey();
    if (!key) return null;
    const s = (fbToken && fbExp) ? { idToken: fbToken, refreshToken: fbRefresh, exp: fbExp } : readSession();
    if (s && s.idToken && s.exp && s.exp > Date.now() + 60000 && !force) {
      fbToken = s.idToken; fbRefresh = s.refreshToken; fbExp = s.exp;
      return s.idToken;
    }
    try {
      let fresh = null;
      if (s && s.refreshToken) { try { fresh = await fbRefreshToken(s.refreshToken); } catch (e) { fresh = null; } }
      if (!fresh) fresh = await fbSignIn();
      if (fresh && fresh.idToken) {
        fbToken = fresh.idToken; fbRefresh = fresh.refreshToken; fbExp = fresh.exp;
        saveSession(fresh);
        return fresh.idToken;
      }
    } catch (e) { console.warn("[E3Cloud] فشل المصادقة:", e && e.message); }
    return null;
  }

  /* بيحط ?auth= على أي لينك قاعدة */
  async function authUrl(url) {
    try {
      const t = await fbAuthToken();
      if (!t) return url;
      return url + (url.indexOf("?") >= 0 ? "&" : "?") + "auth=" + encodeURIComponent(t);
    } catch (e) { return url; }
  }

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
  let queuedChanges = false;
  let auditPushPending = false;
  let auditPushTimer = null;
  let lastRemoteSig = "";
  const knownRemote = new Set();      /* أسماء المستخدمين اللي شفناها على السحابة */

  /* ------------------------------ أدوات ------------------------------ */
  /* كل الطلبات بتمن هنا — التوكن بيتضاف أوتوماتيك، ولو انتهي بيتجدّد ويتعاد */
  const doFetch = async (url, opts) => {
    let res = await fetch(await authUrl(url), opts);
    if (res.status === 401 && getApiKey()) {
      await fbAuthToken(true);                       /* جدّد التوكن وجرّب مرة */
      res = await fetch(await authUrl(url), opts);
    }
    return res;
  };
  const j = async (url, opts) => {
    const res = await doFetch(url, Object.assign({ cache: "no-store" }, opts || {}));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  };
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(dbKey) || "null"); } catch (e) { return null; } };
  const writeLocal = (db) => { try { localStorage.setItem(dbKey, JSON.stringify(db)); } catch (e) {} };
  const stateSignature = (db) => JSON.stringify({
    users: (db && db.users) || [],
    students: (db && db.students) || [],
    activityLog: (db && db.activityLog) || [],
    attendanceSessions: (db && db.attendanceSessions) || [],
    tasks: (db && db.tasks) || [],
    templates: (db && db.templates) || {},
    settings: (db && db.settings) || {},
  });
  const parseLoose = (v, fallback) => {
    if (v == null) return fallback;
    if (typeof v !== "string") return v;
    try { return JSON.parse(v); } catch (e) { return fallback; }
  };
  function mergeActivityLogs(localLogs, remoteLogs) {
    const merged = new Map();
    const keyOf = (entry) => entry && entry.id
      ? "id:" + String(entry.id)
      : "legacy:" + JSON.stringify([entry && (entry.at || entry.date) || "", entry && entry.userId || "", entry && entry.user || "", entry && entry.action || "", entry && entry.details || ""]);
    (Array.isArray(remoteLogs) ? remoteLogs : []).forEach((entry) => merged.set(keyOf(entry), entry));
    (Array.isArray(localLogs) ? localLogs : []).forEach((entry) => merged.set(keyOf(entry), entry));
    return Array.from(merged.values()).sort((a, b) => {
      const atA = Date.parse((a && (a.at || a.date)) || "") || 0;
      const atB = Date.parse((b && (b.at || b.date)) || "") || 0;
      return atB - atA;
    });
  }
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
      j(base + "/val.json"),
    ]);
    const local = readLocal() || {};
    const remoteUsers = usersRaw && typeof usersRaw === "object"
      ? Object.keys(usersRaw).map((k) => remoteUserToLocal(k, usersRaw[k]))
      : [];

    const before = stateSignature(local);
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

    const sig = stateSignature(merged);
    const changed = sig !== before;
    const remoteChanged = changed || (!!sig && sig !== lastRemoteSig && lastRemoteSig !== "");
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
        return doFetch(base + "/users/" + encodeURIComponent(key) + ".json", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      });
      /* حذف الحسابات اللي اتشالت من عندنا (اللي كنا شايفينها على السحابة قبل كده) */
      const now = new Set(users.map((u) => String(u.remoteKey || u.username || "").toLowerCase()));
      knownRemote.forEach((name) => {
        if (!now.has(name)) {
          writes.push(doFetch(base + "/users/" + encodeURIComponent(name) + ".json", { method: "DELETE" }));
          knownRemote.delete(name);
        }
      });
      const remoteActivityRaw = await j(base + "/val/activityLog.json");
      const localActivityBefore = Array.isArray(db.activityLog) ? db.activityLog : [];
      const mergedActivity = mergeActivityLogs(localActivityBefore, parseLoose(remoteActivityRaw, []));
      const hadRemoteOnlyActivity = mergedActivity.length > localActivityBefore.length;
      db.activityLog = mergedActivity;
      writeLocal(db);
      const val = {
        students: JSON.stringify(db.students || []),
        activityLog: JSON.stringify(db.activityLog || []),
        attendanceSessions: JSON.stringify(db.attendanceSessions || []),
        tasks: JSON.stringify(db.tasks || []),
        templates: JSON.stringify(db.templates || {}),
        settings: JSON.stringify(db.settings || {}),
      };
      writes.push(doFetch(base + "/val.json", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(val),
      }));
      const responses = await Promise.all(writes);
      const failed = responses.filter((res) => res && typeof res.ok === "boolean" && !res.ok);
      if (failed.length) throw new Error("HTTP " + failed[0].status + " — فشل رفع بعض البيانات");
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
      queuedChanges = false;
      if (hadRemoteOnlyActivity && onRemote) onRemote();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      pushing = false;
      if (pending) { pending = false; queuedChanges = true; setTimeout(push, 800); }
    }
  }

  let pushTimer = null;
  function queuePush() {
    queuedChanges = true;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { if (navigator.onLine) push(); }, 1200);
  }

  /**
   * مزامنة سجل النشاطات وحده من صفحة الدخول؛ لا ترفع نسخة DB كاملة من
   * صفحة الدخول حتى لا تستبدل بيانات دراسة أحدث في نسخة الجهاز بالخطأ.
   */
  async function pushActivityLog() {
    if (isOff()) return { ok: true, disabled: true };
    const db = readLocal() || {};
    const localLogs = Array.isArray(db.activityLog) ? db.activityLog : [];
    try {
      const url = getBase() + "/val/activityLog.json";
      const remoteRaw = await j(url);
      const remoteLogs = parseLoose(remoteRaw, []);
      const logs = mergeActivityLogs(localLogs, parseLoose(remoteRaw, []));
      const res = await doFetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(JSON.stringify(logs)),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      db.activityLog = logs;
      writeLocal(db);
      auditPushPending = false;
      return { ok: true, count: logs.length };
    } catch (e) {
      auditPushPending = true;
      return { ok: false, error: e && e.message || String(e) };
    }
  }
  function queueActivityLogPush() {
    auditPushPending = true;
    clearTimeout(auditPushTimer);
    auditPushTimer = setTimeout(() => { if (navigator.onLine) pushActivityLog(); }, 700);
  }

  async function sync() {
    try {
      const r = await pull();
      if ((r.changed || r.remoteChanged) && onRemote) onRemote();
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
    let l;
    try { l = await pull(); } catch (e) { l = { ok: false, error: e.message }; }
    if ((l.changed || l.remoteChanged) && onRemote) onRemote();
    return { ok: !!(p && p.ok) && !!(l && l.ok), pushed: p, pulled: l };
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
      const res = await doFetch(getBase() + "/users/" + encodeURIComponent(key) + "/lastLogin.json", {
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
      if (!getApiKey()) {
        console.warn("⚠️ [E3Cloud] مفيش Web API Key — القاعدة لسه مكشوفة لأي حد يعرف اللينك. " +
          "افتح console واكتب: E3Cloud.auth.setKey(\"AIza...\") — أو حطّه في DEFAULT_WEB_API_KEY جوه cloud-sync.js");
      } else {
        fbAuthToken().catch(() => {});
      }
      sync().catch(() => {});
      clearInterval(timer);
      timer = setInterval(() => { if (navigator.onLine) { sync().catch(() => {}); if (queuedChanges) push(); if (auditPushPending) pushActivityLog(); } }, 25000);
      window.addEventListener("online", () => { sync().catch(() => {}); if (queuedChanges) push(); if (auditPushPending) pushActivityLog(); });
      window.addEventListener("focus", () => { if (navigator.onLine) { sync().catch(() => {}); if (queuedChanges) push(); if (auditPushPending) pushActivityLog(); } });
      console.info("[E3Cloud] مزامنة Firebase مفعّلة:", getBase());
    },
    sync, pull, push, queuePush, pushActivityLog, queueActivityLogPush, syncNow, touchLogin,
    pendingLocalUsers,
    /* ---- المصادقة (Firebase Auth) ---- */
    auth: {
      enabled: () => !!getApiKey(),
      setKey(k) { try { localStorage.setItem(KEY_FB_API, String(k || "").trim()); fbToken = null; fbExp = 0; fbRefresh = null; saveSession(null); } catch (e) {} },
      clearKey() { try { localStorage.removeItem(KEY_FB_API); fbToken = null; fbExp = 0; fbRefresh = null; saveSession(null); } catch (e) {} },
      token: () => fbAuthToken(),
    },
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
      const res = await doFetch(base + "/users/" + encodeURIComponent(String(username).toLowerCase()) + "/passHash.json", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(passHash),
      });
      return res.ok;
    },
  };

  window.E3Cloud = E3Cloud;
})();
