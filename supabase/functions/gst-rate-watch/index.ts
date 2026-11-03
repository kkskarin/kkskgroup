// GST rate notifications watch for Tally (Demo) › Masters › HSN / SAC.
// Once a day, and hourly while a search is unfinished (pg_cron, migration 20261103130000) and on "Check Now", Claude searches official Government of India sites
// only for GST rate notifications, and says for each whether it changes any GST rate (whatever the HSN / SAC, used here
// or not). The result is kept in tly__ratewatch/state; the app shows each notification with its official URL, and the
// ones that change rates stay "to upload" until their PDF is uploaded and read.
// Needs ANTHROPIC_API_KEY (and ANTHROPIC_WORKSPACE_ID if the key isn't tied to a workspace), as ai-sample does.
// Deployed without JWT verification so the daily job can call it: a call without a Tally user only runs when the last
// good check is over 20 hours old, and a "Check Now" must come from someone who has the Tally app.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-opus-5-5";
const DOMAINS = ["cbic-gst.gov.in", "cbic.gov.in", "gst.gov.in", "gstcouncil.gov.in", "egazette.gov.in"];
const STATE = "tly__ratewatch/state";
const BASE_SINCE = "2025-09-01";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

type Found = { key: string; number: string; issued: string; from: string; subject: string; url: string; relevant: boolean; reason: string; base?: boolean; firstSeen: number; seen: number };

const ymd = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? "")) ? String(s) : "";
// 9/2025-Central Tax (Rate) -> C-9-2025, so the same notification read or uploaded under any spelling matches
export function notifKey(n: string) {
  const m = /(\d+)\s*\/\s*(\d{4})/.exec(n);
  if (!m) return "";
  const t = /integrated/i.test(n) ? "I" : /union/i.test(n) ? "U" : /state/i.test(n) ? "S" : /central|cgst/i.test(n) ? "C" : "X";
  const k = t + "-" + Number(m[1]) + "-" + m[2];
  return /corrigend|errat/i.test(n) ? "corr-" + k + "-" + ((/G\.?S\.?R\.?\s*(\d+)/i.exec(n) || [])[1] || "") : k;
}
function official(u: string) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return DOMAINS.some((d) => h === d || h.endsWith("." + d)) ? u : "";
  } catch { return ""; }
}
function parseJson(t: string) {
  const s = t.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(s); } catch { /* try the braces */ }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error("Claude's answer wasn't JSON");
}

async function ask(prompt: string) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("The Anthropic API key isn't set up.");
  const ws = Deno.env.get("ANTHROPIC_WORKSPACE_ID")?.trim();
  const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 10, allowed_domains: DOMAINS }];
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [{ role: "user", content: prompt }];
  let fallback = true;
  for (let turn = 0; turn < 5; turn++) {
    const headers: Record<string, string> = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(ws ? { "anthropic-workspace-id": ws } : {}) };
    // deno-lint-ignore no-explicit-any
    const body: any = { model: MODEL, max_tokens: 16000, tools, messages };
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

// deno-lint-ignore no-explicit-any
async function run(db: any, by: string, prev: any) {
  const now = Date.now();
  const docs = (await db.from("app_docs").select("data").like("path", "tly\\_\\_hsndocs/%")).data ?? [];
  // deno-lint-ignore no-explicit-any
  const rateDocs = docs.map((d: any) => d.data || {}).filter((d: any) => d.kind === "rate");
  const lastIssued = rateDocs.map((d: { issued?: string }) => ymd(d.issued)).filter(Boolean).sort().pop() || "";
  const found: Found[] = (Array.isArray(prev?.found) ? prev.found : []).map((f: Found) => ({ ...f, key: notifKey(f.number) || f.key }));
  const first = !found.length;
  // look back a month before the newest document uploaded, so nothing issued around it is missed
  let since = BASE_SINCE;
  if (lastIssued) { const d = new Date(lastIssued + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 30); const s = d.toISOString().slice(0, 10); if (s > since) since = s; }
  const known = found.map((f) => f.number + (f.url ? "" : " (no official URL yet)") + (f.from ? "" : " (no in-force date yet)")).slice(-80);
  const carry = prev?.incomplete && prev?.note ? "Last time the search couldn't finish. What was left: " + String(prev.note) + " Continue with that first." : "";
  const today = new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
  const prompt = [
    "Today is " + today + " (India). Search official Government of India sites only (CBIC, the GST portal, the GST Council, the e-Gazette) for GST rate notifications.",
    "List every notification under Central Tax (Rate), Integrated Tax (Rate) or Union Territory Tax (Rate) issued on or after " + since + ", including amendments and corrigenda.",
    first ? "Also list the notifications in force today that set GST rates, even if older: the goods rate schedule (9/2025), exempt goods (2/2017), goods under reverse charge (4/2017), services rates (11/2017), exempt services (12/2017) and services under reverse charge (13/2017), each as Integrated Tax (Rate) or Central Tax (Rate), giving the page for the latest 'as amended' text where CBIC has one; mark these \"base\": true." : "",
    carry,
    known.length ? "Already known (list them again only if something about them changed): " + known.join("; ") + "." : "",
    "For each give: number (as printed, e.g. \"9/2025-Integrated Tax (Rate)\"), issued (YYYY-MM-DD), from (YYYY-MM-DD in force from, or empty), subject (one line), url (the notification's page or PDF on an official site you found; empty if you found none),",
    "relevant (true if it sets, changes, exempts or puts under reverse charge the GST rate of any goods or services, whatever their HSN or SAC; false if it changes no rate, such as a procedural notification or one about compensation cess only), and reason (a short line saying why).",
    "Never guess a number, date or URL: leave out what you could not find on an official site. For a URL, the notification's own PDF is best; otherwise the official page that lists it.",
    "Set \"complete\" to false if you could not cover everything asked (say what is left in \"note\"), true if you did.",
    "Reply with only JSON: {\"notifications\":[{\"number\":\"\",\"issued\":\"\",\"from\":\"\",\"subject\":\"\",\"url\":\"\",\"relevant\":true,\"reason\":\"\",\"base\":false}],\"complete\":true,\"note\":\"\"}",
  ].filter(Boolean).join("\n");
  const j = parseJson(await ask(prompt));
  const byKey = new Map(found.map((f) => [f.key, f]));
  let added = 0;
  for (const n of Array.isArray(j.notifications) ? j.notifications : []) {
    const number = String(n.number ?? "").trim().slice(0, 120), key = notifKey(number);
    if (!key) continue;
    const old = byKey.get(key);
    const f: Found = {
      key, number, issued: ymd(n.issued) || old?.issued || "", from: ymd(n.from) || old?.from || "",
      subject: String(n.subject ?? old?.subject ?? "").slice(0, 300), url: official(String(n.url ?? "")) || old?.url || "",
      relevant: n.relevant === false ? false : true, reason: String(n.reason ?? "").slice(0, 300), base: !!(n.base || old?.base),
      firstSeen: old?.firstSeen ?? now, seen: now,
    };
    if (!old) added++;
    byKey.set(key, f);
  }
  const list = [...byKey.values()].sort((a, b) => (b.issued || "").localeCompare(a.issued || ""));
  const incomplete = j.complete === false;
  return { running: false, startedAt: prev?.startedAt, lastRun: Date.now(), lastOk: Date.now(), lastBy: by, error: "", since, added, incomplete, rounds: incomplete ? (prev?.incomplete ? (prev.rounds || 1) + 1 : 1) : 0, note: String(j.note ?? "").slice(0, 600), found: list };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { code: "invalid_argument", message: "POST only" });
  let body: { manual?: boolean } = {};
  try { body = await req.json(); } catch { /* the daily job sends {} */ }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const prev = (await db.from("app_docs").select("data").eq("path", STATE).maybeSingle()).data?.data ?? {};
  const now = Date.now();
  let by = "Daily check";
  if (body.manual) {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const p = await sb.rpc("app_portal");
    if (p.error || !p.data?.apps?.tly) return reply(403, { code: "not_granted", message: "Only the Tally app's users can check." });
    by = String(p.data.name || "Someone");
    if (prev.running && now - (prev.startedAt || 0) < 10 * 60e3) return reply(409, { code: "busy", message: "A check is already running." });
    if (now - (prev.lastRun || 0) < 3 * 60e3) return reply(429, { code: "rate_limited", message: "Checked a moment ago. Try again in a few minutes." });
  } else if ((prev.running && now - (prev.startedAt || 0) < 10 * 60e3) ||
    // daily; while a search is unfinished, again each hour for up to 12 rounds
    (now - (prev.lastOk || 0) < 20 * 3600e3 && !(prev.incomplete && (prev.rounds || 0) < 12 && now - (prev.lastRun || 0) >= 50 * 60e3))) {
    return reply(200, { skipped: true });
  }
  const save = (data: unknown) => db.from("app_docs").upsert({ path: STATE, data, updated_at: new Date().toISOString() }, { onConflict: "path" });
  const cur = { ...prev, running: true, startedAt: now, startedBy: by };
  await save(cur);
  let done = false;
  // a round cut off by the time limit is marked unfinished, so the next hourly call carries on
  addEventListener("beforeunload", () => {
    if (!done) save({ ...prev, running: false, lastRun: Date.now(), lastBy: by, error: "", incomplete: true, rounds: (prev.rounds || 0) + 1, note: prev.note || "The last round ran out of time." }).then(() => {}, () => {});
  });
  const job = run(db, by, cur).then((s) => { done = true; return save(s); }, (e) => {
    done = true;
    console.error("rate-watch", String(e?.message ?? e));
    return save({ ...prev, running: false, lastRun: Date.now(), lastBy: by, error: String(e?.message ?? e).slice(0, 300) });
  });
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) { rt.waitUntil(job); return reply(202, { started: true }); }
  await job;
  return reply(200, { done: true });
});
