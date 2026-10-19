/* =====================================================================
   api/imagekit-config.js — Vercel Serverless Function
   بيرجّع الإعدادات العامة فقط (Public Key + URL Endpoint).
   الـ Private Key لا يُرجَع هنا أبدًا.
   ===================================================================== */

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const publicKey = process.env.IMAGEKIT_PUBLIC_KEY || "";
  const urlEndpoint = (process.env.IMAGEKIT_URL_ENDPOINT || "").replace(/\/+$/, "");

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  return res.end(
    JSON.stringify({
      ok: true,
      enabled: !!(publicKey && urlEndpoint),
      publicKey,
      urlEndpoint,
      authEndpoint: "/api/imagekit-auth",
    })
  );
};
