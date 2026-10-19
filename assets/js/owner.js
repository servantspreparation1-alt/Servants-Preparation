/* =====================================================================
   اعداد خدام ادمن — وحدة إدارة السيستم (Owner Module)
   • خزنة كلمات السر: عرض / نسخ / إعادة تعيين
   • لوحة إدارة السيستم: تحكم كامل + سجل + منطقة خطر
   بتتحمّل بعد core.js وقبل سكربت admin.html
   ===================================================================== */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => window.esc(String(s ?? ""));
  const ar = (n) => window.toArabicDigits(n);

  /* ------------------------------------------------------------------ */
  /*  أدوات النوافذ                                                      */
  /* ------------------------------------------------------------------ */
  function vModal(title, body, opts = {}) {
    return new Promise((resolve) => {
      const bg = document.getElementById("modalBg"), box = document.getElementById("modalBox");
      box.classList.toggle("wide", !!opts.wide);
      box.innerHTML =
        `<h2>${title}</h2>` +
        (opts.sub ? `<div class="sub">${opts.sub}</div>` : "") +
        body +
        `<div class="modal-actions">
           <button class="btn primary" id="vOk">${opts.okLabel || "تأكيد"}</button>
           <button class="btn" id="vCancel">${opts.cancelLabel || "إلغاء"}</button>
         </div>`;
      bg.classList.add("open");
      document.body.classList.add("no-scroll");
      const done = (v) => {
        bg.classList.remove("open"); box.classList.remove("wide");
        document.body.classList.remove("no-scroll");
        resolve(v);
      };
      const ok = box.querySelector("#vOk"), cancel = box.querySelector("#vCancel");
      const submit = () => {
        const inputs = [...box.querySelectorAll("[data-v]")];
        const data = {};
        inputs.forEach((i) => (data[i.dataset.v] = i.value.trim()));
        if (opts.validate) {
          const err = opts.validate(data, box);
          if (err) { const e = box.querySelector(".error"); if (e) { e.textContent = err; e.classList.add("show"); } else window.toast(err); return; }
        }
        done(data);
      };
      ok.onclick = submit;
      cancel.onclick = () => done(null);
      box.querySelectorAll("[data-v]").forEach((i) =>
        i.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); })
      );
      setTimeout(() => { const f = box.querySelector("[data-v]"); if (f) f.focus(); }, 60);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  فتح الخزنة                                                         */
  /* ------------------------------------------------------------------ */
  async function askOwnerPassword() {
    const res = await vModal(
      "🔐 تأكيد هوية إدارة السيستم",
      `<div class="secret-warn">الخزنة مقفولة — محتاجين كلمة سر <b>إدارة السيستم</b> عشان نفتح المفتاح الخاص ونعرض كلمات السر.
        <br>مفيش حد تاني في السيستم يقدر يفتحها.</div>
       <div class="error" style="display:none"></div>
       <div class="field"><label>كلمة سر إدارة السيستم</label>
         <div class="pw-wrap"><input type="password" data-v="pw" autocomplete="current-password" placeholder="••••••••••"><button class="btn" type="button" onclick="(function(b){var i=b.parentNode.querySelector('input');i.type=i.type==='password'?'text':'password';b.textContent=i.type==='password'?'👁️':'🙈'})(this)">👁️</button></div>
       </div>`,
      { okLabel: "🔓 فتح الخزنة", cancelLabel: "إلغاء", validate: (d) => (!d.pw ? "اكتب كلمة سر إدارة السيستم" : null) }
    );
    return res ? res.pw : null;
  }

  /** يتأكد إن المفتاح الخاص موجود في الذاكرة، ولو لأ يطلبه من المالك */
  async function ensureVaultOpen() {
    const me = currentUser();
    if (!isLucasOwner(me)) { toast("🔒 كلمات السر متاحة لإدارة السيستم فقط"); return false; }
    if (E3.vault.privKey) return true;
    if (!DB.settings.vault) { toast("⚠️ مفيش خزنة متسجلة على الجهاز — أعد بناء الخزنة من لوحة الإدارة"); return false; }
    const pw = await askOwnerPassword();
    if (!pw) return false;
    if (!(await verifyPassword(pw, me.username.toLowerCase(), me.passHash))) { toast("❌ كلمة السر غلط"); return false; }
    try {
      E3.vault.privKey = await E3.vault.unlockVault(DB.settings.vault, pw);
      E3.vault.pub = DB.settings.vault.pub;
      toast("🔓 الخزنة اتفتحت");
      return true;
    } catch (e) {
      toast("❌ " + (e.message || "تعذر فتح الخزنة"));
      return false;
    }
  }

  /** قفل كلمة سر — بينفع من أي حساب إداري (بالمفتاح العام) */
  async function sealPassword(user, plain) {
    if (!user || !plain) return false;
    try {
      if (!E3.vault.pub && DB.settings && DB.settings.vault) E3.vault.pub = DB.settings.vault.pub;
      if (!E3.vault.pub) return false;
      user.passSealed = await E3.vault.seal(plain);
      user.passSealedAt = new Date().toISOString();
      return true;
    } catch (e) { console.warn("seal failed", e); return false; }
  }

  /** خلية كلمة السر في جدول الخدام */
  function credCell(u) {
    const me = currentUser();
    if (!isLucasOwner(me)) {
      return `<span class="cred-locked">🔒 محمية</span>`;
    }
    if (!E3.vault.canSeal(u)) {
      return `<button class="btn sm" onclick="resetUserPassword('${u.id}')" title="مفيش كلمة سر مشفّرة لهذا الحساب">🔑 عيّن كلمة سر</button>`;
    }
    return `<div class="cred-cell" data-uid="${u.id}">
      <span class="cred-dots" data-dots>••••••</span>
      <button class="btn sm" onclick="revealPassword('${u.id}')" title="عرض كلمة السر">👁️ عرض</button>
      <button class="btn sm" onclick="copyPassword('${u.id}')" title="نسخ كلمة السر">📋 نسخ</button>
    </div>`;
  }

  /* ------------------------------------------------------------------ */
  /*  عرض / نسخ كلمة السر                                                */
  /* ------------------------------------------------------------------ */
  async function revealPassword(id) {
    const me = currentUser();
    if (!isLucasOwner(me)) return toast("🔒 كلمات السر متاحة لإدارة السيستم فقط");
    const u = (DB.users || []).find((x) => x.id === id);
    if (!u) return toast("الحساب مش موجود");
    if (!E3.vault.canSeal(u)) return toast("مفيش كلمة سر مشفّرة للحساب ده — عيّن واحدة جديدة");
    if (!(await ensureVaultOpen())) return;
    let plain = "";
    try { plain = await E3.vault.open(u.passSealed); }
    catch (e) { return toast("❌ مش قدرت أفك تشفير كلمة السر — يمكن الخزنة اتغيّرت"); }

    logActivity("👁️ عرض كلمة سر الحساب: " + u.username);
    saveDB();

    const res = await vModal(
      "🔑 بيانات دخول " + esc(u.displayName),
      `<div class="secret-warn gold">دي بيانات دخول حساسة — <b>كل عرض بيتسجل في سجل النشاطات</b> باسمك ووقته.</div>
       <div class="form-grid">
         <div class="field"><label>اسم المستخدم</label><input readonly value="${esc(u.username)}" dir="ltr"></div>
         <div class="field"><label>كلمة السر</label><input readonly value="${esc(plain)}" dir="ltr"></div>
       </div>
       <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
         <button class="btn gold" type="button" id="cpBoth">📋 نسخ اسم المستخدم + كلمة السر</button>
         <button class="btn" type="button" id="cpPw">🔑 نسخ كلمة السر بس</button>
         <button class="btn" type="button" onclick="resetUserPassword('${u.id}')">♻️ تعيين كلمة سر جديدة</button>
       </div>
       <p style="font-size:12px;color:var(--muted);margin-top:10px">آخر تغيير لكلمة السر: ${u.passSealedAt ? esc(new Date(u.passSealedAt).toLocaleString("ar-EG")) : "—"}</p>`,
      { okLabel: "تم — إغلاق", cancelLabel: "إغلاق" }
    );
    const cp = (t) => navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t).then(() => toast("تم النسخ ✅")).catch(() => toast("تعذر النسخ — انسخ يدويًا")) : toast("المتصفح مش بيدعم النسخ التلقائي");
    const b1 = document.getElementById("cpBoth"), b2 = document.getElementById("cpPw");
    if (b1) b1.onclick = () => cp(u.username + " / " + plain);
    if (b2) b2.onclick = () => cp(plain);
    return res;
  }

  async function copyPassword(id) {
    const me = currentUser();
    if (!isLucasOwner(me)) return toast("🔒 كلمات السر متاحة لإدارة السيستم فقط");
    const u = (DB.users || []).find((x) => x.id === id);
    if (!u || !E3.vault.canSeal(u)) return toast("مفيش كلمة سر مشفّرة للحساب ده");
    if (!(await ensureVaultOpen())) return;
    try {
      const plain = await E3.vault.open(u.passSealed);
      await navigator.clipboard.writeText(plain);
      logActivity("📋 نسخ كلمة سر الحساب: " + u.username);
      saveDB();
      toast("تم نسخ كلمة سر " + u.displayName + " ✅");
    } catch (e) { toast("❌ تعذر النسخ — جرّب «عرض» بعدين انسخ"); }
  }

  /* ------------------------------------------------------------------ */
  /*  لوحة الخزنة                                                        */
  /* ------------------------------------------------------------------ */
  async function openVaultPanel() {
    if (!isLucasOwner(currentUser())) return toast("🔒 خزنة البيانات لإدارة السيستم فقط");
    const users = DB.users || [];
    const rows = users.map((u) => {
      const sealed = E3.vault.canSeal(u);
      return `<tr>
        <td data-label="الخادم"><b>${esc(u.displayName)}</b>${isLucasOwner(u) ? ' <span class="badge b-gold">🛡️</span>' : ""}</td>
        <td data-label="اسم المستخدم"><span dir="ltr" style="font-family:ui-monospace,monospace">${esc(u.username)}</span></td>
        <td data-label="كلمة السر">${sealed
          ? `<div class="cred-cell"><span class="cred-dots">••••••</span>
               <button class="btn sm" onclick="revealPassword('${u.id}')">👁️ عرض</button>
               <button class="btn sm" onclick="copyPassword('${u.id}')">📋 نسخ</button></div>`
          : `<span class="cred-locked">⚠️ غير مشفّرة</span> <button class="btn sm" onclick="resetUserPassword('${u.id}')">🔑</button>`}</td>
        <td data-label="آخر تحديث" style="font-size:12px">${u.passSealedAt ? esc(new Date(u.passSealedAt).toLocaleDateString("ar-EG")) : "—"}</td>
        <td data-label="الحالة">${u.active === false ? '<span class="badge b-red">موقوف</span>' : '<span class="badge b-green">مفعّل</span>'}</td>
      </tr>`;
    }).join("");

    await vModal(
      "🔐 خزنة بيانات الدخول",
      `<div class="secret-warn">كل كلمة سر هنا <b>مشفّرة</b> ومفتاحها معاك انت بس. أي عرض أو نسخ بيتسجل في سجل النشاطات.</div>
       <div class="table-scroll"><table class="users-table" style="width:100%">
         <thead><tr><th>الخادم</th><th>اسم المستخدم</th><th>كلمة السر</th><th>آخر تحديث</th><th>الحالة</th></tr></thead>
         <tbody>${rows}</tbody></table></div>
       <p style="font-size:12px;color:var(--muted);margin-top:12px">💡 لو حساب من غير كلمة سر مشفّرة (حساب قديم)، اضغط 🔑 وعيّن له واحدة جديدة — هتتقفل تلقائيًا وتظهر هنا.</p>`,
      { wide: true, okLabel: "إغلاق", cancelLabel: "إغلاق" }
    );
  }

  /* ------------------------------------------------------------------ */
  /*  إعادة تشفير الخزنة عند تغيير كلمة سر المالك                        */
  /* ------------------------------------------------------------------ */
  async function rekeyVault(oldPw, newPw) {
    const meta = DB.settings && DB.settings.vault;
    if (!meta) return { ok: true }; // مفيش خزنة => مش محتاج
    try {
      const fresh = await E3.vault.rekeyVault(meta, oldPw, newPw);
      DB.settings.vault = fresh;
      E3.vault.privKey = await E3.vault.unlockVault(fresh, newPw);
      E3.vault.pub = fresh.pub;
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message || "تعذر تحديث الخزنة" };
    }
  }

  /* ------------------------------------------------------------------ */
  /*  لوحة إدارة السيستم                                                   */
  /* ------------------------------------------------------------------ */
  function viewSystem() {
    const me = currentUser();
    if (!isLucasOwner(me)) return `<div class="card empty"><div class="big">🔒</div>الصفحة دي لإدارة السيستم فقط</div>`;
    const users = DB.users || [];
    const sealed = users.filter((u) => E3.vault.canSeal(u)).length;
    const students = (DB.students || []).length;
    const sizeKB = Math.round((E3.store.getItem(DB_KEY) || "").length / 1024);

    return `
    <div class="owner-hero">
      <div class="avatar">${userAvatar(me)}</div>
      <div style="flex:1;min-width:220px">
        <h2>🛡️ لوحة إدارة السيستم</h2>
        <p>انت الحساب الوحيد اللي يشوف كلمات السر ويدير كل السيستم — ومفيش حد يقدر يوقفك أو يخفيك أو يمسحك.</p>
      </div>
      <span class="badge b-gold">${E3.vault.privKey ? "🔓 الخزنة مفتوحة" : "🔒 الخزنة مقفولة"}</span>
    </div>

    <div class="grid c3" style="margin-bottom:14px">
      <div class="card stat"><div class="icbox">👥</div><span>حسابات الخدام</span><b>${ar(users.length)}</b><div class="trend">${ar(sealed)} كلمة سر مشفّرة</div></div>
      <div class="card stat"><div class="icbox">🎓</div><span>الدارسين</span><b>${ar(students)}</b><div class="trend">ملف محفوظ على الجهاز</div></div>
      <div class="card stat"><div class="icbox">💾</div><span>حجم البيانات</span><b>${ar(sizeKB)}<small style="font-size:13px"> KB</small></b><div class="trend">محلي + سحابة (لو مفعّلة)</div></div>
    </div>

    <div class="card owner-card" style="margin-bottom:14px">
      <h3>⚡ تحكم سريع</h3>
      <div class="owner-grid" style="margin-top:10px">
        <button class="owner-tile" onclick="openVaultPanel()"><span class="oi">🔐</span><span><b>خزنة بيانات الدخول</b><small>اعرض أو انسخ اسم المستخدم وكلمة السر لأي حد</small></span></button>
        <button class="owner-tile" onclick="openUserForm()"><span class="oi">➕</span><span><b>إنشاء حساب جديد</b><small>أي دور، بأي صلاحيات، وكلمة السر تتقفل في الخزنة</small></span></button>
        <button class="owner-tile" onclick="go('users')"><span class="oi">🛡️</span><span><b>إدارة الحسابات والصلاحيات</b><small>إيقاف، تفعيل، تعديل أدوار، حذف</small></span></button>
        <button class="owner-tile" onclick="openMyAccount()"><span class="oi">🔑</span><span><b>كلمة سرّي وبياناتي</b><small>تغيير كلمة سر إدارة السيستم (بتعيد تأمين الخزنة)</small></span></button>
        <button class="owner-tile" onclick="go('backup')"><span class="oi">💾</span><span><b>نسخة احتياطية كاملة</b><small>صدّر كل البيانات في ملف واحد</small></span></button>
        <button class="owner-tile" onclick="ownerSecurityCheck()"><span class="oi">🧪</span><span><b>فحص أمني سريع</b><small>حسابات من غير كلمة سر مشفّرة، حسابات مفتوحة، إلخ</small></span></button>
      </div>
    </div>

    <div class="grid c2">
      <div class="card">
        <h3>📋 حسابات الخدام</h3>
        ${users.map((u) => `<div class="kv"><span>${isLucasOwner(u) ? "🛡️" : "•"} ${esc(isLucasOwner(u) ? E3.SYSTEM_ADMIN_LABEL : u.displayName)} <small style="color:var(--muted)" dir="${isLucasOwner(u) ? 'rtl' : 'ltr'}">${isLucasOwner(u) ? "حساب محمي" : "@" + esc(u.username)}</small></span>
          <b style="font-size:12px">${u.active === false ? "⏸️ موقوف" : "✅ مفعّل"} ${E3.vault.canSeal(u) ? "• 🔐" : ""}</b></div>`).join("")}
      </div>
    </div>

`;
  }

  /* ------------------------------ أدوات اللوحة ------------------------------ */
  function ownerSecurityCheck() {
    const users = DB.users || [];
    const noSeal = users.filter((u) => !E3.vault.canSeal(u));
    const stopped = users.filter((u) => u.active === false);
    const demos = users.filter((u) => /^(mosaed|sana1|khadem|motabe3)$/i.test(u.username));
    const noOwner = !users.some(isLucasOwner);
    const lines = [];
    if (noOwner) lines.push("❌ مفيش حساب إدارة سيستم — استرجع نسخة احتياطية، مفيش إنشاء من برّه.");
    if (noSeal.length) lines.push(`⚠️ ${ar(noSeal.length)} حساب من غير كلمة سر مشفّرة (${noSeal.map((u) => u.username).join("، ")}) — عيّن لهم كلمة سر جديدة من صفحة الخدام.`);
    if (demos.length) lines.push(`🧪 فيه ${ar(demos.length)} حساب تجريبي (${demos.map((u) => u.username).join("، ")}) — الأفضل تحذفهم قبل الاستخدام الحقيقي.`);
    if (stopped.length) lines.push(`⏸️ ${ar(stopped.length)} حساب موقوف.`);
    if (!DB.settings.vault) lines.push("❌ مفيش خزنة متسجلة — أعد بناء الخزنة من لوحة الإدارة.");
    if (!lines.length) lines.push("✅ كل حاجة تمام: كل الحسابات مشفّرة، وإدارة السيستم موجود، ومفيش حسابات تجريبية.");
    vModal("🧪 فحص أمني سريع", `<div style="display:grid;gap:8px">${lines.map((l) => `<div class="kv"><span style="line-height:1.9">${esc(l)}</span></div>`).join("")}</div>`, { okLabel: "تمام", cancelLabel: "إغلاق" });
  }

  async function ownerRebuildVault() {
    const me = currentUser();
    if (!isLucasOwner(me)) return;
    const res = await vModal(
      "♻️ إعادة بناء الخزنة",
      `<div class="secret-warn">ده هيعمل <b>مفتاح جديد بالكامل</b>. كل كلمات السر المشفّرة القديمة هتبقى غير قابلة للقراءة، وهتحتاج تعيّن كلمة سر جديدة لكل حساب تاني.<br><br>استخدمه بس لو نسيت كلمة سرّك ومش قادر تفتح الخزنة.</div>
       <div class="error" style="display:none"></div>
       <div class="field"><label>كلمة سر إدارة السيستم الحالية (للتأكيد)</label><input type="password" data-v="pw" placeholder="••••••••••"></div>
       <div class="field"><label>كلمة السر الجديدة</label><input type="password" data-v="pw2" placeholder="••••••••••"></div>`,
      {
        okLabel: "♻️ إعادة البناء", cancelLabel: "إلغاء",
        validate: (d) => {
          if (!d.pw) return "اكتب كلمة السر الحالية";
          if (!d.pw2 || d.pw2.length < 10) return "كلمة السر الجديدة ١٠ حروف على الأقل";
          return null;
        },
      }
    );
    if (!res) return;
    if (!(await verifyPassword(res.pw, me.username.toLowerCase(), me.passHash))) return toast("❌ كلمة السر الحالية غلط");
    try {
      const meta = await E3.vault.createVault(res.pw2);
      DB.settings.vault = meta;
      E3.vault.pub = meta.pub;
      E3.vault.privKey = await E3.vault.unlockVault(meta, res.pw2);
      (DB.users || []).forEach((u) => { if (!isLucasOwner(u)) { u.passSealed = null; u.passSealedAt = null; } });
      me.passHash = await hashPassword(res.pw2, me.username.toLowerCase());
      me.passSealed = await E3.vault.seal(res.pw2);
      me.passSealedAt = new Date().toISOString();
      logActivity("♻️ أعاد بناء خزنة كلمات السر");
      saveDB(); render();
      toast("✅ اتعملت خزنة جديدة — عيّن كلمات سر جديدة لباقي الحسابات");
    } catch (e) { toast("❌ " + (e.message || "فشل إعادة البناء")); }
  }

  function ownerExportAccounts() {
    if (!isLucasOwner(currentUser())) return;
    const data = { exportedAt: new Date().toISOString(), org: DB.settings.orgName, accounts: (DB.users || []).map((u) => ({
      name: u.displayName, username: u.username, role: u.role, active: u.active !== false, lastLogin: u.lastLogin || "", sealed: E3.vault.canSeal(u),
    })) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "e3dad-accounts-" + today() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("تم تصدير قائمة الحسابات (من غير كلمات السر) ✅");
  }

  /* ------------------------------ تصدير ------------------------------ */
  window.credCell = credCell;
  window.sealPassword = sealPassword;
  window.ensureVaultOpen = ensureVaultOpen;
  window.revealPassword = revealPassword;
  window.copyPassword = copyPassword;
  window.openVaultPanel = openVaultPanel;
  window.rekeyVault = rekeyVault;
  window.viewSystem = viewSystem;
  window.ownerSecurityCheck = ownerSecurityCheck;
  window.ownerRebuildVault = ownerRebuildVault;
  window.ownerExportAccounts = ownerExportAccounts;
})();
