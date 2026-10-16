/* KKSK Group home: after sign-in, open the one app a person has, or show a tile for each. */
(function () {
  "use strict";
  var APPS = [
    { key: "mnt", name: "Maintenance & Civil", path: "maintenance/", desc: "Bills, proformas and imports, cash vouchers and checking reports for the maintenance and civil division.",
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>' },
    { key: "re", name: "Renewable Energy", path: "renewable/", desc: "Solar and windmill bills of supply from TNPDCL statements, receipts, and the division's own bills, proformas, vouchers and payments.",
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' },
    { key: "acc", name: "Accounts", path: "accounts/", desc: "Every division's bills and vouchers accounted to ledgers, debit and credit notes, ledger books, vendors and companies.",
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="M4 9h16M9 9v11M13 13h4M13 17h4"/></svg>' },
    { key: "fin", name: "Finance", path: "finance/", desc: "Payment Entry and advances, with every division's payables in one place.",
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M6 15h4"/></svg>' },
    { key: "apr", name: "Approvals", path: "approvals/", desc: "Bills, advance and voucher checking reports and cash advances from every division, approved for payment.",
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>' },
    { key: "pp", name: "Production Planning", path: "production/", desc: "Leather lots from issue to dispatch, stage updates, approvals and stock, for Erode and Ambur.",
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21V9l6 4V9l6 4V5l6 4v12z"/><path d="M7 17h2M12 17h2M17 17h2"/></svg>' }
  ];
  /* Apps taken off the home page for now; access already given is kept for when they come back. */
  var HIDDEN = { pp: true };
  var ROLE_PP = { super_admin: "Super Admin", admin: "Admin", approver: "Approver", planner: "Planner", floor: "Floor Team" };
  var REGION = { E: "Erode", A: "Ambur" };

  /* The look a person chose in Personalise, kept in this browser by the apps. */
  try {
    var pr = JSON.parse(localStorage.getItem("bv_prefs_last") || "null");
    if (pr) {
      var dark = pr.theme === "dark" || (pr.theme === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
      document.documentElement.setAttribute("data-accent", pr.accent || "green");
    }
  } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function el(t, a, txt) { var e = document.createElement(t); if (a) Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); }); if (txt != null) e.textContent = txt; return e; }
  function initials(n) { var w = String(n || "").trim().split(/\s+/).filter(Boolean); return ((w[0] || "?").charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : "")).toUpperCase(); }

  /* Only a path inside this site, in an app the person has, may be returned to after sign-in. */
  var NEXT = (function () { var m = /[?&]next=([^&]+)/.exec(location.search), n = m ? decodeURIComponent(m[1]) : ""; return /^\/[^/\\]/.test(n) ? n : ""; })();
  function landing(a) { return NEXT && NEXT.indexOf("/" + a.path) >= 0 ? NEXT : a.path; }

  function render(p) {
    /* Before the four-app split reached the database, apps.bv stood for all of them. */
    if (p.apps && p.apps.mnt === undefined && p.apps.bv) { p.apps.mnt = p.apps.acc = p.apps.fin = true; }
    if (p.apps && p.apps.apr === undefined && p.admin) p.apps.apr = true;
    var mine = APPS.filter(function (a) { return p.apps && p.apps[a.key] && !HIDDEN[a.key]; });
    /* Not approved yet: the access request lives in Maintenance. One app: straight in. */
    if (!p.approved) { location.replace("maintenance/"); return; }
    if (mine.length === 1) { location.replace(landing(mine[0])); return; }
    var want = NEXT && mine.filter(function (a) { return NEXT.indexOf("/" + a.path) >= 0; })[0];
    if (want) { location.replace(landing(want)); return; }
    $("top").hidden = false; $("bar").hidden = false; $("main").hidden = false;
    var me = $("me"), av = el("span", { class: "av", "aria-hidden": "true" }, initials(p.name));
    try { var full = JSON.parse(localStorage.getItem("bv_prefs_" + p.uid) || "null"); if (full && full.avatar) { av = el("img", { class: "av", alt: "", src: full.avatar }); } } catch (e) {}
    var who = el("div"); who.appendChild(el("div", { class: "nm" }, p.name || p.email || "Signed in")); who.appendChild(el("div", { class: "rl" }, p.super ? "Super Admin" : p.admin ? "Admin" : p.email || ""));
    var so = el("button", { type: "button", class: "lnk" }, "Sign Out"); so.addEventListener("click", function () { window.bvSupabase.auth.signOut(); });
    me.appendChild(av); me.appendChild(who); me.appendChild(so);
    var first = String(p.name || "").trim().split(/\s+/)[0];
    $("hi").textContent = first ? "Welcome, " + first : "Welcome";
    var box = $("tiles");
    if (!mine.length) {
      $("hiSub").textContent = "";
      var n = el("div", { class: "note" }); n.appendChild(el("b", null, "No apps are open to you yet."));
      n.appendChild(el("p", null, "Ask an admin to give you an app under Settings › Users."));
      box.replaceWith(n); return;
    }
    mine.forEach(function (a) {
      var t = el("a", { class: "tile", href: a.path });
      var ic = el("span", { class: "ic" }); ic.innerHTML = a.icon; t.appendChild(ic);
      t.appendChild(el("b", null, a.name)); t.appendChild(el("p", null, a.desc));
      var r = a.key === "pp" && p.apps.pp ? ROLE_PP[p.apps.pp.role] + (p.apps.pp.region ? " · " + REGION[p.apps.pp.region] : "") : p.super ? "Super Admin" : p.admin ? "Admin" : "";
      if (r) t.appendChild(el("span", { class: "role" }, r));
      t.appendChild(el("span", { class: "go" }, "Open →"));
      box.appendChild(t);
    });
  }

  window.bvPortal().then(render, function () {
    $("main").hidden = false; $("hi").textContent = "Couldn't load your apps"; $("hiSub").textContent = "Check the connection, then reload the page.";
  });
})();
