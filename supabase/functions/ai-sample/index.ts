// Bills & Vouchers: asks Claude on behalf of a signed-in member of the app.
// Stands in for the claude.ai `sample` capability the app was built on.
// Needs the ANTHROPIC_API_KEY secret (Edge Functions > Secrets).
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODELS: Record<string, string> = {
  quick: "claude-haiku-4-5-20251001",
  default: "claude-sonnet-5-5",
  complex: "claude-opus-5-5",
};
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

  let body: { messages?: Turn[]; images?: Img[]; modelTier?: string; maxTokens?: number };
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

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELS[tier], max_tokens: maxTokens, messages }),
  });
  if (!r.ok) {
    // Keep Anthropic's reason in the function logs (Edge Functions > ai-sample > Logs).
    const detail = await r.text().catch(() => "");
    console.error("anthropic", r.status, MODELS[tier], images.length + " images", detail.slice(0, 600));
    let why = "";
    try { why = JSON.parse(detail)?.error?.message ?? ""; } catch { /* not JSON */ }
    if (r.status === 429) return fail(429, "rate_limited", "Too many requests to Claude. Wait a minute.");
    if (r.status === 401 || r.status === 403) return fail(503, "sampling_disabled", "The Anthropic API key was refused.");
    if (/credit balance/i.test(why)) return fail(503, "sampling_disabled", "The Anthropic account is out of credit.");
    return fail(502, "upstream_error", "Claude did not answer (" + r.status + "): " + why.slice(0, 200));
  }
  const out = await r.json();
  const text = (out.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  return reply(200, { text, truncated: out.stop_reason === "max_tokens", modelTierApplied: tier });
});
