// Approval alerts: a Slack message with an Approve button (and, when set up, a WhatsApp message through Sent) to the
// approver when a checking report or a cash advance starts waiting for approval. A database trigger calls this with the record's path only; everything else is read
// here with the service role, so a call can't invent a message. Each wait is sent once (app_alerts_sent).
// Slack: SLACK_BOT_TOKEN; the approver is found by their login email (slack-approve handles the button).
// WhatsApp: SENT_API_KEY; SENT_TEMPLATE (default "approval_request") and SENT_CHANNEL (default "whatsapp") are optional.
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
  if (!d.approverId) return reply(200, { sent: 0, reason: "no approver" });
  const apiKey = Deno.env.get("SENT_API_KEY"), slack = Deno.env.get("SLACK_BOT_TOKEN");
  if (!apiKey && !slack) return reply(200, { sent: 0, reason: "not set up" });
  const ins = await db.from("app_alerts_sent").insert({ key });
  if (ins.error) return reply(200, { sent: 0, reason: ins.error.code === "23505" ? "already sent" : ins.error.message });

  // Who: the approver named on the record (nothing is submitted without one).
  const uids = [String(d.approverId)];
  // The "Approve" button opens https://kkskgroup.netlify.app/approvals/?go={{go}} at this request's approval form.
  const go = (path.startsWith("reports/") ? "r:" : "c:") + path.split("/")[1];
  const template = Deno.env.get("SENT_TEMPLATE") || "approval_request";
  const channel = (Deno.env.get("SENT_CHANNEL") || "whatsapp").split(",").map((s) => s.trim()).filter(Boolean);

  const out: any[] = [];
  const authIdOf = (uid: string) => { const h = uid.replace(/^u_/, ""); return /^[0-9a-f]{32}$/.test(h) ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : ""; };
  if (slack) for (const uid of uids) {
    const sk = (m: string, q: string, b?: unknown) => fetch("https://slack.com/api/" + m + q, b ? { method: "POST", headers: { Authorization: "Bearer " + slack, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(b) } : { headers: { Authorization: "Bearer " + slack } }).then((r) => r.json());
    const aid = authIdOf(uid), email = aid ? (await db.auth.admin.getUserById(aid)).data?.user?.email ?? "" : "";
    const who = email ? await sk("users.lookupByEmail", "?email=" + encodeURIComponent(email)) : null;
    if (!who?.ok) { out.push({ uid, slack: "no Slack account for " + (email || "this login") }); continue; }
    const text = `*${item}* is waiting for your approval\n${details}`;
    const r = await sk("chat.postMessage", "", {
      channel: who.user.id, text: `${item} is waiting for your approval. ${details}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text } },
        { type: "actions", elements: [
          { type: "button", action_id: "approve", style: "primary", text: { type: "plain_text", text: "Approve" }, value: JSON.stringify({ p: path, k: key }),
            confirm: { title: { type: "plain_text", text: "Approve in full?" }, text: { type: "mrkdwn", text: `${item}\n${details}` }, confirm: { type: "plain_text", text: "Approve" }, deny: { type: "plain_text", text: "Cancel" } } },
          { type: "button", action_id: "review", text: { type: "plain_text", text: "Review in app" }, url: "https://kkskgroup.netlify.app/approvals/?go=" + go },
        ] },
      ],
    });
    out.push({ uid, slack: r.ok ? "sent" : r.error, ok: !!r.ok });
  }
  if (apiKey) for (const uid of uids) {
    const p = await get("prefs/" + uid);
    const to = String(p?.whatsapp ?? "");
    if (!/^\+[1-9]\d{7,14}$/.test(to) || p?.waAlerts === false) { out.push({ uid, skipped: "no number or alerts off" }); continue; }
    const u = (await get("users/" + uid)) || (await get("admins/" + uid)) || {};
    const name = String(u.name || "there").split(/\s+/)[0];
    const r = await fetch("https://api.sent.dm/v3/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json", "Idempotency-Key": ("apr-" + key + "-" + uid).replace(/[^A-Za-z0-9:_-]/g, "_").slice(0, 200) },
      body: JSON.stringify({ to: [to], channel, template: { name: template, parameters: { name, item, details, go } } }),
    });
    out.push({ uid, status: r.status, ok: r.ok, body: (await r.text()).slice(0, 300) });
  }
  console.log(JSON.stringify({ key, results: out }));
  return reply(200, { sent: out.filter((o) => o.ok).length });
});
