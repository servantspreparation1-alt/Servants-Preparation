/* =====================================================================
   api/imagekit-auth.js — Vercel Serverless Function
   بيرجّع توقيع رفع مؤقت لـ ImageKit (token + expire + signature)
   الـ Private Key بيفضل على السيرفر فقط ولا يظهر للمتصفح أبدًا.
   ===================================================================== */
const crypto = require("crypto");

module.exports = async (req, res) => {
  // CORS بسيط (نفس الدومين أساسًا)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || "";
    const publicKey = process.env.IMAGEKIT_PUBLIC_KEY || "";

    if (!privateKey || !publicKey) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          ok: false,
          error: "ImageKit keys are not configured on the server",
        })
      );
    }

    // توكن عشوائي + صلاحية 30 دقيقة (بالثواني)
    const token = crypto.randomBytes(16).toString("hex");
    const expire = Math.floor(Date.now() / 1000) + 30 * 60;

    // التوقيع حسب توثيق ImageKit: HMAC_SHA1(privateKey, token+expire)
    const signature = crypto
      .createHmac("sha1", privateKey)
      .update(token + expire)
      .digest("hex");

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(
      JSON.stringify({ ok: true, token, expire, signature, publicKey })
    );
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  }
};
