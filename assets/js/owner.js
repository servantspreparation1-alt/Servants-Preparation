/*
 * E3 Owner UI — reconstructed TEST compatibility module, not the missing original.
 * Implements only the owner-facing globals visibly required by the supplied admin.html.
 * It does not claim to reproduce hidden/admin behavior from the original owner.js.
 */
(function (root) {
  'use strict';
  root.E3Owner = Object.freeze({ build: '4.0-rebuild-test', originalRecovered: false });
})(typeof window !== 'undefined' ? window : globalThis);

function credCell(user) {
  if (!user || !user.passHash) return '<span class="badge b-gray">غير معيّنة</span>';
  if (user.passSealed) return '<span class="badge b-green" title="مشفّرة داخل الخزنة">🔐 مشفّرة</span>';
  return '<span class="badge b-amber" title="بصمة دخول فقط؛ لا توجد نسخة قابلة للاستعادة داخل الخزنة">🔒 محمية</span>';
}

async function openVaultPanel() {
  if (typeof isLucasOwner !== 'function' || !isLucasOwner(currentUser())) return toast('فتح الخزنة لأمين الخدمة فقط');
  const meta = DB && DB.settings && DB.settings.vault;
  if (!meta) return toast('الخزنة غير مهيّأة على هذا الجهاز');
  openModal('إعادة التحقق لفتح الخزنة', `
    <p style="color:var(--muted);line-height:1.8">لأمان الحسابات، أعد إدخال كلمة مرور أمين الخدمة. كلمة المرور لا تُحفظ في سجل النشاطات.</p>
    <div class="field"><label for="ownerVaultPassword">كلمة المرور الحالية</label><input id="ownerVaultPassword" type="password" autocomplete="current-password"></div>`, async () => {
      const password = document.getElementById('ownerVaultPassword').value;
      if (!password) return toast('أدخل كلمة المرور');
      try {
        await E3.vault.unlockVault(DB.settings.vault, password);
        closeModal();
        await showOwnerVault();
      } catch (_) { toast('تعذّر فتح الخزنة بهذه الكلمة أو أن صيغة الخزنة غير مدعومة في نسخة الاختبار'); }
    }, '🔐 فتح الخزنة');
}

async function showOwnerVault() {
  if (!isLucasOwner(currentUser()) || !E3.vault || !E3.vault.privKey) return toast('الخزنة غير مفتوحة');
  const users = Array.isArray(DB.users) ? DB.users : [];
  const rows = await Promise.all(users.map(async function (user) {
    let value = '<span style="color:var(--muted)">لا توجد كلمة قابلة للاستعادة</span>';
    if (user.passSealed) {
      try { value = '<code dir="ltr">' + esc(await E3.vault.unseal(user.passSealed)) + '</code>'; }
      catch (_) { value = '<span class="badge b-amber">تعذر فك تشفير النسخة القديمة</span>'; }
    }
    return '<tr><td>' + esc(user.displayName || user.username || '—') + '</td><td dir="ltr">@' + esc(user.username || '') + '</td><td>' + value + '</td></tr>';
  }));
  openModal('خزنة كلمات المرور — عرض محلي مؤقت', `
    <div class="card" style="border-color:var(--gold);margin-bottom:12px"><b>تنبيه خصوصية:</b> هذه البيانات تظهر على الشاشة فقط بعد إعادة التحقق. أغلق النافذة عند الانتهاء، ولا تشارك لقطة الشاشة.</div>
    <div class="table-scroll"><table><thead><tr><th>الخادم</th><th>اسم المستخدم</th><th>كلمة المرور المستعادة</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`, function () { closeModal(); }, 'إغلاق الخزنة');
}
