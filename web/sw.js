/* KKSK installed app helper. It stores nothing: every page and file comes fresh from the server,
   so the installed app is always the latest version. With no connection it shows a short notice. */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function (e) {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(function () {
    return new Response('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>No connection</title>' +
      '<body style="margin:0;font:16px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;box-sizing:border-box">' +
      '<div><h1 style="font-size:20px">No internet connection</h1><p>KKSK needs the internet. Check your connection, then try again.</p>' +
      '<button onclick="location.reload()" style="font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#10281F;color:#fff">Try Again</button></div>',
      { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }));
});
