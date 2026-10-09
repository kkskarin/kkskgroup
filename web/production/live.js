/* Production Planning, Live mode: the page's working state comes from the KKSK-Production tables and every change is
   written back. Demo mode keeps the sample data in this browser only (admins switch with the DEMO / LIVE pill;
   everyone else is always Live). The page keeps all its planning logic; this file only loads and saves. */
(function () {
  "use strict";
  var L = window.PPLive = { on: false, busy: false };
  var db = function () { return window.ppDb; };
  var snap = null, queue = Promise.resolve(), dirty = false, running = false, me = null, onChange = null, reloadT = null, pendingReload = false;

  /* ---------- mode ---------- */
  function modeKey() { return "pp_mode_" + String((me && me.email) || "").toLowerCase(); }
  L.mode = function (who) {
    me = who || me;
    if (!(me && (me.admin || me.super))) return "live";
    try { return localStorage.getItem(modeKey()) === "demo" ? "demo" : "live"; } catch (e) { return "live"; }
  };
  L.toggle = function () {
    var next = L.mode() === "live" ? "demo" : "live";
    try { localStorage.setItem(modeKey(), next); } catch (e) {}
    location.reload();
  };

  /* ---------- screen settings (role preview, plant, tab, look) stay in this browser ---------- */
  function uiKey() { return "kksk-pp-ui-" + String((me && me.email) || "").toLowerCase(); }
  L.saveUI = function (S) { try { localStorage.setItem(uiKey(), JSON.stringify({ role: S.role, viewAs: S.viewAs, region: S.region, tab: S.tab, prefs: S.prefs })); } catch (e) {} };
  function loadUI() { try { return JSON.parse(localStorage.getItem(uiKey()) || "null") || {}; } catch (e) { return {}; } }

  /* ---------- helpers ---------- */
  var KIND_IN = { cancel: "cancel", moveLot: "move_lot", movePool: "move_pool" }, KIND_OUT = { cancel: "cancel", move_lot: "moveLot", move_pool: "movePool" };
  var ENTRY_IN = function (k, e) { return k === "finishing" ? ((e.totals && e.totals.mode) === "out" ? "finishing_out" : "finishing_in") : k; };
  var OP_IN = { Sammed: "sammed", Split: "split", Shaved: "shaved" }, OP_OUT = { sammed: "Sammed", split: "Split", shaved: "Shaved" };
  var DRUM = { lining: 3500, suede: 2500, upper: 3400 };
  function nn(v) { return v == null || v === "" ? null : v; }
  function num(v) { var x = Number(v); return isFinite(x) ? x : null; }
  function day(ts) { return ts ? new Date(new Date(ts).getTime() + 5.5 * 36e5).toISOString().slice(0, 10) : null; }
  function must(r) { if (r.error) throw r.error; return r.data; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function lotRow(l) {
    var m = l.m || {};
    return {
      id: l.id, is_demo: false, kind: l.kind || "bulk", sku: l.sku, issue_region: l.issueRegion, current_region: l.region,
      issue_type: l.type, from_stock: l.fromStock || null, planned_date: l.date, planned_output: Math.round(l.plannedOut),
      planned_issue: Math.round(l.plannedIssue != null ? l.plannedIssue : l.issue), rates: l.rates || {}, rate_source: l.rateSrc || null,
      stage: l.stage, status: l.status, issued_date: nn(l.issueDate), issued_by: nn(l.issuedBy), issue_m0: nn(l.m0),
      issue_m10: l.issueDate ? l.issue : null, issue_pcs: nn(m.issuePcs), crust_qc_required: l.crustQC === "Yes",
      crust_deadline: nn(l.crustDL), sammed_date: nn(l.sammedDate), split_date: nn(l.splitDate), shaved_date: nn(l.shavedDate),
      dyed_date: nn(l.dyedDate), dye_sammed_date: nn(l.dyeSammedDate), dye_set_date: nn(l.dyeSetDate), vacuum_date: nn(l.vacDate),
      crust_date: nn(l.crustDate), crust: nn(m.crust), crust_pcs: nn(m.crustPcs), qc_date: nn(l.qcDate),
      taken_crust: nn(m.takenCrust), taken_crust_pcs: nn(m.takenCrustPcs), reject_crust: nn(m.rejectCrust), reject_crust_pcs: nn(m.rejectCrustPcs),
      fin_in_date: nn(l.finInDate), fin_out_date: nn(l.finOutDate), fld_date: nn(l.fldDate), fld: nn(m.fld), fld_pcs: nn(m.fldPcs),
      close_date: nn(l.closeDate), taken_fl: nn(m.takenFL), taken_fl_pcs: nn(m.takenPcs), reject_fl: nn(m.rejectFL), reject_fl_pcs: nn(m.rejectPcs),
      dispatch: nn(m.dispatch), dispatch_pcs: nn(m.dispatchPcs), extra: clone(l)
    };
  }
  /* A lot as the page knows it: its saved copy, with the shared columns (number, stage, status, plant) taking precedence. */
  function lotFrom(r) {
    var x = r.extra && r.extra.id ? r.extra : {
      id: r.id, sku: r.sku, kind: r.kind, type: r.issue_type, date: r.planned_date, plannedOut: num(r.planned_output),
      issue: num(r.issue_m10 != null ? r.issue_m10 : r.planned_issue), plannedIssue: r.issue_m10 != null ? num(r.planned_issue) : undefined,
      rates: r.rates || {}, rateSrc: r.rate_source || "", m: {}, log: [], issueDate: r.issued_date, issuedBy: r.issued_by, m0: num(r.issue_m0),
      crustQC: r.crust_qc_required ? "Yes" : "No", crustDL: r.crust_deadline
    };
    x.id = r.id; x.no = r.lot_no || x.no; x.stage = r.stage; x.status = r.status; x.region = r.current_region; x.issueRegion = r.issue_region;
    x.m = x.m || {}; x.log = x.log || [];
    return x;
  }
  function entryRow(e) {
    return { client_id: e.id, is_demo: false, kind: ENTRY_IN(e.kind, e), region: e.region, entry_date: e.date, sku: e.sku || null,
      totals: e.totals || {}, extra: { kind: e.kind, at: e.at, lotIds: e.lotIds || [], per: e.per || {}, editedAt: e.editedAt || null } };
  }
  function entryFrom(r) {
    var x = r.extra || {};
    return { id: r.client_id || "e" + r.id, dbId: r.id, kind: x.kind || r.kind, region: r.region, date: r.entry_date, at: x.at || day(r.entered_at),
      sku: r.sku, lotIds: x.lotIds || [], totals: r.totals || {}, per: x.per || {}, editedAt: x.editedAt || (r.edited_at ? day(r.edited_at) : undefined) };
  }
  function apRow(a) {
    return { client_id: a.id, is_demo: false, kind: KIND_IN[a.kind] || a.kind, lot_id: a.lotId || null, msku: a.sku || null,
      from_region: a.from || null, to_region: a.to || null, qty: a.qty != null ? a.qty : null, reason: a.reason || null, status: a.status,
      extra: { by: a.by || "", at: a.at || null, decidedBy: a.decidedBy || null } };
  }
  function apFrom(r) {
    var x = r.extra || {};
    return { id: r.client_id || "ap" + r.id, dbId: r.id, kind: KIND_OUT[r.kind] || r.kind, lotId: r.lot_id, sku: r.msku, from: r.from_region, to: r.to_region,
      qty: num(r.qty), reason: r.reason || "", status: r.status, by: x.by || "", at: x.at || day(r.requested_at), decidedBy: x.decidedBy || undefined };
  }
  function skuFrom(r) {
    var parts = String(r.sku).split(" / ");
    return { code: r.sku, article: parts[0] || r.sku, substance: parts.length > 2 ? parts[1] : (r.article_substance || "").split(" / ")[1] || "",
      colour: r.colour || parts[2] || "", tannage: r.tannage === "chrome_free" ? "chrome-free" : (r.tannage || "chrome"),
      type: r.article_type || "upper", soldAs: r.sold_as || "finished", drum: num(r.drum_capacity) || DRUM[r.article_type] || 3400,
      tol: num(r.drum_tolerance_pct) != null ? num(r.drum_tolerance_pct) : 8, swatch: r.swatch || "" };
  }
  function skuGuess(o) {
    var code = String(o.sku || o.msku || "").trim(), p = code.split(" / "), t = String(o.type_of_article || "").toLowerCase();
    var ty = t === "lining" || t === "suede" ? t : "upper";
    return { code: code, article: p[0] || code, substance: p[1] || "", colour: o.colour || p[2] || "", tannage: "chrome", type: ty, soldAs: "finished", drum: DRUM[ty], tol: 8, swatch: "", guessed: true };
  }
  function skuRow(s) {
    return { sku: s.code, article_substance: [s.article, s.substance].filter(Boolean).join(" / "), colour: s.colour || null,
      article_type: ["upper", "lining", "suede"].indexOf(s.type) >= 0 ? s.type : null, tannage: s.tannage === "chrome-free" ? "chrome_free" : "chrome",
      sold_as: ["finished", "crust", "both"].indexOf(s.soldAs) >= 0 ? s.soldAs : "finished", drum_capacity: s.drum > 0 ? s.drum : null,
      drum_tolerance_pct: s.tol != null ? s.tol : 8, swatch: s.swatch || null };
  }
  function stockKey(x) { return x.sku + "|" + x.region + "|" + x.kind; }
  function stockSums(list) { var o = {}; (list || []).forEach(function (x) { o[stockKey(x)] = (o[stockKey(x)] || 0) + (Number(x.qty) || 0); }); return o; }

  /* What has been saved, to compare the page's state against. */
  function takeSnap(S) {
    var s = { lots: {}, entries: {}, approvals: {}, rates: {}, poolMoves: S.poolMoves.length, wf1Other: S.wf1Other.length,
      stock: stockSums(S.stock), pooled: {}, dispatched: {}, alloc: snap ? snap.alloc : {}, skus: snap ? snap.skus : {} };
    S.lots.forEach(function (l) { s.lots[l.id] = JSON.stringify(lotRow(l)); });
    S.entries.forEach(function (e) { s.entries[e.id] = JSON.stringify(entryRow(e)); });
    S.approvals.forEach(function (a) { s.approvals[a.id] = JSON.stringify(apRow(a)); });
    Object.keys(S.rates).forEach(function (k) { s.rates[k] = JSON.stringify(S.rates[k]); });
    S.orders.forEach(function (o) { s.pooled[o.id] = !!o.pooled; s.dispatched[o.id] = o.dispatched; });
    return s;
  }

  /* ---------- load ---------- */
  function all(q) { return q.then(must); }
  L.load = function (who, base) {
    me = who;
    var d = db(), F = false;
    return Promise.all([
      all(d.from("pp_lots").select("*").eq("is_demo", F).order("created_at")),
      all(d.from("pp_entries").select("*").eq("is_demo", F).order("entered_at")),
      all(d.from("pp_approvals").select("*").eq("is_demo", F).order("requested_at")),
      all(d.from("pp_stock").select("*").eq("is_demo", F)),
      all(d.from("pp_orders").select("*")),
      all(d.from("pp_order_pooling").select("uid").eq("is_demo", F)),
      all(d.from("pp_dispatch_alloc").select("uid,qty").eq("is_demo", F)),
      all(d.from("pp_skus").select("*")),
      all(d.from("pp_yield_defaults").select("*").eq("is_demo", F)),
      all(d.from("pp_lot_actual_rates").select("*").eq("is_demo", F)),
      all(d.from("pp_pool_moves").select("*").eq("is_demo", F).order("created_at")),
      all(d.from("pp_wf1_other").select("*").eq("is_demo", F).order("entered_at")),
      all(d.from("pp_pool_runs").select("run_at").eq("is_demo", F).order("run_at", { ascending: false }).limit(1)),
      (who.admin || who.super) ? d.from("pp_audit").select("*").or("is_demo.eq.false,is_demo.is.null").order("at", { ascending: false }).limit(300).then(function (r) { return r.data || []; }) : Promise.resolve([]),
      (who.admin || who.super) ? d.from("pp_users").select("id,name,email").then(function (r) { return r.data || []; }) : Promise.resolve([])
    ]).then(function (R) {
      var S = base;
      var pooled = {}; R[5].forEach(function (x) { pooled[x.uid] = true; });
      var alloc = {}; R[6].forEach(function (x) { alloc[x.uid] = (alloc[x.uid] || 0) + Number(x.qty || 0); });
      S.lots = R[0].map(lotFrom);
      S.entries = R[1].map(entryFrom);
      S.approvals = R[2].map(apFrom);
      S.stock = R[3].map(function (x) { return { id: "s:" + stockKey(x), sku: x.sku, region: x.region, kind: x.kind, qty: Number(x.qty), date: day(x.last_move) }; });
      S.orders = R[4].filter(function (o) { return o.region && (o.sku || o.msku); }).map(function (o) {
        var z = Number(o.zoho_dispatched_qty || 0), a = alloc[o.uid] || 0;
        return { id: o.uid, pi: o.pi_number || o.uid, cust: o.customer_name || "", brand: o.brand || "", sku: String(o.sku || o.msku).trim(),
          qty: Number(o.order_qty || 0), due: o.due_date || o.fl_deadline || day(o.synced_at), place: o.region, pooled: !!pooled[o.uid],
          dispatched: Math.max(z, a), arrived: o.pi_date || day(o.synced_at), status: o.order_status || "" };
      });
      var skus = {}, inDb = {};
      R[7].forEach(function (r) { skus[r.sku] = skuFrom(r); inDb[r.sku] = true; });
      R[4].forEach(function (o) { var g = skuGuess(o); if (g.code && !skus[g.code]) skus[g.code] = g; });
      S.lots.forEach(function (l) { if (!skus[l.sku]) skus[l.sku] = skuGuess({ sku: l.sku }); });
      S.skus = Object.keys(skus).sort().map(function (k) { return skus[k]; });
      S.rates = {};
      R[8].forEach(function (r) { var o = {}; ["cs", "cq", "fs", "tw", "fq"].forEach(function (k) { if (r[k] != null) o[k] = Number(r[k]); }); S.rates[r.sku + "|" + r.issue_type] = o; });
      S.hist = R[9].map(function (r) { var o = {}; ["cs", "cq", "fs", "tw", "fq"].forEach(function (k) { if (r[k] != null) o[k] = Number(r[k]); });
        return { lot: r.lot_id, sku: r.sku, type: r.issue_type, date: r.close_date, qty: Number(r.planned_output || 0), r: o }; });
      S.poolMoves = R[10].map(function (m) { return { sku: m.msku, from: m.from_region, to: m.to_region, qty: Number(m.qty) }; });
      S.wf1Other = R[11].map(function (w) { return { date: w.work_date, op: OP_OUT[w.operation] || w.operation, qty: Number(w.qty), remark: w.remarks || "", region: w.region }; });
      if (R[12][0]) S.cons = { last: day(R[12][0].run_at) };
      var names = {}; R[14].forEach(function (u) { names[u.id] = u.name || u.email; });
      var TBL = { pp_lots: "Lot", pp_entries: "Lot data", pp_approvals: "Approval", pp_stock_moves: "Stock", pp_pool_moves: "Pool move", pp_order_pooling: "Pooling",
        pp_yield_defaults: "Default rates", pp_skus: "SKU", pp_users: "User", pp_wf1_other: "Other WF1 work", pp_dispatch_alloc: "Dispatch" };
      var VERB = { insert: "added", update: "changed", delete: "removed" };
      S.audit = R[13].map(function (a) {
        var c = a.changes || {};
        return { at: a.at, by: names[a.user_id] || (a.user_id ? "Someone" : "System"), action: (TBL[a.table_name] || a.table_name || "Record") + " " + (VERB[a.action] || a.action),
          detail: c.lot_no || c.sku || c.msku || c.uid || c.name || c.email || "" };
      });
      S.counters = {};
      S.seq = Math.max(Number(S.seq) || 0, Date.now() * 100 + Math.floor(Math.random() * 100));
      snap = takeSnap(S); snap.alloc = alloc; snap.skus = inDb;
      L.on = true;
      return S;
    });
  };
  L.restoreUI = function (S, who) { var u = loadUI(); ["role", "viewAs", "region", "tab", "prefs"].forEach(function (k) { if (u[k] != null) S[k] = u[k]; }); return S; };

  /* ---------- save: write whatever changed, one step at a time ---------- */
  L.sync = function (S) {
    if (!L.on || !snap) return;
    dirty = true;
    if (running) return;
    running = true; L.busy = true;
    queue = queue.then(function loop() {
      if (!dirty) return;
      dirty = false;
      return push(S).then(loop);
    }).catch(function (e) {
      dirty = false;
      if (onChange) onChange("error", (e && (e.message || e.details)) || "The change couldn't be saved");
      return L.reload();
    }).then(function () { running = false; L.busy = false; if (pendingReload) { pendingReload = false; later(); } });
  };

  function push(S) {
    var d = db(), steps = [], newLots = [];
    var need = function (code) {
      if (snap.skus[code]) return null;
      var s = S.skus.filter(function (x) { return x.code === code; })[0]; if (!s) return null;
      return function () { return d.from("pp_skus").upsert(skuRow(s), { onConflict: "sku", ignoreDuplicates: true }).then(must).then(function () { snap.skus[code] = true; }); };
    };
    /* default rates (each needs its SKU in the SKU list first) */
    Object.keys(S.rates).forEach(function (k) {
      var v = JSON.stringify(S.rates[k]); if (snap.rates[k] === v) return;
      var p = k.split("|"), r = S.rates[k], sk = need(p[0]); if (sk) steps.push(sk);
      steps.push(function () {
        return d.from("pp_yield_defaults").upsert({ is_demo: false, sku: p[0], issue_type: p[1], cs: nn(r.cs), cq: nn(r.cq), fs: nn(r.fs), tw: nn(r.tw), fq: nn(r.fq) }, { onConflict: "is_demo,sku,issue_type" })
          .then(must).then(function () { snap.rates[k] = v; });
      });
    });
    Object.keys(snap.rates).forEach(function (k) {
      if (S.rates[k]) return; var p = k.split("|");
      steps.push(function () { return d.from("pp_yield_defaults").delete().eq("is_demo", false).eq("sku", p[0]).eq("issue_type", p[1]).then(must).then(function () { delete snap.rates[k]; }); });
    });
    /* lots */
    S.lots.forEach(function (l) {
      var row = lotRow(l), v = JSON.stringify(row);
      if (snap.lots[l.id] === v) return;
      if (!snap.lots[l.id]) {
        steps.push(function () {
          var ins = Object.assign({}, row); delete ins.stage;
          return d.from("pp_lots").insert(ins).select("lot_no,stage").single().then(must).then(function (got) {
            l.no = got.lot_no; if (l.log && l.log[0]) l.log[0].at = l.log[0].at || l.date; newLots.push(l.no);
            var again = lotRow(l);
            if (got.stage !== l.stage || JSON.stringify(again.extra) !== JSON.stringify(row.extra)) {
              var up = Object.assign({}, again); ["id", "is_demo", "issue_region"].forEach(function (k) { delete up[k]; });
              return d.from("pp_lots").update(up).eq("id", l.id).then(must);
            }
          }).then(function () { snap.lots[l.id] = JSON.stringify(lotRow(l)); });
        });
      } else {
        steps.push(function () {
          var up = Object.assign({}, row); ["id", "is_demo", "issue_region"].forEach(function (k) { delete up[k]; });
          return d.from("pp_lots").update(up).eq("id", l.id).then(must).then(function () { snap.lots[l.id] = v; });
        });
      }
    });
    /* lot data entries, with the lots they cover and the issue measurement rows */
    S.entries.forEach(function (e) {
      var row = entryRow(e), v = JSON.stringify(row);
      if (snap.entries[e.id] === v) return;
      var rows = function (id) { return ((e.totals && e.totals.rows) || []).filter(function (x) { return Number(x.pcs) > 0 && Number(x.m0) > 0; })
        .map(function (x) { return { entry_id: id, grade: x.grade || null, size_range: x.size || null, pieces: Math.round(Number(x.pcs)), m0: Number(x.m0), m10: Math.round(Number(x.m0) * 1.1) }; }); };
      if (!snap.entries[e.id]) {
        steps.push(function () {
          return d.from("pp_entries").insert(row).select("id").single().then(must).then(function (got) {
            e.dbId = got.id;
            var el = (e.lotIds || []).map(function (lid) { return { entry_id: got.id, lot_id: lid, step: row.kind, vals: (e.per && e.per[lid]) || {} }; });
            return (el.length ? d.from("pp_entry_lots").insert(el).then(must) : Promise.resolve()).then(function () {
              var ir = rows(got.id); return ir.length ? d.from("pp_issue_rows").insert(ir).then(must) : null;
            });
          }).then(function () { snap.entries[e.id] = v; });
        });
      } else {
        steps.push(function () {
          return d.from("pp_entries").update({ totals: row.totals, extra: row.extra }).eq("is_demo", false).eq("client_id", e.id).select("id").single().then(must).then(function (got) {
            var jobs = (e.lotIds || []).map(function (lid) { return d.from("pp_entry_lots").update({ vals: (e.per && e.per[lid]) || {} }).eq("entry_id", got.id).eq("lot_id", lid).then(must); });
            if (e.kind === "issue") jobs.push(d.from("pp_issue_rows").delete().eq("entry_id", got.id).then(must).then(function () { var ir = rows(got.id); return ir.length ? d.from("pp_issue_rows").insert(ir).then(must) : null; }));
            return Promise.all(jobs);
          }).then(function () { snap.entries[e.id] = v; });
        });
      }
    });
    /* approvals: asked for, then decided */
    S.approvals.forEach(function (a) {
      var row = apRow(a), v = JSON.stringify(row);
      if (snap.approvals[a.id] === v) return;
      if (!snap.approvals[a.id]) steps.push(function () { return d.from("pp_approvals").insert(row).then(must).then(function () { snap.approvals[a.id] = v; }); });
      else steps.push(function () {
        var up = { status: row.status, extra: row.extra }; if (row.status !== "pending") up.decided_at = new Date().toISOString();
        return d.from("pp_approvals").update(up).eq("is_demo", false).eq("client_id", a.id).then(must).then(function () { snap.approvals[a.id] = v; });
      });
    });
    /* quantity moved between plants' pools; other WF1 work (both only ever added) */
    if (S.poolMoves.length > snap.poolMoves) {
      var pm = S.poolMoves.slice(snap.poolMoves).filter(function (m) { return m.qty > 0; });
      steps.push(function () { return (pm.length ? d.from("pp_pool_moves").insert(pm.map(function (m) { return { is_demo: false, msku: m.sku, from_region: m.from, to_region: m.to, qty: m.qty }; })).then(must) : Promise.resolve())
        .then(function () { snap.poolMoves = S.poolMoves.length; }); });
    }
    if (S.wf1Other.length > snap.wf1Other) {
      var wo = S.wf1Other.slice(snap.wf1Other);
      steps.push(function () { return d.from("pp_wf1_other").insert(wo.map(function (w) { return { is_demo: false, region: w.region, work_date: w.date, operation: OP_IN[w.op] || String(w.op).toLowerCase(), qty: w.qty, remarks: w.remark || null }; }))
        .then(must).then(function () { snap.wf1Other = S.wf1Other.length; }); });
    }
    /* stock: the change in each SKU, plant and kind */
    var now = stockSums(S.stock), moves = [];
    Object.keys(Object.assign({}, now, snap.stock)).forEach(function (k) {
      var dq = Math.round(((now[k] || 0) - (snap.stock[k] || 0)) * 100) / 100; if (Math.abs(dq) < 0.5) return;
      var p = k.split("|"); moves.push({ is_demo: false, sku: p[0], region: p[1], kind: p[2], qty: dq, source: "planning" });
    });
    if (moves.length) steps.push(function () { return d.from("pp_stock_moves").insert(moves).then(must).then(function () { snap.stock = now; }); });
    /* orders pooled */
    var nowPooled = S.orders.filter(function (o) { return o.pooled && !snap.pooled[o.id]; });
    if (nowPooled.length) steps.push(function () {
      return d.from("pp_pool_runs").insert({ is_demo: false, kind: "manual" }).select("id").single().then(must).then(function (run) {
        return d.from("pp_order_pooling").upsert(nowPooled.map(function (o) { return { is_demo: false, uid: o.id, run_id: run.id }; }), { onConflict: "is_demo,uid", ignoreDuplicates: true }).then(must);
      }).then(function () { nowPooled.forEach(function (o) { snap.pooled[o.id] = true; }); });
    });
    /* dispatch counted against orders */
    var alloc = [];
    S.orders.forEach(function (o) {
      if (o.dispatched === snap.dispatched[o.id]) return;
      var dq = Math.round((o.dispatched - (snap.alloc[o.id] || 0)) * 100) / 100;
      if (Math.abs(dq) >= 0.5) alloc.push({ is_demo: false, uid: o.id, qty: dq });
    });
    if (alloc.length) steps.push(function () { return d.from("pp_dispatch_alloc").insert(alloc).then(must).then(function () {
      alloc.forEach(function (a) { snap.alloc[a.uid] = (snap.alloc[a.uid] || 0) + a.qty; });
      S.orders.forEach(function (o) { snap.dispatched[o.id] = o.dispatched; }); }); });
    else S.orders.forEach(function (o) { snap.dispatched[o.id] = o.dispatched; });

    return steps.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
      if (newLots.length && onChange) onChange("lots", newLots);
    });
  }

  /* ---------- other people's changes ---------- */
  function typing() { var a = document.activeElement; return a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); }
  function later() {
    clearTimeout(reloadT);
    reloadT = setTimeout(function () {
      if (running || typing() || (onChange && onChange("busy"))) { later(); return; }
      L.reload();
    }, 1500);
  }
  L.reload = function () { return onChange ? onChange("reload") : null; };
  L.watch = function (fn) {
    onChange = fn;
    var ch = db().channel("pp-live");
    ["pp_lots", "pp_entries", "pp_approvals", "pp_stock_moves", "pp_pool_moves", "pp_order_pooling", "pp_yield_defaults", "pp_wf1_other", "sales_order_lines"].forEach(function (t) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, function () { if (running) pendingReload = true; else later(); });
    });
    ch.subscribe();
  };
})();
