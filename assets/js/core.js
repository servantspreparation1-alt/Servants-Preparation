/*
 * E3 Core — reconstructed TEST replacement, not the missing original.
 * Version: 4.0-rebuild-test
 *
 * IMPORTANT: Password hashes and vault records created by the missing original
 * core.js may use a different format. This implementation deliberately fails
 * closed for unknown legacy hashes. Do not deploy over live data without a
 * tested migration/backup and authorization.
 */
(function (root) {
  'use strict';
  var encoder = new TextEncoder();
  var HASH_PREFIX = 'pbkdf2-sha256-test';
  var HASH_ITERATIONS = 210000;
  var VAULT_ITERATIONS = 310000;
  var toB64 = function (bytes) {
    var a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var bin = '';
    for (var i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
    return btoa(bin);
  };
  var fromB64 = function (value) {
    var bin = atob(String(value || ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  var randomBytes = function (n) {
    if (!root.crypto || !root.crypto.getRandomValues) throw new Error('يحتاج التشفير إلى HTTPS أو localhost ومتصفح حديث');
    return root.crypto.getRandomValues(new Uint8Array(n));
  };
  var jsonClone = function (value) { return JSON.parse(JSON.stringify(value)); };
  var cryptoApi = root.crypto && root.crypto.subtle;

  async function derivePasswordKey(password, salt, iterations, usages) {
    if (!cryptoApi) throw new Error('Web Crypto غير متاح في هذا السياق');
    var material = await cryptoApi.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
    return cryptoApi.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, usages || ['encrypt', 'decrypt']);
  }
  async function hashPassword(password, salt) {
    if (!cryptoApi) throw new Error('Web Crypto غير متاح؛ لا يمكن إنشاء كلمة مرور آمنة');
    var context = encoder.encode('E3-auth-v4\u0000' + String(salt || ''));
    var nonce = randomBytes(16);
    var pbkdfSalt = new Uint8Array(context.length + nonce.length);
    pbkdfSalt.set(context, 0); pbkdfSalt.set(nonce, context.length);
    var material = await cryptoApi.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    var digest = await cryptoApi.deriveBits({ name: 'PBKDF2', salt: pbkdfSalt, iterations: HASH_ITERATIONS, hash: 'SHA-256' }, material, 256);
    return [HASH_PREFIX, HASH_ITERATIONS, toB64(context), toB64(nonce), toB64(digest)].join('$');
  }
  async function verifyPassword(password, salt, stored) {
    try {
      var parts = String(stored || '').split('$');
      if (parts.length !== 5 || parts[0] !== HASH_PREFIX) return false;
      var iterations = Number(parts[1]);
      if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 500000) return false;
      var context = encoder.encode('E3-auth-v4\u0000' + String(salt || ''));
      var savedContext = fromB64(parts[2]);
      if (savedContext.length !== context.length || savedContext.some(function (b, i) { return b !== context[i]; })) return false;
      var nonce = fromB64(parts[3]);
      if (nonce.length !== 16) return false;
      var pbkdfSalt = new Uint8Array(context.length + nonce.length);
      pbkdfSalt.set(context, 0); pbkdfSalt.set(nonce, context.length);
      var material = await cryptoApi.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
      var actual = new Uint8Array(await cryptoApi.deriveBits({ name: 'PBKDF2', salt: pbkdfSalt, iterations: iterations, hash: 'SHA-256' }, material, 256));
      var expected = fromB64(parts[4]);
      if (actual.length !== expected.length) return false;
      var diff = 0; for (var i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
      return diff === 0;
    } catch (_) { return false; }
  }

  function isLucasOwner(user) {
    if (!user || typeof user !== 'object') return false;
    var username = String(user.username || '').trim().toLowerCase();
    return user.systemAdmin === true || String(user.id || '') === 'idlucas0001' || username === 'lucaskayser';
  }
  function cleanUsers(users) {
    if (!Array.isArray(users)) return [];
    return users.filter(function (u) { return !!u && typeof u === 'object'; }).map(function (u) {
      var x = Object.assign({}, u);
      x.id = String(x.id || '');
      x.username = String(x.username || '').trim();
      x.displayName = String(x.displayName || x.username || '');
      if (root.E3A && typeof root.E3A.userKey === 'function') x.usernameKey = x.usernameKey || root.E3A.userKey(x.username);
      x.permissions = Array.isArray(x.permissions) ? x.permissions : [];
      x.scopeYears = Array.isArray(x.scopeYears) ? x.scopeYears : [];
      if (x.active === undefined) x.active = true;
      return x;
    });
  }
  function toArabicDigits(value) { return String(value == null ? '' : value).replace(/[0-9]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[Number(d)]; }); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function uid() {
    try { if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID(); } catch (_) {}
    return 'e3_' + Date.now().toString(36) + '_' + Array.from(randomBytes(12)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function initials(value) { return String(value || '').trim().split(/\\s+/).slice(0, 2).map(function (part) { return part.charAt(0); }).join('') || '؟'; }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]; }); }
  function avatarOf(user, escapeHtml) {
    var esc = typeof escapeHtml === 'function' ? escapeHtml : function (v) { return String(v || '').replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); };
    var photo = String(user && user.photo || '');
    if (/^(https?:\/\/|data:image\/)/i.test(photo)) return '<img src="' + esc(photo) + '" alt="">';
    var name = String(user && (user.displayName || user.name) || '');
    var initials = name.trim().split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0); }).join('') || '؟';
    return '<span>' + esc(initials) + '</span>';
  }

  var vault = {
    pub: null,
    privKey: null,
    loadMeta: function (settings) {
      this.pub = settings && settings.vault && settings.vault.pub ? settings.vault.pub : null;
      if (!this.pub) this.privKey = null;
      return !!this.pub;
    },
    canSeal: function (user) { return !!(cryptoApi && this.pub && user && user.passHash); },
    async createVault(password) {
      if (!cryptoApi) throw new Error('Web Crypto غير متاح');
      var pair = await cryptoApi.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['encrypt','decrypt']);
      var pub = await cryptoApi.exportKey('jwk', pair.publicKey);
      var priv = await cryptoApi.exportKey('jwk', pair.privateKey);
      var salt = randomBytes(16), iv = randomBytes(12), key = await derivePasswordKey(password, salt, VAULT_ITERATIONS);
      var encrypted = await cryptoApi.encrypt({ name: 'AES-GCM', iv: iv }, key, encoder.encode(JSON.stringify(priv)));
      var meta = { v: 1, pub: pub, priv: { salt: toB64(salt), iv: toB64(iv), cipher: toB64(encrypted), iterations: VAULT_ITERATIONS } };
      this.pub = pub; this.privKey = pair.privateKey;
      return meta;
    },
    async unlockVault(meta, password) {
      if (!cryptoApi || !meta || Number(meta.v) !== 1 || !meta.priv || !meta.pub) throw new Error('صيغة الخزنة غير مدعومة في نسخة إعادة البناء التجريبية');
      var p = meta.priv, iterations = Number(p.iterations) || VAULT_ITERATIONS;
      if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 600000) throw new Error('إعدادات الخزنة غير صالحة');
      var key = await derivePasswordKey(password, fromB64(p.salt), iterations);
      var plain = await cryptoApi.decrypt({ name: 'AES-GCM', iv: fromB64(p.iv) }, key, fromB64(p.cipher));
      var privateJwk = JSON.parse(new TextDecoder().decode(plain));
      this.privKey = await cryptoApi.importKey('jwk', privateJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt']);
      this.pub = meta.pub;
      return this.privKey;
    },
    async rekeyVault(meta, oldPassword, newPassword) {
      await this.unlockVault(meta, oldPassword);
      var privateJwk = await cryptoApi.exportKey('jwk', this.privKey);
      var salt = randomBytes(16), iv = randomBytes(12), key = await derivePasswordKey(newPassword, salt, VAULT_ITERATIONS);
      var encrypted = await cryptoApi.encrypt({ name: 'AES-GCM', iv: iv }, key, encoder.encode(JSON.stringify(privateJwk)));
      return Object.assign({}, meta, { v: 1, priv: { salt: toB64(salt), iv: toB64(iv), cipher: toB64(encrypted), iterations: VAULT_ITERATIONS } });
    },
    async sealWithPublic(publicJwk, value) {
      if (!cryptoApi || !publicJwk) throw new Error('مفتاح الخزنة العامة غير متاح');
      var pub = await cryptoApi.importKey('jwk', publicJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
      var aes = await cryptoApi.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt','decrypt']);
      var iv = randomBytes(12), encrypted = await cryptoApi.encrypt({ name: 'AES-GCM', iv: iv }, aes, encoder.encode(String(value)));
      var raw = await cryptoApi.exportKey('raw', aes), wrapped = await cryptoApi.encrypt({ name: 'RSA-OAEP' }, pub, raw);
      return 'E3SEAL1.' + toB64(encoder.encode(JSON.stringify({ k: toB64(wrapped), iv: toB64(iv), d: toB64(encrypted) })));
    },
    async seal(value) { return this.sealWithPublic(this.pub, value); },
    async unseal(sealed) {
      if (!cryptoApi || !this.privKey) throw new Error('افتح الخزنة أولًا');
      var text = String(sealed || '');
      if (!text.startsWith('E3SEAL1.')) throw new Error('صيغة كلمة السر المشفرة غير مدعومة في إعادة البناء التجريبية');
      var payload = JSON.parse(new TextDecoder().decode(fromB64(text.slice(8))));
      var raw = await cryptoApi.decrypt({ name: 'RSA-OAEP' }, this.privKey, fromB64(payload.k));
      var aes = await cryptoApi.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
      var plain = await cryptoApi.decrypt({ name: 'AES-GCM', iv: fromB64(payload.iv) }, aes, fromB64(payload.d));
      return new TextDecoder().decode(plain);
    }
  };

  var store = {
    getItem: function (key) { try { return root.localStorage.getItem(key); } catch (_) { return null; } },
    setItem: function (key, value) { try { root.localStorage.setItem(key, String(value)); } catch (e) { throw e; } },
    removeItem: function (key) { try { root.localStorage.removeItem(key); } catch (_) {} }
  };
  var theme = {
    init: function () {
      var value = 'light'; try { value = root.localStorage.getItem('e3dad-theme') || 'light'; } catch (_) {}
      value = value === 'dark' ? 'dark' : 'light';
      if (root.document && root.document.documentElement) root.document.documentElement.setAttribute('data-theme', value);
      return value;
    }
  };

  var E3 = root.E3 || {};
  Object.assign(E3, {
    BUILD: '4.0-rebuild-test', DB_KEY: 'e3dad_khoddam_db_v1', SESSION_KEY: 'e3dad_auth_v2',
    OWNER_USERNAME: 'lucaskayser', SYSTEM_ADMIN_LABEL: 'أمين الخدمة',
    SESSION_MS: 12 * 60 * 60 * 1000, OWNER_SESSION_MS: 12 * 60 * 60 * 1000, SESSION_REMEMBER_MS: 7 * 24 * 60 * 60 * 1000,
    store: store, vault: vault, theme: theme
  });
  root.E3 = E3;
  root.hashPassword = hashPassword;
  root.verifyPassword = verifyPassword;
  root.cleanUsers = cleanUsers;
  root.isLucasOwner = isLucasOwner;
  root.avatarOf = avatarOf;
  root.today = today;
  root.toArabicDigits = toArabicDigits;
  root.uid = uid;
  root.initials = initials;
  root.esc = esc;
})(typeof window !== 'undefined' ? window : globalThis);
