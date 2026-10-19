/* =====================================================================
   cloud-sync.js — طبقة المزامنة السحابية (اختيارية)
   =====================================================================
   في النسخة الأصلية كان الملف ده بيزامن قاعدة البيانات مع Firebase،
   وكان مرتبط بمشروع Vercel + .env.local (مفاتيح Firebase و ImageKit).

   هنا حطّينا نسخة "آمنة" بتشتغل من غير أي مفاتيح:
   • لو مش عايز مزامنة سحابية  → سيب الملف زي ما هو. البرنامج بيشتغل عادي
     ويحفظ كل حاجة على الجهاز (localStorage) + نسخة احتياطية JSON.
   • لو عندك النسخة الأصلية من cloud-sync.js (بمفاتيح Firebase)
     → استبدل الملف ده بالملف القديم، وهيرجع يشتغل تلقائيًا لأن باقي
       الكود بيتعامل مع window.E3Cloud وبيستدعيه لو موجود.
   ===================================================================== */
(function () {
  "use strict";
  let dbKey = "e3dad_khoddam_db_v1";
  let ready = false;

  const E3Cloud = {
    enabled: false,
    init(opts) {
      if (opts && opts.dbKey) dbKey = opts.dbKey;
      ready = true;
      console.info("[E3Cloud] المزامنة السحابية غير مفعّلة في هذه النسخة — البيانات محفوظة محليًا على الجهاز.");
    },
    async sync() {
      return { changed: false, ok: true, disabled: true };
    },
    queuePush() {
      /* مفيش سحابة — الحفظ المحلي بيحصل في saveDB() */
    },
    async push() {
      return { ok: true, disabled: true };
    },
    async pull() {
      return { ok: true, disabled: true, changed: false };
    },
  };

  window.E3Cloud = window.E3Cloud || E3Cloud;
})();
