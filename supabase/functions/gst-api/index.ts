// GST through WhiteBooks (GSP: BVM IT Consulting Services). For now: look up a GSTIN (public search) to check a vendor.
// Any signed-in member of the app may call it. The WhiteBooks keys stay here, set as Edge Function secrets:
//   WB_BASE_URL (default the sandbox, https://apisandbox.whitebooks.in), WB_EMAIL, WB_GST_CLIENT_ID, WB_GST_CLIENT_SECRET.
// Sandbox calls work only with WhiteBooks' test GSTINs; production needs its own keys and base URL.
import { createClient } from "jsr:@supabase/supabase-js@2";

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
const GSTIN = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "invalid_argument", "POST only");

  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const who = await asCaller.rpc("app_whoami");
  if (who.error || !who.data?.member) return fail(403, "not_granted", "Not a member of this app.");

  let body: { action?: string; gstin?: string };
  try { body = await req.json(); } catch { return fail(400, "invalid_argument", "Send JSON."); }

  const base = (Deno.env.get("WB_BASE_URL") || "https://apisandbox.whitebooks.in").replace(/\/+$/, "");
  const email = Deno.env.get("WB_EMAIL") || "", id = Deno.env.get("WB_GST_CLIENT_ID") || "", secret = Deno.env.get("WB_GST_CLIENT_SECRET") || "";
  const env = /sandbox/i.test(base) ? "sandbox" : "production";
  const missing = [["WB_EMAIL", email], ["WB_GST_CLIENT_ID", id], ["WB_GST_CLIENT_SECRET", secret]].filter((x) => !x[1]).map((x) => x[0]);

  if (body.action === "status") return reply(200, { env, configured: !missing.length, missing });
  if (missing.length) return fail(503, "not_configured", "The WhiteBooks keys are not set yet: " + missing.join(", ") + ".");

  if (body.action === "search") {
    const gstin = String(body.gstin ?? "").trim().toUpperCase();
    if (!GSTIN.test(gstin)) return fail(400, "invalid_argument", "That is not a GSTIN.");
    const url = base + "/public/search?" + new URLSearchParams({ email, gstin }).toString();
    let r: Response;
    try { r = await fetch(url, { headers: { client_id: id, client_secret: secret, Accept: "application/json" } }); }
    catch (e) { return fail(502, "unavailable", "WhiteBooks couldn't be reached: " + String((e as Error).message || e)); }
    const text = await r.text();
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(text); } catch { return fail(502, "unavailable", "WhiteBooks answered " + r.status + ": " + text.slice(0, 200)); }
    // WhiteBooks wraps GSTN's answer; GSTN's taxpayer record carries lgnm, tradeNam, sts, rgdt, dty, stj and pradr.
    const d = (j.data ?? j.result ?? j) as Record<string, any>;
    const ok = !!(d && (d.gstin || d.lgnm || d.tradeNam));
    if (!r.ok || !ok) return reply(200, { env, found: false, status: r.status, message: String(j.status_desc ?? j.message ?? j.error?.message ?? (j.error ?? "Not found")), raw: j });
    const a = d.pradr?.addr ?? {};
    const addr = [a.bno, a.bnm, a.flno, a.st, a.loc, a.city, a.dst, a.stcd, a.pncd].filter(Boolean).join(", ") || d.pradr?.adr || "";
    return reply(200, {
      env, found: true, gstin: d.gstin || gstin, legalName: d.lgnm || "", tradeName: d.tradeNam || "", status: d.sts || "",
      type: d.dty || "", since: d.rgdt || "", cancelledOn: d.cxdt || "", constitution: d.ctb || "", address: addr, raw: d,
    });
  }
  return fail(400, "invalid_argument", "Unknown action.");
});
