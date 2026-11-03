// Official notifications watch for Tally (Demo) › Masters › Official Notifications, and downloading their PDFs.
// Claude searches official Government of India sites only, one topic at a time: GST rate notifications (rates,
// exemptions, reverse charge), other GST notifications that touch purchase accounting (ITC, e-invoicing, GST TDS / TCS),
// income-tax TDS and TCS, and cess. A run handles one topic with a few searches (so it finishes inside the server's
// time limit), then starts the next run itself, until every topic is covered; an unfinished topic carries on in a further
// run. All that is in force is listed on the first pass of each topic; later passes look for what is new.
// The result is kept in tly__ratewatch/state. A check starts once a day (pg_cron every 10 minutes: it only starts a
// new check when the last full one is over 20 hours old, and otherwise only picks up a queue a cut-off run left behind)
// and on "Check Now". Needs ANTHROPIC_API_KEY (and ANTHROPIC_WORKSPACE_ID if the key isn't tied to a workspace).
// Deployed without JWT verification so the schedule and the chain can call it: such calls only run when a check is due
// or a queue is waiting; "Check Now" and downloads must come from someone who has the Tally app.
// Downloads (action "download"): the PDFs of the notifications chosen in the app are fetched from their official links
// and kept in the bill-files bucket (hsn-docs/auto/); each result, done or failed, is kept in tly__notifdl/<key>. A
// download that failed is never tried again: that PDF is uploaded by hand.
// A notification published only as a web page (no PDF) is saved as a note (its text) and as a Word document.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { strToU8, zipSync } from "npm:fflate@0.8.2";

const MODEL = "claude-opus-5-5";
const STATE = "tly__ratewatch/state";
const GST_SITES = ["cbic-gst.gov.in", "cbic.gov.in", "gst.gov.in", "gstcouncil.gov.in", "egazette.gov.in"];
const TAX_SITES = ["incometaxindia.gov.in", "incometax.gov.in", "egazette.gov.in", "indiabudget.gov.in", "cbic-gst.gov.in", "cbic.gov.in"];
const GSTN_SITES = ["gst.gov.in", "einvoice1.gst.gov.in", "einvoice.gst.gov.in", "ewaybillgst.gov.in", "cbic-gst.gov.in"];
const COUNCIL_SITES = ["gstcouncil.gov.in", "pib.gov.in", "cbic-gst.gov.in"];
const TN_SITES = ["ctd.tn.gov.in", "tn.gov.in", "stationeryprinting.tn.gov.in", "tnsgst.gov.in"];
const CUSTOMS_SITES = ["cbic.gov.in", "icegate.gov.in", "egazette.gov.in", "indiabudget.gov.in"];
const ALL_SITES = [...new Set([...GST_SITES, ...TAX_SITES, ...GSTN_SITES, ...COUNCIL_SITES, ...TN_SITES, ...CUSTOMS_SITES])];
// who the notifications are for, so Claude can tell what applies
const COMPANY = "The company is a group of Indian companies in Tamil Nadu (state code 33) that buy goods and services (machinery spares, electrical items, chemicals, contractors, transport, professional services), import some goods, pay rent, salaries and contractors, and sell goods and renewable energy (solar and wind power).";
const MAX_ROUNDS = 10;

type Topic = { id: string; cat: "gst" | "tds" | "cess" | "customs"; since: string; sites: string[]; ask: string; base: string };
const TOPICS: Topic[] = [
  { id: "gst-rate", cat: "gst", since: "2025-09-01", sites: GST_SITES,
    ask: "GST rate notifications for GOODS under Central Tax (Rate), Integrated Tax (Rate) and Union Territory Tax (Rate): rates, exemptions, concessional rates and reverse charge on goods, with their amendments and corrigenda",
    base: "every such notification for goods in force today, even if older: the goods rate schedule (9/2025), exempt goods (10/2025 or 2/2017 as in force), goods under reverse charge (4/2017), and any other still in force that sets a rate on goods" },
  { id: "gst-rate-svc", cat: "gst", since: "2025-09-01", sites: GST_SITES,
    ask: "GST rate notifications for SERVICES under Central Tax (Rate), Integrated Tax (Rate) and Union Territory Tax (Rate): rates, exemptions and reverse charge on services, with their amendments",
    base: "every such notification for services in force today, even if older: services rates (11/2017 as amended), exempt services (12/2017 as amended), services under reverse charge (13/2017 as amended), and any other still in force" },
  { id: "gst-other", cat: "gst", since: "2025-04-01", sites: GST_SITES,
    ask: "GST notifications under Central Tax and Integrated Tax (not Rate) that affect purchase accounting: input tax credit (ITC) rules, conditions and time limits, reverse charge procedure, e-invoicing and its turnover limit, invoice rules, GST TDS (section 51) and GST TCS (section 52)",
    base: "those in force today that still apply to a business buying goods and services, such as the e-invoicing turnover limit and GST TDS / TCS" },
  { id: "gst-circ", cat: "gst", since: "2025-04-01", sites: GST_SITES,
    ask: "CBIC GST circulars and clarifications: which rate applies to which goods or services, ITC eligibility, reverse charge and valuation",
    base: "the circulars still in force that clarify current rates, ITC or reverse charge for goods and services this company buys or sells" },
  { id: "gstn", cat: "gst", since: "2025-07-01", sites: GSTN_SITES,
    ask: "GSTN, e-invoice (IRP) and e-way bill advisories that change how invoices, e-invoices, e-way bills, credit notes or returns must be issued or reported, such as time limits for generating an IRN",
    base: "the advisories in effect today that a buyer or seller must follow" },
  { id: "council", cat: "gst", since: "2025-09-01", sites: COUNCIL_SITES,
    ask: "GST Council meeting decisions (minutes, press releases) on rates, ITC and procedures, as early warning of notifications to come",
    base: "the decisions of the latest meetings" },
  { id: "tn-sgst", cat: "gst", since: "2025-09-01", sites: TN_SITES,
    ask: "Tamil Nadu GST (State Tax and State Tax (Rate)) notifications and orders, especially rules only Tamil Nadu sets, such as the e-way bill limit within the state",
    base: "the Tamil Nadu notifications in force that differ from or add to the central ones" },
  { id: "tds", cat: "tds", since: "2025-04-01", sites: TAX_SITES,
    ask: "income-tax TDS and TCS: CBDT notifications and circulars on TDS / TCS sections, rates and thresholds, the Income-tax Act, 2025 provisions in force from 1 April 2026, and Finance Act changes to TDS / TCS",
    base: "the rules and rates in force today for the usual TDS on payments (contractors, professional and technical fees, rent, commission, purchase of goods, salaries, interest) and TCS on sale of goods, with the notification or Act section that sets each" },
  { id: "cess", cat: "cess", since: "2025-09-01", sites: GST_SITES,
    ask: "cess charged on purchase or sale invoices: GST Compensation Cess rate notifications (Compensation Cess (Rate)), including its ending, and any other cess shown on invoices",
    base: "the cess notifications in force today" },
  { id: "customs", cat: "customs", since: "2026-02-01", sites: CUSTOMS_SITES,
    ask: "customs on imports: basic customs duty, IGST on imports, Social Welfare Surcharge and their exemptions, for machinery, spares, electrical items, chemicals and solar or wind equipment, including Union Budget changes",
    base: "the main notifications in force (such as 50/2017-Customs as amended) and the latest Budget changes for those goods" },
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

type Found = { urlChk?: string; badUrl?: string; key: string; cat: string; type?: string; topic?: string; inForce?: boolean; replacedBy?: string; number: string; issued: string; from: string; subject: string; url: string; relevant: boolean; rate: boolean; reason: string; base?: boolean; firstSeen: number; seen: number };
type Job = { topic: string; round: number; carry: string };

const ymd = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? "")) ? String(s) : "";
// 9/2025-Central Tax (Rate) -> C-9-2025, so the same notification read or uploaded under any spelling matches
function notifKey(n: string) {
  const m = /(\d+)\s*\/\s*(\d{4})/.exec(n);
  if (!m) return "";
  if (/circular/i.test(n)) { const all = n.match(/\d+/g) || []; return "CIR-" + all.join("-"); }
  const t = /compensation\s*cess/i.test(n) ? "CC" : /customs/i.test(n) ? "CUS" : /integrated/i.test(n) ? "I" : /union/i.test(n) ? "U" : /state tax/i.test(n) ? "S" : /central|cgst/i.test(n) ? "C" : /income|cbdt|s\.\s*o\./i.test(n) ? "IT" : /circular/i.test(n) ? "CIR" : "X";
  const k = t + "-" + Number(m[1]) + "-" + m[2];
  return /corrigend|errat/i.test(n) ? "corr-" + k + "-" + ((/G\.?S\.?R\.?\s*(\d+)/i.exec(n) || [])[1] || "") : k;
}
function keyOf(cat: string, number: string) {
  const k = notifKey(number);
  if (k) return cat === "gst" ? k : cat + ":" + k;
  // an Act section or rule with no number/year: keyed by its words
  const w = number.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return w ? cat + ":" + w.slice(0, 60) : "";
}
function official(u: string) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return ALL_SITES.some((d) => h === d || h.endsWith("." + d)) ? u : "";
  } catch { return ""; }
}
function parseJson(t: string) {
  const s = t.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(s); } catch { /* try the braces */ }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error("Claude's answer wasn't JSON");
}

async function ask(prompt: string, sites: string[]) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("The Anthropic API key isn't set up.");
  const ws = Deno.env.get("ANTHROPIC_WORKSPACE_ID")?.trim();
  // searching finds the notifications; opening an official page (such as CBIC's list of a year's notifications) reads
  // many at once
  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: 6, allowed_domains: sites },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5, allowed_domains: sites, max_content_tokens: 30000 },
  ];
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [{ role: "user", content: prompt }];
  let fallback = true;
  for (let turn = 0; turn < 4; turn++) {
    const headers: Record<string, string> = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(ws ? { "anthropic-workspace-id": ws } : {}) };
    // deno-lint-ignore no-explicit-any
    const body: any = { model: MODEL, max_tokens: 12000, tools, messages };
    if (fallback) { headers["anthropic-beta"] = "server-side-fallback-2026-07-01"; body.fallbacks = "default"; }
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      if (r.status === 400 && fallback && /fallback/i.test(detail)) { fallback = false; turn--; continue; }
      console.error("anthropic", r.status, detail.slice(0, 600));
      let why = ""; try { why = JSON.parse(detail)?.error?.message ?? ""; } catch { /* not JSON */ }
      // the account can't be used (usage limit, no credit, key refused): stop, don't retry
      if (r.status === 401 || r.status === 403 || /usage limit|credit balance/i.test(why)) { const e = new Error(/usage limit/i.test(why) ? "The Anthropic account has reached its usage limit" + ((/regain access on ([0-9-]+)/i.exec(why) || [])[1] ? " until " + (/regain access on ([0-9-]+)/i.exec(why) || [])[1] : "") + ": raise it in the Anthropic Console." : /credit/i.test(why) ? "The Anthropic account is out of credit." : "The Anthropic API key was refused."); (e as Error & { hard?: boolean }).hard = true; throw e; }
      throw new Error("Claude did not answer (" + r.status + ")" + (why ? ": " + why.slice(0, 200) : ""));
    }
    const out = await r.json();
    if (out.stop_reason === "refusal") throw new Error("Claude declined the search.");
    if (out.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: out.content }); continue; }
    // deno-lint-ignore no-explicit-any
    return (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  }
  throw new Error("The search didn't finish.");
}

// One job: one topic, a few searches. Returns the new state.
// deno-lint-ignore no-explicit-any
async function runJob(db: any, prev: any, job: Job) {
  const now = Date.now(), t = TOPICS.find((x) => x.id === job.topic)!;
  const found: Found[] = (Array.isArray(prev.found) ? prev.found : []).map((f: Found) => ({ ...f, cat: f.cat || "gst", key: keyOf(f.cat || "gst", f.number) || f.key }));
  const mine = found.filter((f) => f.topic ? f.topic === t.id : f.cat === t.cat && (!t.id.startsWith("gst-rate") || f.rate !== false) && (t.id !== "gst-other" || f.rate === false));
  const docs = (await db.from("app_docs").select("data").like("path", "tly\\_\\_hsndocs/%")).data ?? [];
  // deno-lint-ignore no-explicit-any
  const lastIssued = docs.map((d: any) => d.data || {}).filter((d: any) => d.kind === "rate" || d.kind === "notice").map((d: { issued?: string }) => ymd(d.issued)).filter(Boolean).sort().pop() || "";
  let since = t.since;
  const done0 = prev.topicDone?.[t.id];
  if (done0) { const d = new Date(done0); d.setUTCDate(d.getUTCDate() - 14); const s = d.toISOString().slice(0, 10); if (s > since) since = s; }
  if (lastIssued && t.cat === "gst") { const d = new Date(lastIssued + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 30); const s = d.toISOString().slice(0, 10); if (s > since && done0) since = s; }
  const first = !done0;
  const today = new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
  const known = mine.map((f) => f.number + (f.url ? "" : f.badUrl ? " (no official URL yet: " + f.badUrl + " doesn't show it)" : " (no official URL yet)") + (f.issued ? "" : " (no issue date yet)")).slice(-60);
  const prompt = [
    "Today is " + today + " (India). Search official Government of India and Tamil Nadu sites only. " + COMPANY,
    "Topic: " + t.ask + ".",
    first ? "List " + t.base + "; and everything issued on or after " + since + "." : "List everything on this topic issued on or after " + since + ".",
    job.carry ? "An earlier search on this topic couldn't finish. What was left: " + job.carry + " Do that first." : "",
    known.length ? "Already known (list one again only to add something missing, such as its URL or dates): " + known.join("; ") + "." : "",
    "For each give: number (as printed, e.g. \"9/2025-Integrated Tax (Rate)\", \"Notification No. 45/2026 (Income-tax)\", or the Act section if it is a provision of an Act), issued (YYYY-MM-DD or empty), from (YYYY-MM-DD in force from, or empty), subject (one line on what it does), type (notification, circular, advisory, decision, order or Act),",
    "url (its own PDF or page on an official site that you opened, else an official page you opened that lists it by name; never a general news, home or search page where it isn't shown; else empty), relevant (true if this company must apply it: rates, exemptions, reverse charge, ITC, e-invoicing, TDS, TCS, cess, customs on its imports; false if it doesn't touch this company or is only procedural),",
    "rate (true only if it sets or changes GST rates of goods or services by HSN or SAC), reason (one short line on why it is or isn't relevant), base (true if it is listed because it is in force, not because it is new).",
    "Irrelevant also means no longer in force: a notification fully replaced by a later one (superseded or rescinded), or whose every entry was later amended or omitted. List those with relevant false, inForce false and replacedBy naming what replaced them; and in \"superseded\" name any already-known item that is no longer in force, with what replaced it.",
    "Where an official page lists many notifications (such as CBIC's list for a year), open it with web_fetch and take them all from it rather than searching one by one.",
    "Never guess a number, date or URL. Set \"complete\" false if you couldn't cover the topic, and say exactly what is left in \"left\" (short).",
    "Reply with only JSON: {\"notifications\":[{\"number\":\"\",\"type\":\"notification\",\"issued\":\"\",\"from\":\"\",\"subject\":\"\",\"url\":\"\",\"relevant\":true,\"inForce\":true,\"replacedBy\":\"\",\"rate\":false,\"reason\":\"\",\"base\":false}],\"superseded\":[{\"number\":\"\",\"replacedBy\":\"\"}],\"complete\":true,\"left\":\"\"}",
  ].filter(Boolean).join("\n");
  const j = parseJson(await ask(prompt, t.sites));
  const byKey = new Map(found.map((f) => [f.key, f]));
  let added = 0;
  for (const n of Array.isArray(j.notifications) ? j.notifications : []) {
    const number = String(n.number ?? "").trim().slice(0, 140), key = keyOf(t.cat, number);
    if (!key) continue;
    const old = byKey.get(key);
    const gone = n.inForce === false;
    const nu = official(String(n.url ?? "")), url = (nu && nu !== old?.badUrl ? nu : "") || old?.url || "";
    const f: Found = {
      inForce: !gone, replacedBy: String(n.replacedBy || "").slice(0, 140),
      key, cat: t.cat, type: String(n.type || old?.type || "").slice(0, 20), topic: t.id, number, issued: ymd(n.issued) || old?.issued || "", from: ymd(n.from) || old?.from || "",
      subject: String(n.subject || old?.subject || "").slice(0, 300), url,
      badUrl: old?.badUrl, urlChk: url === old?.url ? old?.urlChk : undefined,
      relevant: gone ? false : n.relevant === false ? false : true, rate: t.cat === "gst" ? (n.rate === true || (n.rate !== false && t.id.startsWith("gst-rate"))) : false,
      reason: (gone ? "No longer in force" + (n.replacedBy ? ": replaced by " + String(n.replacedBy).slice(0, 120) : "") + ". " : "") + String(n.reason || old?.reason || "").slice(0, 260), base: !!(n.base || old?.base), firstSeen: old?.firstSeen ?? now, seen: now,
    };
    if (!old) added++;
    byKey.set(key, f);
  }
  // known items Claude says are no longer in force
  for (const sx of Array.isArray(j.superseded) ? j.superseded : []) {
    const k = keyOf(t.cat, String(sx.number ?? "")), f = k ? byKey.get(k) : undefined;
    if (f && f.inForce !== false) byKey.set(k, { ...f, inForce: false, relevant: false, replacedBy: String(sx.replacedBy || "").slice(0, 140), reason: "No longer in force" + (sx.replacedBy ? ": replaced by " + String(sx.replacedBy).slice(0, 120) : "") + "." });
  }
  // open each new link: one that doesn't show the item (such as a news page where it isn't listed) is dropped
  await checkUrls([...byKey.values()].filter((f) => f.topic === t.id && f.url && (!f.urlChk || f.urlChk === "new")), byKey);
  const list = [...byKey.values()].sort((a, b) => (b.issued || "").localeCompare(a.issued || ""));
  const queue: Job[] = (prev.queue || []).slice(1);
  const left = String(j.left ?? "").slice(0, 1500);
  const notes = { ...(prev.notes || {}) };
  const topicDone = { ...(prev.topicDone || {}) };
  if (j.complete === false && job.round < MAX_ROUNDS) { queue.push({ topic: t.id, round: job.round + 1, carry: left }); notes[t.id] = left; }
  else { notes[t.id] = j.complete === false ? "Stopped after " + MAX_ROUNDS + " rounds. Left: " + left : ""; topicDone[t.id] = now; }
  const doneTopics = TOPICS.filter((x) => !queue.some((q) => q.topic === x.id)).length;
  const cycleDone = !queue.length;
  return {
    ...prev, running: false, lastRun: Date.now(), error: "", holdUntil: 0, queue, notes, topicDone, found: list, added: (prev.added || 0) + added,
    progress: { done: doneTopics, total: TOPICS.length, runs: (prev.progress?.runs || 0) + 1 },
    ...(cycleDone ? { lastOk: Date.now(), lastBy: prev.cycleBy || prev.lastBy || "Daily check", incomplete: TOPICS.some((x) => notes[x.id]) } : {}),
  };
}

// ---- Downloads ----
// the source named on the file: "CBIC - 9-2025 Integrated Tax (Rate).pdf"
function sourceOf(u: string) {
  let h = ""; try { h = new URL(u).hostname.toLowerCase(); } catch { return "Official"; }
  const m: [RegExp, string][] = [[/egazette/, "eGazette"], [/cbic/, "CBIC"], [/gstcouncil/, "GST Council"], [/einvoice/, "e-Invoice Portal"], [/ewaybill/, "e-Way Bill Portal"], [/gst\.gov\.in/, "GSTN"],
    [/incometax/, "Income Tax"], [/indiabudget/, "Union Budget"], [/pib\.gov/, "PIB"], [/icegate/, "ICEGATE"], [/tn\.gov\.in|tnsgst/, "Tamil Nadu CTD"]];
  for (const [r, n] of m) if (r.test(h)) return n;
  return "Official";
}
export function fileName(u: string, number: string, ext = "pdf") {
  const n = number.replace(/\//g, "-").replace(/[^A-Za-z0-9 ().,&-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  return sourceOf(u) + " - " + (n || "Notification") + "." + ext;
}
// ---- a web page kept as a note and a Word document ----
function pageText(html: string) {
  let h = html.replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)[\s\S]*?<\/\1>/gi, " ");
  const main = /<(main|article)[\s\S]*?<\/\1>/i.exec(h); if (main && main[0].length > 800) h = main[0];
  h = h.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|li|tr|table|section)>/gi, "\n").replace(/<(td|th)[^>]*>/gi, " | ").replace(/<li[^>]*>/gi, "\u2022 ").replace(/<[^>]+>/g, " ");
  const ent: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", ndash: "\u2013", mdash: "\u2014", rupee: "\u20b9", ge: "\u2265", le: "\u2264", times: "\u00d7", deg: "\u00b0", hellip: "\u2026", bull: "\u2022", middot: "\u00b7", copy: "\u00a9", reg: "\u00ae", trade: "\u2122" };
  h = h.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(parseInt(e[1] === "x" || e[1] === "X" ? e.slice(2) : e.slice(1), e[1] === "x" || e[1] === "X" ? 16 : 10)) : (ent[e.toLowerCase()] ?? m));
  return h.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l, i, a) => l && !(l === a[i - 1])).join("\n").slice(0, 60000);
}
// is this page the notification itself (not a list of many)?
function pageIsIt(text: string, f: Found) {
  const t = text.toLowerCase(), m = /(\d+)\s*\/\s*(\d{4})/.exec(f.number);
  if (m && new RegExp("(^|[^0-9])0*" + Number(m[1]) + "\\s*/\\s*" + m[2]).test(t)) {
    // a list page names many notifications of the year; the notification's own page names few
    const all = t.match(new RegExp("(^|[^0-9])\\d{1,3}\\s*/\\s*" + m[2], "g")) || [];
    return all.length <= 6;
  }
  // no number: the page must open with the notification's own title (a list page opens with its own heading)
  const words = f.number.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3), head = t.slice(0, 400);
  const hit = words.filter((w) => head.includes(w)).length;
  return words.length > 0 && hit / words.length >= 0.5;
}
const xmlEsc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
function docx(title: string, meta: string[], text: string) {
  const para = (x: string, style = "") => "<w:p>" + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : "") + '<w:r><w:t xml:space="preserve">' + xmlEsc(x) + "</w:t></w:r></w:p>";
  const body = para(title, "Title") + meta.map((m) => para(m, "Meta")).join("") + text.split("\n").map((l) => para(l)).join("");
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/><w:rPr><w:color w:val="5C6860"/><w:sz w:val="18"/></w:rPr></w:style></w:styles>';
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/_rels/document.xml.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    "word/document.xml": strToU8(doc), "word/styles.xml": strToU8(styles),
  });
}
const safeKey = (k: string) => k.replace(/[^A-Za-z0-9_.~:@+-]+/g, "_").slice(0, 120);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
type Got = { pdf?: Uint8Array; page?: string };
async function getDoc(url: string, f: Found, depth = 0): Promise<Got> {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/pdf,text/html;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(30000), redirect: "follow" });
  if (!r.ok) throw new Error("the site answered " + r.status + (r.status === 403 ? " (it refuses automatic downloads)" : ""));
  const b = new Uint8Array(await r.arrayBuffer());
  if (b.length > 25 * 1024 * 1024) throw new Error("the file is over 25 MB");
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { pdf: b };
  // a page, not the PDF: take the one PDF link on it that names this notification's number
  const html = new TextDecoder().decode(b), m = /(\d+)\s*\/\s*(\d{4})/.exec(f.number);
  const links = [...html.matchAll(/href\s*=\s*["']([^"']+\.pdf[^"']*)["']/gi)].map((x) => { try { return new URL(x[1], r.url || url).href; } catch { return ""; } }).filter((x) => x && official(x));
  const want = m ? links.filter((x) => { const d = decodeURIComponent(x); return new RegExp("(^|[^0-9])0*" + Number(m[1]) + "[ _/-]+" + m[2]).test(d); }) : [];
  const pick = [...new Set(want)];
  if (pick.length === 1 && depth === 0) { try { const g = await getDoc(pick[0], f, 1); if (g.pdf) return g; } catch { /* keep the page */ } }
  // no PDF of it: the page itself is the notification (published online only) -> keep its text
  const text = pageText(html);
  if (text.length < 200) throw new Error("the page has no text to keep");
  if (!pageIsIt(text, f)) throw new Error(pick.length > 1 ? "the page links several PDFs that could be this one" : "the link is a list page, not the notification itself");
  return { page: text };
}
// does the link show this item? ok: the item itself (its PDF or own page); list: a page that names it; gone: it isn't there
async function urlCheck(f: Found): Promise<string> {
  try {
    const r = await fetch(f.url, { headers: { "User-Agent": UA, Accept: "application/pdf,text/html;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
    if (r.status === 404 || r.status === 410) return "gone";
    if (!r.ok) return "unchecked";
    const b = new Uint8Array(await r.arrayBuffer());
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "ok";
    const text = pageText(new TextDecoder().decode(b)), t = text.toLowerCase();
    if (pageIsIt(text, f)) return "ok";
    const m = /(\d+)\s*\/\s*(\d{4})/.exec(f.number);
    if (m && new RegExp("(^|[^0-9])0*" + Number(m[1]) + "\\s*/\\s*" + m[2]).test(t)) return "list";
    const words = f.number.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !/^(notification|circular|advisory|order|dated)$/.test(w));
    if (!m && words.length && words.filter((w) => t.includes(w)).length / words.length >= 0.7) return "list";
    return "gone";
  } catch { return "unchecked"; }
}
async function checkUrls(items: Found[], byKey: Map<string, Found>) {
  const some = items.slice(0, 10);
  const res = await Promise.all(some.map((f) => urlCheck(f)));
  some.forEach((f, i) => {
    const r = res[i];
    byKey.set(f.key, r === "gone" ? { ...f, badUrl: f.url, url: "", urlChk: "gone" } : { ...f, urlChk: r });
  });
}
// deno-lint-ignore no-explicit-any
async function download(db: any, items: Found[], by: string) {
  for (const f of items) {
    const path = "tly__notifdl/" + safeKey(f.key);
    let out: Record<string, unknown>;
    try {
      const g = await getDoc(f.url, f);
      if (g.pdf) {
        const name = fileName(f.url, f.number), file = "hsn-docs/auto/" + safeKey(f.key) + ".pdf";
        const up = await db.storage.from("bill-files").upload(file, g.pdf, { contentType: "application/pdf", upsert: true });
        if (up.error) throw new Error("it couldn't be stored: " + up.error.message);
        out = { status: "ok", kind: "pdf", path: file, name, size: g.pdf.length, url: f.url, at: Date.now(), by };
      } else {
        const text = g.page || "", name = fileName(f.url, f.number, "docx"), file = "hsn-docs/auto/" + safeKey(f.key) + ".docx";
        const when = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
        const w = docx(f.number, ["Source: " + f.url, "Saved from the official web page on " + when + " (India time). It was published online, not as a PDF.", f.subject ? "Subject: " + f.subject : ""].filter(Boolean), text);
        const up = await db.storage.from("bill-files").upload(file, w, { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", upsert: true });
        if (up.error) throw new Error("it couldn't be stored: " + up.error.message);
        out = { status: "ok", kind: "page", path: file, name, size: w.length, note: text.slice(0, 20000), url: f.url, at: Date.now(), by };
      }
    } catch (e) {
      const msg = String((e as Error)?.name === "TimeoutError" ? "the site didn't answer in 30 seconds" : (e as Error)?.message ?? e);
      out = { status: "failed", reason: /certificate|ssl|tls/i.test(msg) ? "the site's security certificate wasn't accepted" : msg.slice(0, 200), url: f.url, at: Date.now(), by };
    }
    await db.from("app_docs").upsert({ path, data: out, updated_at: new Date().toISOString() }, { onConflict: "path" });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { code: "invalid_argument", message: "POST only" });
  let body: { manual?: boolean; chain?: boolean; action?: string; keys?: string[]; by?: string } = {};
  try { body = await req.json(); } catch { /* the schedule sends {} */ }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  // deno-lint-ignore no-explicit-any
  let prev: any = (await db.from("app_docs").select("data").eq("path", STATE).maybeSingle()).data?.data ?? {};
  const now = Date.now();
  const busy = prev.running && now - (prev.startedAt || 0) < 6 * 60e3;
  if (body.action === "download") {
    // from the app (a Tally user), or the next batch handed on by this function itself
    const auth = req.headers.get("Authorization") ?? "", svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let by = String(body.by || "Someone");
    if (auth !== "Bearer " + svc) {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
      const p = await sb.rpc("app_portal");
      if (p.error || !p.data?.apps?.tly) return reply(403, { code: "not_granted", message: "Only the Tally app's users can download." });
      by = String(p.data.name || "Someone");
    }
    const want = new Set((Array.isArray(body.keys) ? body.keys : []).slice(0, 80).map(String));
    const items: Found[] = (prev.found || []).filter((f: Found) => want.has(f.key) && f.url);
    // never again for one already downloaded or that failed
    const seen = (await db.from("app_docs").select("path,data").in("path", items.map((f) => "tly__notifdl/" + safeKey(f.key)))).data ?? [];
    const had = new Set(seen.filter((d: { data: { status?: string } }) => d.data?.status === "ok" || d.data?.status === "failed").map((d: { path: string }) => d.path));
    const todo = items.filter((f) => !had.has("tly__notifdl/" + safeKey(f.key)));
    if (!todo.length) return reply(200, { started: 0 });
    for (const f of todo) await db.from("app_docs").upsert({ path: "tly__notifdl/" + safeKey(f.key), data: { status: "downloading", at: Date.now(), by, url: f.url }, updated_at: new Date().toISOString() }, { onConflict: "path" });
    // three at a time, inside the time limit; the rest go to a fresh run
    const batch = todo.slice(0, 3), rest = todo.slice(3);
    let finished = false;
    addEventListener("beforeunload", () => {
      if (finished) return;
      for (const f of batch) db.from("app_docs").select("data").eq("path", "tly__notifdl/" + safeKey(f.key)).maybeSingle().then((r: { data: { data?: { status?: string } } | null }) => {
        if (r.data?.data?.status === "downloading") db.from("app_docs").upsert({ path: "tly__notifdl/" + safeKey(f.key), data: { status: "failed", reason: "the download ran out of time", url: f.url, at: Date.now(), by }, updated_at: new Date().toISOString() }, { onConflict: "path" }).then(() => {}, () => {});
      }, () => {});
    });
    const work = download(db, batch, by).then(async () => {
      finished = true;
      if (rest.length) await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/gst-rate-watch", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + svc }, body: JSON.stringify({ action: "download", keys: rest.map((f) => f.key), by }) }).catch(() => {});
    });
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) { rt.waitUntil(work); return reply(202, { started: todo.length }); }
    await work; return reply(200, { started: todo.length });
  }
  const newCycle = (by: string) => ({ ...prev, queue: TOPICS.map((t) => ({ topic: t.id, round: 1, carry: "" })), cycleBy: by, cycleStart: now, added: 0, progress: { done: 0, total: TOPICS.length, runs: 0 } });
  if (body.manual) {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const p = await sb.rpc("app_portal");
    if (p.error || !p.data?.apps?.tly) return reply(403, { code: "not_granted", message: "Only the Tally app's users can check." });
    if (busy || (prev.queue || []).length) return reply(409, { code: "busy", message: "A check is already running." });
    prev = newCycle(String(p.data.name || "Someone"));
  } else if (busy) {
    return reply(200, { skipped: "running" });
  } else if ((prev.holdUntil || 0) > now) {
    // the Anthropic account refused the last run: wait (Check Now still tries)
    return reply(200, { skipped: "on hold" });
  } else if (!(prev.queue || []).length) {
    // the daily check (a chain call with nothing queued has nothing to do)
    if (body.chain || now - (prev.lastOk || 0) < 20 * 3600e3) return reply(200, { skipped: "not due" });
    prev = newCycle("Daily check");
  }
  const job: Job = prev.queue[0];
  const save = (data: unknown) => db.from("app_docs").upsert({ path: STATE, data, updated_at: new Date().toISOString() }, { onConflict: "path" });
  const cur = { ...prev, running: true, startedAt: now, current: job };
  await save(cur);
  let done = false;
  // a run cut off by the time limit puts its topic back at the end of the queue; the schedule picks it up
  addEventListener("beforeunload", () => {
    if (done) return;
    const q = (prev.queue || []).slice(1);
    if (job.round < MAX_ROUNDS) q.push({ ...job, round: job.round + 1, carry: job.carry || "The last search on this topic ran out of time." });
    save({ ...prev, running: false, lastRun: Date.now(), queue: q }).then(() => {}, () => {});
  });
  const chainNext = async (s: { queue?: Job[] }) => {
    if (!(s.queue || []).length) return;
    await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/gst-rate-watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chain: true }) }).catch(() => {});
  };
  const work = runJob(db, prev, job).then(async (s) => { done = true; await save(s); await chainNext(s); }, async (e) => {
    done = true;
    console.error("rate-watch", job.topic, String(e?.message ?? e));
    if (e?.hard) {
      // the queue stays as it was; nothing more runs for 6 hours
      const s = { ...prev, running: false, lastRun: Date.now(), error: String(e.message).slice(0, 300), holdUntil: Date.now() + 6 * 3600e3 };
      await save(s); return;
    }
    // the topic is put back once; the error shows until a run succeeds
    const q = (prev.queue || []).slice(1);
    if (job.round < MAX_ROUNDS) q.push({ ...job, round: job.round + 1 });
    const s = { ...prev, running: false, lastRun: Date.now(), queue: q, error: String(e?.message ?? e).slice(0, 300) };
    await save(s); await chainNext(s);
  });
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) { rt.waitUntil(work); return reply(202, { started: true }); }
  await work;
  return reply(200, { done: true });
});
