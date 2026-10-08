// Bills & Vouchers: lets an admin give someone a login (email and password) before they ever sign in,
// and set a new password for a person. Only the super admin and active app admins may call it.
// Uses the service role key that Supabase provides to every Edge Function.
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
const uidOf = (authId: string) => "u_" + authId.replace(/-/g, "");
const authIdOf = (uid: string) => {
  const h = uid.replace(/^u_/, "");
  return /^[0-9a-f]{32}$/.test(h) ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : "";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "invalid_argument", "POST only");

  // Who is asking: must be the super admin or an active app admin.
  const auth = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const who = await asCaller.rpc("app_whoami");
  if (who.error || !who.data?.member) return fail(403, "not_granted", "Not a member of this app.");
  let isAdmin = !!who.data.super;
  if (!isAdmin) {
    const a = await asCaller.from("app_docs").select("data").eq("path", "admins/" + who.data.uid).maybeSingle();
    isAdmin = !!a.data && a.data.data?.active !== false;
  }
  if (!isAdmin) return fail(403, "not_granted", "Only admins can manage logins.");

  let body: { action?: string; email?: string; password?: string; name?: string; uid?: string };
  try { body = await req.json(); } catch { return fail(400, "invalid_argument", "Send JSON."); }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const password = String(body.password ?? "");
  if (password && password.length < 8) return fail(400, "invalid_argument", "The password needs at least 8 characters.");

  if (body.action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim().slice(0, 120);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, "invalid_argument", "Enter a valid email address.");
    if (!password) return fail(400, "invalid_argument", "Enter a password.");
    const r = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
    if (r.error || !r.data.user) {
      const exists = /already|registered|exists/i.test(r.error?.message ?? "");
      return fail(exists ? 409 : 400, exists ? "already_exists" : "invalid_argument", exists ? "That email already has a login." : r.error?.message ?? "The login couldn't be made.");
    }
    const id = r.data.user.id;
    await admin.from("app_profiles").upsert({ user_id: id, name, email, updated_at: new Date().toISOString() });
    return reply(200, { uid: uidOf(id), email });
  }

  if (body.action === "password") {
    const id = authIdOf(String(body.uid ?? ""));
    if (!id) return fail(400, "invalid_argument", "This person has no login.");
    if (!password) return fail(400, "invalid_argument", "Enter a password.");
    // Only the super admin may set an admin's or a super admin's password.
    if (!who.data.super) {
      const u = await admin.auth.admin.getUserById(id);
      const email = (u.data.user?.email ?? "").toLowerCase();
      const sup = email ? await admin.from("app_super_admins").select("email").eq("email", email).maybeSingle() : { data: null };
      const adm = await admin.from("app_docs").select("path").eq("path", "admins/" + String(body.uid)).maybeSingle();
      if (sup.data || adm.data) return fail(403, "not_granted", "Only the super admin can set an admin's password.");
    }
    const r = await admin.auth.admin.updateUserById(id, { password });
    if (r.error) return fail(400, "invalid_argument", r.error.message);
    return reply(200, { ok: true });
  }

  return fail(400, "invalid_argument", "Unknown action.");
});
