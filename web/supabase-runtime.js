/*
 * Bills & Vouchers: the claude.ai artifact runtime, rebuilt on Supabase.
 *
 * The app was written for claude.ai, where `window.claude.use(name)` hands it a document
 * database, the signed-in person, Claude, and downloads. This file provides the same calls,
 * backed by Supabase, so the app itself barely changes:
 *   db         -> public.app_docs (one row per document, live through Realtime)
 *   user       -> Supabase Auth (email sign-in) + public.app_profiles
 *   sample     -> the ai-sample Edge Function (Claude through the Anthropic API)
 *   downloads  -> an ordinary browser download
 *   permissions-> always granted (access is decided by the database rules)
 * Anything else (mcp, ...) resolves null, which the app already treats as "not available here".
 */
(function () {
  "use strict";
  var CFG = window.BV_CONFIG || {};
  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
  });
  window.bvSupabase = sb;

  /* ================= Sign-in gate ================= */
  var ME = null; // { authId, uid, email, name, member (approved), super }
  // Settles once someone is signed in; every capability waits on it. Never rejects.
  var ready = new Promise(function (resolve) { gate(resolve); });

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function overlay() {
    var o = document.getElementById("bvAuth");
    if (!o) {
      o = h("div", { id: "bvAuth" });
      (document.body || document.documentElement).appendChild(o);
    }
    o.hidden = false; o.textContent = "";
    var card = h("div", { class: "bvCard" });
    card.appendChild(h("h1", { text: "Bills & Vouchers Accounting" }));
    o.appendChild(card);
    return card;
  }
  function closeOverlay() { var o = document.getElementById("bvAuth"); if (o) o.hidden = true; }
  function onBody(fn) { if (document.body) fn(); else document.addEventListener("DOMContentLoaded", fn); }

  var BASE = location.origin + location.pathname;
  // Arriving from a "set a new password" email link (?reset=1).
  var RESET = /[?&]reset=1\b/.test(location.search);

  function gate(resolve) {
    sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (s && RESET) { onBody(function () { newPasswordForm(resolve); }); return; }
      if (s) return admit(s, resolve);
      onBody(function () { signInForm(resolve, "signin"); });
    });
  }

  function field(type, ac, ph, label) {
    return h("input", { type: type, required: "", autocomplete: ac, placeholder: ph, class: "bvField", "aria-label": label });
  }
  function link(text, fn) { var b = h("button", { type: "button", class: "bvLink", text: text }); b.addEventListener("click", fn); return b; }

  /* Email and password: "Sign in" for existing accounts, "Create account" for new ones. */
  function signInForm(resolve, mode, note, email0) {
    var card = overlay(), up = mode === "signup";
    var tabs = h("div", { class: "bvTabs", role: "tablist" });
    [["signin", "Sign in"], ["signup", "Create account"]].forEach(function (t) {
      var b = h("button", { type: "button", role: "tab", "aria-selected": String(mode === t[0]), class: "bvTab", text: t[1] });
      b.addEventListener("click", function () { if (mode !== t[0]) signInForm(resolve, t[0], "", em.value); });
      tabs.appendChild(b);
    });
    card.appendChild(tabs);
    card.appendChild(h("p", { class: "bvSub", text: up
      ? "Any email address works. After you create your account, you ask for access and an admin approves it."
      : "Sign in with your email and password." }));
    if (note) card.appendChild(h("p", { class: "bvErr", text: note }));
    var f = h("form", { class: "bvForm" });
    var em = field("email", "email", "you@example.com", "Email");
    if (email0) em.value = email0;
    var pw = field("password", up ? "new-password" : "current-password", up ? "Choose a password (8 or more characters)" : "Password", "Password");
    var pw2 = up ? field("password", "new-password", "Type the password again", "Password again") : null;
    var go = h("button", { type: "submit", class: "bvBtn", text: up ? "Create account" : "Sign in" });
    var st = h("p", { class: "bvSub", role: "status" });
    f.appendChild(em); f.appendChild(pw); if (pw2) f.appendChild(pw2); f.appendChild(go);
    card.appendChild(f); card.appendChild(st);
    if (!up) card.appendChild(link("Forgot password?", function () { forgotForm(resolve, em.value); }));
    card.appendChild(link("Email me a one-time sign-in code instead", function () { otpForm(resolve, em.value); }));
    (email0 ? pw : em).focus();
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = em.value.trim().toLowerCase(), pass = pw.value;
      if (!email || !pass) return;
      if (up && pass.length < 8) { st.textContent = "Use at least 8 characters for the password."; return; }
      if (up && pass !== pw2.value) { st.textContent = "The two passwords don't match."; return; }
      go.disabled = true; st.textContent = up ? "Creating your account…" : "Signing in…";
      var call = up ? sb.auth.signUp({ email: email, password: pass, options: { emailRedirectTo: BASE } })
        : sb.auth.signInWithPassword({ email: email, password: pass });
      call.then(function (r) {
        go.disabled = false;
        var m = r.error ? String(r.error.message || "") : "";
        if (r.error) {
          if (/not confirmed/i.test(m)) { confirmNote(resolve, email); return; }
          if (/invalid login/i.test(m)) { st.textContent = "Wrong email or password. If you haven't set a password yet, use Forgot password."; return; }
          if (/rate limit/i.test(m)) { st.textContent = "The app has sent too many emails in the last hour. Try again later, or ask the admin."; return; }
          if (/already registered/i.test(m)) { st.textContent = "This email already has an account. Sign in instead, or use Forgot password."; return; }
          st.textContent = m; return;
        }
        if (r.data && r.data.session) { admit(r.data.session, resolve); return; }
        confirmNote(resolve, email);
      });
    });
  }

  /* New accounts confirm their email once; after that it's just the password. */
  function confirmNote(resolve, email) {
    var card = overlay();
    card.appendChild(h("p", { class: "bvSub", text: "We sent an email to " + email + ". Open the link in it once to confirm your address. After that you sign in with your password." }));
    var st = h("p", { class: "bvSub", role: "status" });
    card.appendChild(link("Send the email again", function () {
      st.textContent = "Sending…";
      sb.auth.resend({ type: "signup", email: email, options: { emailRedirectTo: BASE } }).then(function (r) { st.textContent = r.error ? r.error.message : "Sent. Check your inbox and spam folder."; });
    }));
    card.appendChild(st);
    card.appendChild(link("Back to sign in", function () { signInForm(resolve, "signin", "", email); }));
  }

  function forgotForm(resolve, email0) {
    var card = overlay();
    card.appendChild(h("p", { class: "bvSub", text: "Enter your email. We'll send a link to set a new password." }));
    var f = h("form", { class: "bvForm" });
    var em = field("email", "email", "you@example.com", "Email"); if (email0) em.value = email0;
    var go = h("button", { type: "submit", class: "bvBtn", text: "Send the link" });
    var st = h("p", { class: "bvSub", role: "status" });
    f.appendChild(em); f.appendChild(go); card.appendChild(f); card.appendChild(st);
    card.appendChild(link("Back to sign in", function () { signInForm(resolve, "signin", "", em.value); }));
    em.focus();
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = em.value.trim().toLowerCase(); if (!email) return;
      go.disabled = true; st.textContent = "Sending…";
      sb.auth.resetPasswordForEmail(email, { redirectTo: BASE + "?reset=1" }).then(function (r) {
        go.disabled = false;
        st.textContent = r.error ? "Couldn't send the email: " + r.error.message : "If that email has an account, a link is on its way. Open it on this device.";
      });
    });
  }

  function newPasswordForm(resolve) {
    var card = overlay();
    card.appendChild(h("p", { class: "bvSub", text: "Choose a new password." }));
    var f = h("form", { class: "bvForm" });
    var pw = field("password", "new-password", "New password (8 or more characters)", "New password");
    var pw2 = field("password", "new-password", "Type it again", "New password again");
    var go = h("button", { type: "submit", class: "bvBtn", text: "Save password" });
    var st = h("p", { class: "bvSub", role: "status" });
    f.appendChild(pw); f.appendChild(pw2); f.appendChild(go); card.appendChild(f); card.appendChild(st);
    pw.focus();
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (pw.value.length < 8) { st.textContent = "Use at least 8 characters."; return; }
      if (pw.value !== pw2.value) { st.textContent = "The two passwords don't match."; return; }
      go.disabled = true; st.textContent = "Saving…";
      sb.auth.updateUser({ password: pw.value }).then(function (r) {
        go.disabled = false;
        if (r.error) { st.textContent = r.error.message; return; }
        RESET = false; history.replaceState(null, "", BASE);
        sb.auth.getSession().then(function (x) { admit(x.data.session, resolve); });
      });
    });
  }

  /* Fallback: a one-time code (or link) by email. */
  function otpForm(resolve, email0) {
    var card = overlay();
    card.appendChild(h("p", { class: "bvSub", text: "We'll email you a sign-in link and code. No password needed." }));
    var f = h("form", { class: "bvForm" });
    var em = field("email", "email", "you@example.com", "Email"); if (email0) em.value = email0;
    var go = h("button", { type: "submit", class: "bvBtn", text: "Email me a sign-in code" });
    var st = h("p", { class: "bvSub", role: "status" });
    f.appendChild(em); f.appendChild(go); card.appendChild(f); card.appendChild(st);
    card.appendChild(link("Back to sign in", function () { signInForm(resolve, "signin", "", em.value); }));
    em.focus();
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = em.value.trim().toLowerCase(); if (!email) return;
      go.disabled = true; st.textContent = "Sending…";
      sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: BASE } }).then(function (r) {
        go.disabled = false;
        if (r.error) { st.textContent = "Couldn't send the email: " + r.error.message; return; }
        codeForm(email, resolve);
      });
    });
  }

  function codeForm(email, resolve) {
    var card = overlay();
    card.appendChild(h("p", { class: "bvSub", text: "We sent an email to " + email + ". Open its link on this device, or type the code from it here." }));
    var f = h("form", { class: "bvForm" });
    var code = h("input", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: "10", placeholder: "123456", class: "bvField bvCode", "aria-label": "Code from the email" });
    var go = h("button", { type: "submit", class: "bvBtn", text: "Sign in" });
    var st = h("p", { class: "bvSub", role: "status" });
    f.appendChild(code); f.appendChild(go); card.appendChild(f); card.appendChild(st);
    card.appendChild(link("Back to sign in", function () { signInForm(resolve, "signin", "", email); }));
    code.focus();
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var t = code.value.replace(/\s/g, ""); if (!t) return;
      go.disabled = true; st.textContent = "Checking…";
      sb.auth.verifyOtp({ email: email, token: t, type: "email" }).then(function (r) {
        go.disabled = false;
        if (r.error || !r.data.session) { st.textContent = "That code didn't work. Check it, or ask for a new email."; return; }
        admit(r.data.session, resolve);
      });
    });
  }
  sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") location.reload(); });

  /* Everyone signed in gets into the app. People not approved yet see its "Ask for Access" screen;
     the database only shows them what that screen needs. */
  function admit(session, resolve) {
    return sb.rpc("app_whoami").then(function (r) {
      if (r.error) { onBody(function () { signInForm(resolve, "signin", "Couldn't check your access (" + r.error.message + "). Try again."); }); return; }
      var w = r.data || {};
      ME = { authId: session.user.id, uid: w.uid, email: w.email, super: !!w.super, member: !!w.member, name: "" };
      return sb.from("app_profiles").select("name").eq("user_id", ME.authId).maybeSingle().then(function (p) {
        var name = p.data && p.data.name;
        if (name) { ME.name = name; finish(resolve); return; }
        onBody(function () { nameForm(resolve); });
      });
    });
  }

  function nameForm(resolve) {
    var card = overlay();
    card.appendChild(h("p", { class: "bvSub", text: "One more thing: what name should the app show for you?" }));
    var f = h("form", { class: "bvForm" });
    var nm = h("input", { required: "", maxlength: "80", autocomplete: "name", placeholder: "Full name", class: "bvField", "aria-label": "Your name" });
    var go = h("button", { type: "submit", class: "bvBtn", text: "Continue" });
    var st = h("p", { class: "bvErr", role: "status" });
    f.appendChild(nm); f.appendChild(go); card.appendChild(f); card.appendChild(st); nm.focus();
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var name = nm.value.trim().replace(/\s+/g, " "); if (!name) return;
      go.disabled = true;
      sb.from("app_profiles").upsert({ user_id: ME.authId, name: name, email: ME.email, updated_at: new Date().toISOString() }).then(function (r) {
        go.disabled = false;
        if (r.error) { st.textContent = "Couldn't save your name: " + r.error.message; return; }
        ME.name = name; finish(resolve);
      });
    });
  }

  function finish(resolve) {
    onBody(function () {
      closeOverlay();
      var me = document.getElementById("me");
      if (me && !document.getElementById("bvSignOut")) {
        var b = h("button", { type: "button", id: "bvSignOut", class: "link-btn", text: "Sign out" });
        b.addEventListener("click", function () { sb.auth.signOut(); });
        me.insertAdjacentElement("afterend", b);
      }
    });
    startRealtime();
    resolve(ME);
  }

  /* ================= Errors ================= */
  function err(code, message) { return { code: code, message: message || code }; }
  function mapErr(e) {
    if (!e) return err("unavailable");
    var m = String(e.message || e);
    if (e.code === "42501" || /row-level security|permission denied/i.test(m)) return err("invalid_argument", "Not allowed: " + m);
    if (/^(22|23)/.test(String(e.code || ""))) return err("invalid_argument", m);
    if (e.code === "54000" || /too large/i.test(m)) return err("quota_exceeded", m);
    return err("unavailable", m);
  }

  /* ================= Document store ================= */
  var SEG = /^[A-Za-z0-9_.~:@+-]{1,200}$/;
  function segs(path, wantEven, what) {
    if (typeof path !== "string" || !path) throw new TypeError(what + " path must be a non-empty string");
    var s = path.split("/");
    if (s.length > 16 || path.length > 1000) throw new TypeError(what + " path too long");
    s.forEach(function (x) { if (!SEG.test(x) || x === "." || x === "..") throw new TypeError("Bad path segment '" + x + "' in " + path); });
    if ((s.length % 2 === 0) !== wantEven) throw new TypeError(what + " path '" + path + "' has " + s.length + " segments; a " + what.toLowerCase() + " needs an " + (wantEven ? "even" : "odd") + " number");
    return s;
  }
  function parentOf(path) { return path.slice(0, path.lastIndexOf("/")); }
  function idOf(path) { return path.slice(path.lastIndexOf("/") + 1); }
  function newId() {
    var a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", out = "", r = new Uint8Array(20);
    crypto.getRandomValues(r); for (var i = 0; i < 20; i++) out += a[r[i] % 62]; return out;
  }
  function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach(function (k) { deepFreeze(o[k]); }); } return o; }
  function plain(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw err("invalid_argument", "A document body must be an object");
    return JSON.parse(JSON.stringify(data));
  }

  /* Local mirror of what this page has read: path -> { json, snap } */
  var CACHE = {};
  var META = Object.freeze({ fromCache: false, hasPendingWrites: false });
  function snapFor(path, data) {
    if (data == null) return Object.freeze({ id: idOf(path), exists: false, data: function () { return undefined; }, metadata: META });
    var json = JSON.stringify(data), c = CACHE[path];
    if (c && c.json === json) return c.snap;
    var body = deepFreeze(JSON.parse(json));
    var snap = Object.freeze({ id: idOf(path), exists: true, data: function () { return body; }, metadata: META });
    CACHE[path] = { json: json, snap: snap };
    return snap;
  }

  function fetchDoc(path) {
    return ready.then(function () {
      return sb.from("app_docs").select("data").eq("path", path).maybeSingle();
    }).then(function (r) { if (r.error) throw mapErr(r.error); return r.data ? r.data.data : null; });
  }
  function fetchCollection(coll) {
    var all = [], PAGE = 1000;
    function page(from) {
      return sb.from("app_docs").select("path,data").eq("collection", coll).order("path").range(from, from + PAGE - 1).then(function (r) {
        if (r.error) throw mapErr(r.error);
        all = all.concat(r.data || []);
        return r.data && r.data.length === PAGE ? page(from + PAGE) : all;
      });
    }
    return ready.then(function () { return page(0); });
  }

  /* Live state per collection that someone is listening to. */
  var COLLS = {}; // coll -> { docs: {path: data}, loaded: bool, listeners: [] }
  var DOCS = {};  // path -> { data, loaded, listeners: [] }

  function cmp(a, b) {
    var ta = typeof a, tb = typeof b;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function has(o, f) { return o && Object.prototype.hasOwnProperty.call(o, f) && o[f] !== undefined; }
  function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function matches(d, w) {
    var v = d[w.f], x = w.v;
    switch (w.op) {
      case "==": return has(d, w.f) && eq(v, x);
      case "!=": return has(d, w.f) && !eq(v, x);
      case "<": return has(d, w.f) && typeof v === typeof x && v < x;
      case "<=": return has(d, w.f) && typeof v === typeof x && v <= x;
      case ">": return has(d, w.f) && typeof v === typeof x && v > x;
      case ">=": return has(d, w.f) && typeof v === typeof x && v >= x;
      case "in": return has(d, w.f) && Array.isArray(x) && x.some(function (y) { return eq(v, y); });
      case "not-in": return has(d, w.f) && Array.isArray(x) && !x.some(function (y) { return eq(v, y); });
      case "array-contains": return Array.isArray(v) && v.some(function (y) { return eq(y, x); });
    }
    return false;
  }
  function runQuery(q, docsByPath) {
    var rows = Object.keys(docsByPath).sort().map(function (p) { return { path: p, data: docsByPath[p] }; });
    rows = rows.filter(function (r) { return q.wh.every(function (w) { return matches(r.data, w); }); });
    if (q.ob) {
      var f = q.ob.f, dir = q.ob.dir === "desc" ? -1 : 1;
      rows.sort(function (a, b) {
        var ha = has(a.data, f), hb = has(b.data, f);
        if (!ha || !hb) return ha === hb ? 0 : ha ? -1 : 1;
        return dir * cmp(a.data[f], b.data[f]);
      });
    }
    if (q.lim) rows = rows.slice(0, q.lim);
    return rows;
  }
  function querySnap(rows, prev) {
    var docs = rows.map(function (r) { return snapFor(r.path, r.data); });
    var prevIdx = {}; (prev || []).forEach(function (d, i) { prevIdx[d.id] = { i: i, d: d }; });
    var changes = [], seen = {};
    docs.forEach(function (d, i) {
      seen[d.id] = 1; var p = prevIdx[d.id];
      if (!p) changes.push({ type: "added", doc: d, oldIndex: -1, newIndex: i });
      else if (p.d !== d || p.i !== i) changes.push({ type: "modified", doc: d, oldIndex: p.i, newIndex: i });
    });
    (prev || []).forEach(function (d, i) { if (!seen[d.id]) changes.push({ type: "removed", doc: d, oldIndex: i, newIndex: -1 }); });
    return { snap: Object.freeze({ docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return changes; }, metadata: META }), changed: changes.length > 0 || !prev };
  }

  function emitColl(coll) {
    var c = COLLS[coll]; if (!c || !c.loaded) return;
    c.listeners.slice().forEach(function (l) {
      if (l.dead) return;
      var r = querySnap(runQuery(l.q, c.docs), l.prev);
      if (!r.changed) return;
      l.prev = r.snap.docs;
      try { l.next(r.snap); } catch (e) { setTimeout(function () { throw e; }); }
    });
  }
  function emitDoc(path) {
    var d = DOCS[path]; if (!d || !d.loaded) return;
    var s = snapFor(path, d.data);
    d.listeners.slice().forEach(function (l) {
      if (l.dead || l.prev === s) return;
      if (l.prev && !l.prev.exists && !s.exists) return;
      l.prev = s;
      try { l.next(s); } catch (e) { setTimeout(function () { throw e; }); }
    });
  }
  /* Apply a known new state of one document everywhere it is watched. */
  function applyLocal(path, data) {
    var coll = parentOf(path);
    if (COLLS[coll] && COLLS[coll].loaded) {
      if (data == null) delete COLLS[coll].docs[path]; else COLLS[coll].docs[path] = data;
      emitColl(coll);
    }
    if (DOCS[path] && DOCS[path].loaded) { DOCS[path].data = data; emitDoc(path); }
  }

  function loadColl(coll, attempt) {
    var c = COLLS[coll];
    return fetchCollection(coll).then(function (rows) {
      var m = {}; rows.forEach(function (r) { m[r.path] = r.data; });
      c.docs = m; c.loaded = true; emitColl(coll);
    }, function (e) {
      if (e.code === "invalid_argument") { c.listeners.forEach(function (l) { if (!l.dead) { l.dead = true; l.error && l.error(e); } }); return; }
      setTimeout(function () { if (c.listeners.length) loadColl(coll, (attempt || 0) + 1); }, Math.min(30000, 1000 * Math.pow(2, attempt || 0)));
    });
  }
  function loadDoc(path, attempt) {
    var d = DOCS[path];
    return fetchDoc(path).then(function (data) { d.data = data; d.loaded = true; emitDoc(path); }, function () {
      setTimeout(function () { if (d.listeners.length) loadDoc(path, (attempt || 0) + 1); }, Math.min(30000, 1000 * Math.pow(2, attempt || 0)));
    });
  }

  /* Realtime: one channel for the whole table; each change re-reads that one row, so large documents
     and row-level rules are always respected. Falls back to a 30 s refresh when the stream is down. */
  var rtUp = false, pollTimer = null;
  function onChange(path) {
    var coll = parentOf(path);
    var watched = (COLLS[coll] && COLLS[coll].listeners.length) || (DOCS[path] && DOCS[path].listeners.length);
    if (!watched) return;
    fetchDoc(path).then(function (data) { applyLocal(path, data); }, function () {});
  }
  function refreshAll() {
    Object.keys(COLLS).forEach(function (k) { if (COLLS[k].listeners.length) loadColl(k); });
    Object.keys(DOCS).forEach(function (k) { if (DOCS[k].listeners.length) loadDoc(k); });
  }
  function startRealtime() {
    sb.channel("app_docs").on("postgres_changes", { event: "*", schema: "public", table: "app_docs" }, function (p) {
      var path = (p.new && p.new.path) || (p.old && p.old.path);
      if (path) onChange(path);
    }).subscribe(function (status) {
      var was = rtUp; rtUp = status === "SUBSCRIBED";
      if (rtUp && !was && pollTimer) { clearInterval(pollTimer); pollTimer = null; refreshAll(); }
      if (!rtUp && !pollTimer) pollTimer = setInterval(refreshAll, 30000);
    });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && !rtUp) refreshAll(); });
    window.addEventListener("online", refreshAll);
  }

  function makeQuery(coll, q) {
    return {
      where: function (f, op, v) {
        if (q.wh.length >= 10) throw new TypeError("At most 10 filters");
        return makeQuery(coll, { wh: q.wh.concat([{ f: f, op: op, v: v }]), ob: q.ob, lim: q.lim });
      },
      orderBy: function (f, dir) { return makeQuery(coll, { wh: q.wh, ob: { f: f, dir: dir || "asc" }, lim: q.lim }); },
      limit: function (n) { return makeQuery(coll, { wh: q.wh, ob: q.ob, lim: Math.max(1, Math.min(1000, n | 0)) }); },
      get: function () {
        return fetchCollection(coll).then(function (rows) {
          var m = {}; rows.forEach(function (r) { m[r.path] = r.data; });
          return querySnap(runQuery(q, m), null).snap;
        });
      },
      onSnapshot: function (next, error) {
        var c = COLLS[coll] || (COLLS[coll] = { docs: {}, loaded: false, listeners: [] });
        var l = { q: q, next: next, error: error, prev: null, dead: false };
        c.listeners.push(l);
        if (c.loaded) setTimeout(function () { emitColl(coll); }, 0);
        else if (c.listeners.length === 1 || !c.loading) { c.loading = true; loadColl(coll).then(function () { c.loading = false; }); }
        return function () { l.dead = true; var i = c.listeners.indexOf(l); if (i >= 0) c.listeners.splice(i, 1); };
      }
    };
  }
  function collRef(path) {
    segs(path, false, "Collection");
    var base = makeQuery(path, { wh: [], ob: null, lim: 0 });
    base.path = path;
    base.doc = function (id) { return docRef(path + "/" + (id == null ? newId() : id)); };
    base.add = function (data) { var r = base.doc(); return r.set(data).then(function () { return r; }); };
    return base;
  }
  var writing = {}; // path -> promise; one write at a time per document
  function serial(path, fn) {
    var prev = writing[path] || Promise.resolve();
    var p = prev.catch(function () {}).then(fn);
    var done = function () { if (writing[path] === p) delete writing[path]; };
    writing[path] = p;
    p.then(done, done);
    return p;
  }
  function docRef(path) {
    segs(path, true, "Document");
    return {
      id: idOf(path), path: path,
      get: function () { return fetchDoc(path).then(function (d) { return snapFor(path, d); }); },
      set: function (data) {
        var body; try { body = plain(data); } catch (e) { return Promise.reject(e); }
        return serial(path, function () {
          return ready.then(function () {
            return sb.from("app_docs").upsert({ path: path, data: body, updated_at: new Date().toISOString(), updated_by: ME.authId }, { onConflict: "path" });
          }).then(function (r) { if (r.error) throw mapErr(r.error); applyLocal(path, body); });
        });
      },
      update: function (data) {
        var body; try { body = plain(data); } catch (e) { return Promise.reject(e); }
        return serial(path, function () {
          return ready.then(function () { return sb.rpc("doc_update", { p_path: path, p_patch: body }); }).then(function (r) {
            if (r.error) throw mapErr(r.error);
            if (!r.data) throw err("invalid_argument", "update() needs an existing document: " + path);
            return fetchDoc(path).then(function (d) { applyLocal(path, d); }, function () {});
          });
        });
      },
      delete: function () {
        return serial(path, function () {
          return ready.then(function () { return sb.from("app_docs").delete().eq("path", path); }).then(function (r) {
            if (r.error) throw mapErr(r.error); applyLocal(path, null);
          });
        });
      },
      acquire: function () { return Promise.resolve({ acquired: true }); },
      onSnapshot: function (next, error) {
        var d = DOCS[path] || (DOCS[path] = { data: null, loaded: false, listeners: [] });
        var l = { next: next, error: error, prev: null, dead: false };
        d.listeners.push(l);
        if (d.loaded) setTimeout(function () { emitDoc(path); }, 0); else loadDoc(path);
        return function () { l.dead = true; var i = d.listeners.indexOf(l); if (i >= 0) d.listeners.splice(i, 1); };
      },
      collection: function (sub) { return collRef(path + "/" + sub); }
    };
  }
  var DB = Object.freeze({ doc: docRef, collection: collRef });

  /* ================= People ================= */
  var PROF = {};
  function profiles(ids) {
    ids = (ids || []).filter(function (x) { return typeof x === "string" && /^u_[0-9a-f]{32}$/.test(x); });
    var need = ids.filter(function (x) { return !PROF[x]; });
    var p = need.length ? ready.then(function () { return sb.from("app_profiles").select("uid,name,email").in("uid", need); }).then(function (r) {
      (r.data || []).forEach(function (row) { PROF[row.uid] = { id: row.uid, name: row.name || "", email: row.email || "", avatarUrl: "", guest: false }; });
    }, function () {}) : Promise.resolve();
    return p.then(function () { var out = {}; ids.forEach(function (x) { out[x] = PROF[x] || { id: x, name: "", avatarUrl: "", guest: false }; }); return out; });
  }
  var USER = Object.freeze({
    id: function () { return ready.then(function (m) { return m.uid; }); },
    name: function () { return ready.then(function (m) { return m.name; }); },
    avatarUrl: function () { return Promise.resolve(null); },
    me: function () { return ready.then(function (m) { return { id: m.uid, name: m.name, email: m.email, avatarUrl: "", guest: false, canEdit: m.super, isOwner: m.super }; }); },
    isOwner: function () { return ready.then(function (m) { return m.super; }); },
    canEdit: function () { return ready.then(function (m) { return m.super; }); },
    // Everyone signed in may write their own access request; the database refuses anything else.
    can: function (what) { return ready.then(function () { return what === "data.write" ? true : null; }); },
    profiles: profiles,
    search: function (q) {
      return ready.then(function () {
        var s = sb.from("app_profiles").select("uid,name").order("name").limit(8);
        if (q) s = s.ilike("name", "%" + String(q).replace(/[%_]/g, "") + "%");
        return s;
      }).then(function (r) { return (r.data || []).map(function (row) { return { id: row.uid, name: row.name, avatarUrl: "", guest: false }; }); });
    }
  });

  /* ================= Claude (through the ai-sample Edge Function) ================= */
  var IMG_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  function shrink(blob) {
    // Like claude.ai: about 1.2 megapixels, sent as JPEG.
    return createImageBitmap(blob).then(function (bm) {
      var sc = Math.min(1, Math.sqrt(1200000 / (bm.width * bm.height)));
      var cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(bm.width * sc)); cv.height = Math.max(1, Math.round(bm.height * sc));
      var cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bm, 0, 0, cv.width, cv.height);
      return new Promise(function (res) { cv.toBlob(res, "image/jpeg", 0.9); });
    }).then(function (b) {
      return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res({ media_type: "image/jpeg", data: String(fr.result).split(",")[1] }); }; fr.onerror = rej; fr.readAsDataURL(b); });
    }, function () { throw err("image_rejected", "An image couldn't be read."); });
  }
  function ask(input, opts, wantJson) {
    opts = opts || {};
    var turns = typeof input === "string" ? [{ role: "user", content: input }] : (input || []).map(function (t) { return { role: t.role, content: String(t.content) }; });
    if (wantJson && turns.length) {
      var last = turns[turns.length - 1];
      last.content += "\n\nReply with only valid JSON: no prose before or after it and no code fences.";
    }
    var imgs = opts.images ? (opts.images instanceof Blob ? [opts.images] : Array.prototype.slice.call(opts.images)) : [];
    return ready.then(function () {
      return Promise.all(imgs.slice(0, 8).map(function (b) { if (b.type && IMG_TYPES.indexOf(b.type) < 0 && !/^image\//.test(b.type)) throw err("image_rejected", "Not an image"); return shrink(b); }));
    }).then(function (images) {
      return sb.auth.getSession().then(function (s) {
        var tok = s.data.session && s.data.session.access_token;
        return fetch(CFG.supabaseUrl + "/functions/v1/ai-sample", {
          method: "POST", signal: opts.signal,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok, apikey: CFG.supabaseKey },
          body: JSON.stringify({ messages: turns, images: images, modelTier: opts.modelTier || "default" })
        });
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw err(j.code || "upstream_error", j.message || ("HTTP " + r.status));
        if (typeof opts.onText === "function") { try { opts.onText({ text: j.text || "", delta: j.text || "" }); } catch (e) {} }
        return { text: j.text || "", truncated: !!j.truncated, modelTierApplied: j.modelTierApplied };
      });
    }, function (e) {
      if (e && e.name === "AbortError") throw err("cancelled", "Cancelled");
      if (e && e.code) throw e;
      throw err("upstream_error", String((e && e.message) || e));
    });
  }
  function parseJson(text) {
    var t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try { return JSON.parse(t); } catch (e) {}
    var a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
    throw err("invalid_json", "Claude's answer wasn't valid JSON");
  }
  var SAMPLE = function (input, opts) { return ask(input, opts, false); };
  SAMPLE.json = function (input, opts) { return ask(input, opts, true).then(function (r) { return parseJson(r.text); }); };
  SAMPLE.limits = function () { return Promise.resolve({ images: { maxCount: 8, maxInputBytes: 20 * 1024 * 1024, mediaTypes: IMG_TYPES.slice() } }); };
  Object.freeze(SAMPLE);

  /* ================= Downloads and permissions ================= */
  var DOWNLOADS = Object.freeze({
    save: function (o) {
      var data = o && o.data, name = (o && o.filename) || "download";
      var blob = data instanceof Blob ? data : new Blob([data]);
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return Promise.resolve();
    }
  });
  var PERMS = Object.freeze({
    state: function (n) { return Promise.resolve(n ? "granted" : {}); },
    request: function () { return Promise.resolve({}); },
    manage: function () { return Promise.reject(err("unavailable", "No permissions panel here")); }
  });

  var CAPS = { db: DB, user: USER, sample: SAMPLE, downloads: DOWNLOADS, permissions: PERMS };
  window.claude = Object.freeze({
    use: function (name) {
      if (name === "permissions" || name === "downloads") return Promise.resolve(CAPS[name]);
      if (!CAPS[name]) return Promise.resolve(null);
      return ready.then(function () { return CAPS[name]; });
    }
  });
})();
