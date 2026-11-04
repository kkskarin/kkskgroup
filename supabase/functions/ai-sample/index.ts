// Bills & Vouchers: asks Claude on behalf of a signed-in member of the app.
// Stands in for the claude.ai `sample` capability the app was built on.
// Needs the ANTHROPIC_API_KEY secret (Edge Functions > Secrets). If the key is not tied to a
// workspace, also set ANTHROPIC_WORKSPACE_ID to the workspace the requests should run in.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODELS: Record<string, string> = {
  quick: "claude-haiku-4-5-20251001",
  default: "claude-sonnet-5-5",
  complex: "claude-opus-5-5",
};
// USD per million tokens (input, output, cache read, cache write) and per web search, to log what each call cost.
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-haiku-4-5-20251001": [1, 5, 0.1, 1.25],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
  "claude-opus-5-5": [4, 20, 0.2, 5],
};
const SEARCH_USD = 0.01;
const MAX_IMAGES = 8;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function fail(status: number, code: string, message: string) {
  return reply(status, { code, message });
}

type Turn = { role: "user" | "assistant"; content: string };
type Img = { media_type: string; data: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "invalid_argument", "POST only");

  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const who = await sb.rpc("app_whoami");
  if (who.error || !who.data?.member) return fail(403, "not_granted", "Not a member of this app.");

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return fail(503, "sampling_disabled", "Reading with Claude is not set up yet.");
  const workspace = Deno.env.get("ANTHROPIC_WORKSPACE_ID")?.trim();

  let body: { messages?: Turn[]; images?: Img[]; modelTier?: string; maxTokens?: number; webSearch?: number; meta?: Record<string, unknown> };
  try { body = await req.json(); } catch { return fail(400, "invalid_argument", "Bad JSON"); }

  const turns = Array.isArray(body.messages) ? body.messages : [];
  if (!turns.length || turns[turns.length - 1].role !== "user") return fail(400, "invalid_argument", "Must end on a user turn.");
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES)
    .filter((i) => IMAGE_TYPES.includes(i.media_type) && typeof i.data === "string");

  const messages = turns.map((t, i) => {
    const last = i === turns.length - 1;
    if (!last || !images.length) return { role: t.role, content: String(t.content) };
    return {
      role: t.role,
      content: [
        ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
        { type: "text", text: String(t.content) },
      ],
    };
  });
  const tier = body.modelTier && MODELS[body.modelTier] ? body.modelTier : "default";
  const maxTokens = Math.min(Math.max(Number(body.maxTokens) || 8192, 256), 16000);
  // Web search only when the page asks for it (Approvals › AI Check: market prices), at most 8 searches a request.
  const searches = Math.min(Math.max(Math.floor(Number(body.webSearch) || 0), 0), 8);
  const tools = searches ? [{ type: "web_search_20260209", name: "web_search", max_uses: searches, user_location: { type: "approximate", country: "IN" } }] : undefined;
  const call = (msgs: unknown[]) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json",
      ...(workspace ? { "anthropic-workspace-id": workspace } : {}),
    },
    body: JSON.stringify({ model: MODELS[tier], max_tokens: maxTokens, messages: msgs, ...(tools ? { tools } : {}) }),
  });
  let r = await call(messages);
  if (!r.ok) {
    // Keep Anthropic's reason in the function logs (Edge Functions > ai-sample > Logs).
    const detail = await r.text().catch(() => "");
    console.error("anthropic", r.status, MODELS[tier], images.length + " images", detail.slice(0, 600));
    let why = "";
    try { why = JSON.parse(detail)?.error?.message ?? ""; } catch { /* not JSON */ }
    if (r.status === 429) return fail(429, "rate_limited", "Too many requests to Claude. Wait a minute.");
    if (r.status === 401 || r.status === 403) return fail(503, "sampling_disabled", "The Anthropic API key was refused.");
    if (/credit balance/i.test(why)) return fail(503, "sampling_disabled", "The Anthropic account is out of credit.");
    if (/usage limit/i.test(why)) return fail(503, "sampling_disabled", "The Anthropic account has reached its usage limit" + ((/regain access on ([0-9-]+)/i.exec(why) || [])[1] ? " until " + (/regain access on ([0-9-]+)/i.exec(why) || [])[1] : "") + ": raise it in the Anthropic Console (Limits).");
    return fail(502, "upstream_error", "Claude did not answer (" + r.status + "): " + why.slice(0, 200));
  }
  let out = await r.json();
  const use = { in: 0, out: 0, cr: 0, cw: 0, search: 0 };
  const add = (u: Record<string, any> | undefined) => { if (!u) return; use.in += u.input_tokens || 0; use.out += u.output_tokens || 0; use.cr += u.cache_read_input_tokens || 0; use.cw += u.cache_creation_input_tokens || 0; use.search += u.server_tool_use?.web_search_requests || 0; };
  add(out.usage);
  // A long web search can pause the turn: hand it back to continue (twice at most).
  let convo: unknown[] = messages;
  for (let k = 0; k < 2 && out.stop_reason === "pause_turn"; k++) {
    convo = [...convo, { role: "assistant", content: out.content }];
    r = await call(convo); if (!r.ok) break; out = await r.json(); add(out.usage);
  }
  // Usage log (Reports › AI Usage Credits): who, where in the app, which bill, tokens and what it cost in USD.
  let logId = "";
  try {
    const m = (body.meta && typeof body.meta === "object" ? body.meta : {}) as Record<string, unknown>;
    const ns = /^(tly__|demo__)$/.test(String(m.ns || "")) ? String(m.ns) : "";
    const pr = PRICES[MODELS[tier]] || PRICES["claude-sonnet-5-5"];
    const usd = (use.in * pr[0] + use.out * pr[1] + use.cr * pr[2] + use.cw * pr[3]) / 1e6 + use.search * SEARCH_USD;
    const s = (v: unknown, n: number) => String(v ?? "").slice(0, n);
    logId = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const data = { at: Date.now(), by: who.data?.uid ?? who.data?.id ?? "", byName: s(m.byName, 80), app: s(m.app, 12), stage: s(m.stage, 20), purpose: s(m.purpose, 40), billId: s(m.billId, 40), readKey: s(m.readKey, 40),
      model: MODELS[tier], in: use.in, out: use.out, cacheRead: use.cr, cacheWrite: use.cw, searches: use.search, usd: Math.round(usd * 1e6) / 1e6, images: images.length };
    const ins = await sb.from("app_docs").insert({ path: ns + "aiuse/" + logId, data });
    if (ins.error) { console.error("usage log", ins.error.message); logId = ""; }
  } catch (e) { console.error("usage log", String(e)); logId = ""; }
  const blocks = (out.content ?? []) as { type: string; text?: string; citations?: { url?: string; title?: string }[] }[];
  const text = blocks.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  const seen = new Set<string>(), sources: { url: string; title: string }[] = [];
  blocks.forEach((c) => (c.citations ?? []).forEach((ci) => { if (ci.url && !seen.has(ci.url)) { seen.add(ci.url); sources.push({ url: ci.url, title: ci.title ?? "" }); } }));
  return reply(200, { text, truncated: out.stop_reason === "max_tokens", modelTierApplied: tier, sources, logId });
});
