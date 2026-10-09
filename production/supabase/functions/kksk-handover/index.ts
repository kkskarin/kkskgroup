// KKSK-Production: lets a person signed in to KKSK Group into Production Planning.
// The page sends its KKSK Group sign-in token. This function asks KKSK Group (app_portal, with that token)
// whether the person may use Production Planning and as what, keeps pp_users in step with that answer,
// and returns a KKSK-Production session for the same email. The Zoho functions are not touched.
// Deployed with verify_jwt off: the token comes from KKSK Group, not from this project; it is checked below.
import { createClient } from "jsr:@supabase/supabase-js@2";

// KKSK Group's public address and publishable key (both are public; they identify the project only).
const GROUP_URL = "https://uqjirmofridjuykeemml.supabase.co";
const GROUP_KEY = "sb_publishable_3YW30dmZIzU6RIZ4FiGbhw_XO2yqJQ0";
const ROLES = ["super_admin", "admin", "approver", "planner", "floor"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { code: "invalid_argument", message: "POST only" });
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(auth)) return reply(401, { code: "not_signed_in", message: "Sign in to KKSK Group first." });

  // 1. Ask KKSK Group who this is and what they may open.
  const g = await fetch(`${GROUP_URL}/rest/v1/rpc/app_portal`, {
    method: "POST",
    headers: { apikey: GROUP_KEY, Authorization: auth, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!g.ok) return reply(401, { code: "not_signed_in", message: "The KKSK Group sign-in could not be checked. Sign in again." });
  const p = await g.json().catch(() => ({}));
  const email = String(p?.email ?? "").trim().toLowerCase();
  if (!p?.signedIn || !email) return reply(401, { code: "not_signed_in", message: "Sign in to KKSK Group first." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const pp = p?.apps?.pp;
  const role = String(pp?.role ?? "");
  const region = pp?.region === "E" || pp?.region === "A" ? pp.region : null;

  // 2. No Production Planning access at KKSK Group: switch off any access here too.
  if (!ROLES.includes(role)) {
    await admin.from("pp_users").update({ active: false }).eq("email", email);
    return reply(403, { code: "not_granted", message: "Production Planning is not open to you. Ask an admin." });
  }

  // 3. The matching account in this project (made the first time), and its role and region.
  const made = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name: p.name ?? "", via: "kksk-group" } });
  if (made.error && !/already|registered|exists/i.test(made.error.message)) {
    return reply(500, { code: "unavailable", message: "Your Production Planning account couldn't be set up." });
  }
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data?.user || !link.data.properties?.hashed_token) {
    return reply(500, { code: "unavailable", message: "Your Production Planning session couldn't be started." });
  }
  const id = link.data.user.id;
  const up = await admin.from("pp_users").upsert({ id, email, name: p.name ?? null, role, region, active: true }, { onConflict: "id" });
  if (up.error) return reply(500, { code: "unavailable", message: "Your Production Planning access couldn't be saved." });

  // 4. A session for this project, handed back to the page.
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const v = await anon.auth.verifyOtp({ type: "email", token_hash: link.data.properties.hashed_token });
  if (v.error || !v.data.session) return reply(500, { code: "unavailable", message: "Your Production Planning session couldn't be started." });
  const s = v.data.session;
  return reply(200, {
    access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at,
    user: { id, email, name: p.name ?? "", role, region, super: !!p.super, admin: !!p.admin },
  });
});
