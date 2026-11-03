// Official notifications watch for Tally (Demo) › Masters › Official Notifications.
// Claude searches official Government of India sites only, one topic at a time: GST rate notifications (rates,
// exemptions, reverse charge), other GST notifications that touch purchase accounting (ITC, e-invoicing, GST TDS / TCS),
// income-tax TDS and TCS, and cess. A run handles one topic with a few searches (so it finishes inside the server's
// time limit), then starts the next run itself, until every topic is covered; an unfinished topic carries on in a further
// run. All that is in force is listed on the first pass of each topic; later passes look for what is new.
// The result is kept in tly__ratewatch/state. A check starts once a day (pg_cron every 10 minutes: it only starts a
// new check when the last full one is over 20 hours old, and otherwise only picks up a queue a cut-off run left behind)
// and on "Check Now". Needs ANTHROPIC_API_KEY (and ANTHROPIC_WORKSPACE_ID if the key isn't tied to a workspace).
// Deployed without JWT verification so the schedule and the chain can call it: such calls only run when a check is due
// or a queue is waiting; "Check Now" must come from someone who has the Tally app.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-opus-5-5";
const STATE = "tly__ratewatch/state";
const GST_SITES = ["cbic-gst.gov.in", "cbic.gov.in", "gst.gov.in", "gstcouncil.gov.in", "egazette.gov.in"];
const TAX_SITES = ["incometaxindia.gov.in", "incometax.gov.in", "egazette.gov.in", "indiabudget.gov.in", "cbic-gst.gov.in", "cbic.gov.in"];
const ALL_SITES = [...new Set([...GST_SITES, ...TAX_SITES])];
const MAX_ROUNDS = 4;

type Topic = { id: string; cat: "gst" | "tds" | "cess"; since: string; sites: string[]; ask: string; base: string };
const TOPICS: Topic[] = [
  { id: "gst-rate", cat: "gst", since: "2025-09-01", sites: GST_SITES,
    ask: "GST rate notifications under Central Tax (Rate), Integrated Tax (Rate) and Union Territory Tax (Rate): rates of goods and services, exemptions, concessional rates and reverse charge (RCM), with their amendments and corrigenda",
    base: "every such notification in force today, even if older: the goods rate schedule (9/2025), exempt goods, goods under reverse charge (4/2017), services rates (11/2017), exempt services (12/2017), services under reverse charge (13/2017), and any other still in force that sets a rate" },
  { id: "gst-other", cat: "gst", since: "2025-04-01", sites: GST_SITES,
    ask: "GST notifications under Central Tax and Integrated Tax (not Rate) that affect purchase accounting: input tax credit (ITC) rules, conditions and time limits, reverse charge procedure, e-invoicing and its turnover limit, invoice rules, GST TDS (section 51) and GST TCS (section 52)",
    base: "those in force today that still apply to a business buying goods and services, such as the e-invoicing turnover limit and GST TDS / TCS" },
  { id: "tds", cat: "tds", since: "2025-04-01", sites: TAX_SITES,
    ask: "income-tax TDS and TCS: CBDT notifications and circulars on TDS / TCS sections, rates and thresholds, the Income-tax Act, 2025 provisions in force from 1 April 2026, and Finance Act changes to TDS / TCS",
    base: "the rules and rates in force today for the usual TDS on payments (contractors, professional and technical fees, rent, commission, purchase of goods, salaries, interest) and TCS on sale of goods, with the notification or Act section that sets each" },
  { id: "cess", cat: "cess", since: "2025-09-01", sites: GST_SITES,
    ask: "cess charged on purchase or sale invoices: GST Compensation Cess rate notifications (Compensation Cess (Rate)), including its ending, and any other cess shown on invoices",
    base: "the cess notifications in force today" },
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

type Found = { key: string; cat: string; number: string; issued: string; from: string; subject: string; url: string; relevant: boolean; rate: boolean; reason: string; base?: boolean; firstSeen: number; seen: number };
type Job = { topic: string; round: number; carry: string };

const ymd = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? "")) ? String(s) : "";
// 9/2025-Central Tax (Rate) -> C-9-2025, so the same notification read or uploaded under any spelling matches
function notifKey(n: string) {
  const m = /(\d+)\s*\/\s*(\d{4})/.exec(n);
  if (!m) return "";
  const t = /compensation\s*cess/i.test(n) ? "CC" : /integrated/i.test(n) ? "I" : /union/i.test(n) ? "U" : /state tax/i.test(n) ? "S" : /central|cgst/i.test(n) ? "C" : /income|cbdt|s\.\s*o\./i.test(n) ? "IT" : /circular/i.test(n) ? "CIR" : "X";
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
  const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 8, allowed_domains: sites }];
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
  const mine = found.filter((f) => f.cat === t.cat && (t.id !== "gst-rate" || f.rate !== false) && (t.id !== "gst-other" || f.rate === false));
  const docs = (await db.from("app_docs").select("data").like("path", "tly\\_\\_hsndocs/%")).data ?? [];
  // deno-lint-ignore no-explicit-any
  const lastIssued = docs.map((d: any) => d.data || {}).filter((d: any) => d.kind === "rate" || d.kind === "notice").map((d: { issued?: string }) => ymd(d.issued)).filter(Boolean).sort().pop() || "";
  let since = t.since;
  const done0 = prev.topicDone?.[t.id];
  if (done0) { const d = new Date(done0); d.setUTCDate(d.getUTCDate() - 14); const s = d.toISOString().slice(0, 10); if (s > since) since = s; }
  if (lastIssued && t.cat === "gst") { const d = new Date(lastIssued + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 30); const s = d.toISOString().slice(0, 10); if (s > since && done0) since = s; }
  const first = !done0;
  const today = new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
  const known = mine.map((f) => f.number + (f.url ? "" : " (no official URL yet)") + (f.issued ? "" : " (no issue date yet)")).slice(-60);
  const prompt = [
    "Today is " + today + " (India). Search official Government of India sites only.",
    "Topic: " + t.ask + ".",
    first ? "List " + t.base + "; and everything issued on or after " + since + "." : "List everything on this topic issued on or after " + since + ".",
    job.carry ? "An earlier search on this topic couldn't finish. What was left: " + job.carry + " Do that first." : "",
    known.length ? "Already known (list one again only to add something missing, such as its URL or dates): " + known.join("; ") + "." : "",
    "For each give: number (as printed, e.g. \"9/2025-Integrated Tax (Rate)\", \"Notification No. 45/2026 (Income-tax)\", or the Act section if it is a provision of an Act), issued (YYYY-MM-DD or empty), from (YYYY-MM-DD in force from, or empty), subject (one line on what it does),",
    "url (its own PDF or page on an official site you found, else the official page that lists it, else empty), relevant (true if a business buying and selling goods and services must apply it: rates, exemptions, reverse charge, ITC, e-invoicing, TDS, TCS, cess; false if procedural or not about these),",
    "rate (true only if it sets or changes GST rates of goods or services by HSN or SAC), reason (one short line on why it is or isn't relevant), base (true if it is listed because it is in force, not because it is new).",
    "Never guess a number, date or URL. Set \"complete\" false if you couldn't cover the topic, and say exactly what is left in \"left\" (short).",
    "Reply with only JSON: {\"notifications\":[{\"number\":\"\",\"issued\":\"\",\"from\":\"\",\"subject\":\"\",\"url\":\"\",\"relevant\":true,\"rate\":false,\"reason\":\"\",\"base\":false}],\"complete\":true,\"left\":\"\"}",
  ].filter(Boolean).join("\n");
  const j = parseJson(await ask(prompt, t.sites));
  const byKey = new Map(found.map((f) => [f.key, f]));
  let added = 0;
  for (const n of Array.isArray(j.notifications) ? j.notifications : []) {
    const number = String(n.number ?? "").trim().slice(0, 140), key = keyOf(t.cat, number);
    if (!key) continue;
    const old = byKey.get(key);
    const f: Found = {
      key, cat: t.cat, number, issued: ymd(n.issued) || old?.issued || "", from: ymd(n.from) || old?.from || "",
      subject: String(n.subject || old?.subject || "").slice(0, 300), url: official(String(n.url ?? "")) || old?.url || "",
      relevant: n.relevant === false ? false : true, rate: t.cat === "gst" ? (n.rate === true || (n.rate !== false && t.id === "gst-rate")) : false,
      reason: String(n.reason || old?.reason || "").slice(0, 300), base: !!(n.base || old?.base), firstSeen: old?.firstSeen ?? now, seen: now,
    };
    if (!old) added++;
    byKey.set(key, f);
  }
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
    ...prev, running: false, lastRun: Date.now(), error: "", queue, notes, topicDone, found: list, added: (prev.added || 0) + added,
    progress: { done: doneTopics, total: TOPICS.length, runs: (prev.progress?.runs || 0) + 1 },
    ...(cycleDone ? { lastOk: Date.now(), lastBy: prev.cycleBy || prev.lastBy || "Daily check", incomplete: TOPICS.some((x) => notes[x.id]) } : {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { code: "invalid_argument", message: "POST only" });
  let body: { manual?: boolean; chain?: boolean } = {};
  try { body = await req.json(); } catch { /* the schedule sends {} */ }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  // deno-lint-ignore no-explicit-any
  let prev: any = (await db.from("app_docs").select("data").eq("path", STATE).maybeSingle()).data?.data ?? {};
  const now = Date.now();
  const busy = prev.running && now - (prev.startedAt || 0) < 6 * 60e3;
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
