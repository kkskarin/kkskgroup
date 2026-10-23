// Approval alerts: a WhatsApp message (through Sent) to the approver when a checking report or a cash advance
// starts waiting for approval. A database trigger calls this with the record's path only; everything else is read
// here with the service role, so a call can't invent a message. Each wait is sent once (app_alerts_sent).
// Needs the SENT_API_KEY secret; SENT_TEMPLATE (default "approval_request") and SENT_CHANNEL (default "whatsapp") are optional.
import { createClient } from "jsr:@supabase/supabase-js@2";

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const inr = (n: unknown) => "₹ " + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const money = (n: unknown, cur?: string) => !cur || cur === "INR" ? inr(n) : cur + " " + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { code: "invalid_argument", message: "POST only" });
  let body: { path?: string };
  try { body = await req.json(); } catch { return reply(400, { code: "invalid_argument", message: "Send JSON." }); }
  const path = String(body.path ?? "");
  if (!/^(reports|cashadv)\/[A-Za-z0-9_-]{1,80}$/.test(path)) return reply(400, { code: "invalid_argument", message: "Unknown record." });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const get = async (p: string) => (await db.from("app_docs").select("data").eq("path", p).maybeSingle()).data?.data ?? null;
  const d = await get(path);
  if (!d) return reply(200, { sent: 0, reason: "gone" });

  // What is waiting, and the once-only key for this wait (a report sent back and generated again is a new wait).
  let key = "", item = "", details = "";
  const co = async (id: string) => { const c = id ? await get("companies/" + id) : null; return c ? (c.shortName || c.name || "") : ""; };
  if (path.startsWith("reports/")) {
    if (d.stage !== "generated") return reply(200, { sent: 0, reason: "not waiting" });
    key = path + ":" + (d.generatedAt ?? "");
    item = (d.kind === "inst" ? "Advance checking report " : d.kind === "vcr" ? (d.direct ? "Vouchers " : "Voucher checking report ") : "Bill checking report ") + (d.no || "");
    const v = d.vendorId ? await get("vendors/" + d.vendorId) : null;
    const cos = (await Promise.all((d.companyIds || [d.companyId]).filter(Boolean).map(co))).filter(Boolean).join(", ");
    const amt = d.kind === "vcr" ? (d.toPay ?? d.payable ?? d.total) : (d.payable ?? d.total);
    details = [cos, v && v.name, money(amt, d.currency), d.preparedBy && "prepared by " + d.preparedBy].filter(Boolean).join(" · ");
  } else {
    if (d.status !== "pending" || d.kind === "return") return reply(200, { sent: 0, reason: "not waiting" });
    key = path + ":" + (d.requestedAt ?? "");
    item = "Cash advance request";
    details = [await co(d.companyId), d.name, inr(d.amount), d.purpose].filter(Boolean).join(" · ");
  }
  const apiKey = Deno.env.get("SENT_API_KEY");
  if (!apiKey) return reply(200, { sent: 0, reason: "not set up" });
  const ins = await db.from("app_alerts_sent").insert({ key });
  if (ins.error) return reply(200, { sent: 0, reason: ins.error.code === "23505" ? "already sent" : ins.error.message });

  // Who: the named approver, or every active admin when none is named.
  let uids: string[] = d.approverId ? [String(d.approverId)] : [];
  if (!uids.length) {
    const a = await db.from("app_docs").select("path, data").like("path", "admins/%");
    uids = (a.data ?? []).filter((r) => r.data?.active !== false).map((r) => r.path.slice(7));
  }
  const template = Deno.env.get("SENT_TEMPLATE") || "approval_request";
  const channel = (Deno.env.get("SENT_CHANNEL") || "whatsapp").split(",").map((s) => s.trim()).filter(Boolean);

  const out: unknown[] = [];
  for (const uid of uids) {
    const p = await get("prefs/" + uid);
    const to = String(p?.whatsapp ?? "");
    if (!/^\+[1-9]\d{7,14}$/.test(to) || p?.waAlerts === false) { out.push({ uid, skipped: "no number or alerts off" }); continue; }
    const u = (await get("users/" + uid)) || (await get("admins/" + uid)) || {};
    const name = String(u.name || "there").split(/\s+/)[0];
    const r = await fetch("https://api.sent.dm/v3/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json", "Idempotency-Key": ("apr-" + key + "-" + uid).replace(/[^A-Za-z0-9:_-]/g, "_").slice(0, 200) },
      body: JSON.stringify({ to: [to], channel, template: { name: template, parameters: { name, item, details } } }),
    });
    out.push({ uid, status: r.status, body: (await r.text()).slice(0, 300) });
  }
  console.log(JSON.stringify({ key, results: out }));
  return reply(200, { sent: out.filter((o: any) => o.status >= 200 && o.status < 300).length });
});
