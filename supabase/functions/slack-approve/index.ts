// Slack "Approve" button. Slack posts here when someone taps a button on an approval alert (sent by approval-alert).
// The tap is trusted only if Slack's signature checks out, the person tapping is the approver named on the request
// (matched by their login email), and the request is still in the same wait the alert was about. It then approves the
// full amount exactly as the app does; part approvals and send-backs stay in the app (the "Review" button).
// Needs the SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN secrets.
import { createClient } from "jsr:@supabase/supabase-js@2";

const APP = "https://kkskgroup.netlify.app/approvals/";
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const authIdOf = (uid: string) => {
  const h = uid.replace(/^u_/, "");
  return /^[0-9a-f]{32}$/.test(h) ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : "";
};
const inr = (n: unknown) => "₹ " + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const ok = () => new Response("", { status: 200 });
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

async function signedBySlack(req: Request, raw: string) {
  const secret = Deno.env.get("SLACK_SIGNING_SECRET") ?? "";
  const ts = req.headers.get("x-slack-request-timestamp") ?? "", sig = req.headers.get("x-slack-signature") ?? "";
  if (!secret || !ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = "v0=" + hex(await crypto.subtle.sign("HMAC", k, enc.encode(`v0:${ts}:${raw}`)));
  if (want.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const raw = await req.text();
  if (!(await signedBySlack(req, raw))) return new Response("Bad signature", { status: 401 });
  let p: any;
  try { p = JSON.parse(new URLSearchParams(raw).get("payload") ?? ""); } catch { return ok(); }
  const act = p?.actions?.[0];
  if (p?.type !== "block_actions" || act?.action_id !== "approve") return ok(); // "Review" opens the app by itself
  // Slack wants an answer within 3 seconds: acknowledge now, approve and reply through response_url.
  EdgeRuntime.waitUntil(approve(p, act).catch((e) => console.error(e)));
  return ok();
});

async function approve(p: any, act: any) {
  const say = (text: string, replace = false) => p.response_url && fetch(p.response_url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(replace ? { replace_original: true, text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] } : { response_type: "ephemeral", replace_original: false, text }),
  });
  let v: { p?: string; k?: string } = {};
  try { v = JSON.parse(act.value ?? ""); } catch { /* bad value */ }
  const path = String(v.p ?? ""), key = String(v.k ?? "");
  if (!/^(reports|cashadv)\/[A-Za-z0-9_-]{1,80}$/.test(path)) { await say("This button doesn't point to a request."); return; }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const get = async (q: string) => (await db.from("app_docs").select("data").eq("path", q).maybeSingle()).data?.data ?? null;
  const d = await get(path);
  if (!d) { await say("This request no longer exists.", true); return; }
  const isReport = path.startsWith("reports/");
  const label = isReport ? "Report " + (d.no || "") : "The cash advance for " + (d.name || "");

  // The person tapping must be the approver named on the request: their Slack email is their login email.
  const uid = String(d.approverId ?? ""), authId = authIdOf(uid);
  const login = authId ? (await db.auth.admin.getUserById(authId)).data?.user?.email?.toLowerCase() ?? "" : "";
  const prof = await fetch("https://slack.com/api/users.info?user=" + encodeURIComponent(p.user?.id ?? ""), { headers: { Authorization: "Bearer " + (Deno.env.get("SLACK_BOT_TOKEN") ?? "") } }).then((r) => r.json()).catch(() => null);
  const tapper = String(prof?.user?.profile?.email ?? "").toLowerCase();
  if (!login || tapper !== login) { await say("Only the approver named on this request can approve it here."); return; }

  // Still the same wait the alert was about?
  const waiting = isReport ? (d.stage === "generated" || d.stage === "printed") && String(d.generatedAt ?? "") === key.split(":").pop()
    : d.status === "pending" && String(d.requestedAt ?? "") === key.split(":").pop();
  if (!waiting) {
    const done = isReport ? d.stage === "payment" : d.status === "approved" || d.status === "received";
    await say(done ? `${label} is already approved.` : `${label} isn't waiting for approval any more. Open the Approvals app to see it.`, true);
    return;
  }

  const u = (await get("users/" + uid)) || (await get("admins/" + uid)) || {};
  const name = String(u.name || prof?.user?.real_name || ""), now = Date.now(), note = "Approved on Slack";
  const log = (x: any) => (x.log || []).concat([{ stage: "payment", at: now, by: uid, name, note }]);
  let doc: any, money = "";
  if (isReport && d.kind === "vcr") {
    doc = { ...d, stage: "payment", approvedAt: now, approvedBy: uid, sentBackIds: d.sentBackIds || [], log: log(d) };
    money = inr(d.toPay ?? d.payable ?? d.total);
  } else if (isReport && d.kind === "inst") {
    doc = { ...d, stage: "payment", apprAmt: Math.round((Number(d.total) || 0) * 100) / 100, backNote: "", approvedAt: now, approvedBy: uid, log: log(d) };
    money = inr(d.total);
  } else if (isReport) {
    // Every bill in full: the amounts the report already fixed (rest of a part-paid bill), otherwise each bill's own due.
    doc = { ...d, stage: "payment", appr: d.amts ? { ...d.amts } : null, lastBack: [], backNote: "", approvedAt: now, approvedBy: uid, log: log(d) };
    money = inr(d.payable ?? d.total);
  } else {
    doc = { ...d, status: "approved", approvedAmount: Math.round((Number(d.amount) || 0) * 100) / 100, approvedAt: now, approvedBy: uid, note, updatedAt: now };
    money = inr(d.amount);
  }
  if (isReport && doc.tds == null) { doc.tds = null; doc.payable = null; }
  // Write only if it is still waiting (someone may have acted in the app a moment ago).
  let w = db.from("app_docs").update({ data: doc, updated_at: new Date().toISOString(), updated_by: authId }).eq("path", path);
  w = isReport ? w.in("data->>stage", ["generated", "printed"]) : w.eq("data->>status", "pending");
  const res = await w.select("path");
  if (res.error || !res.data?.length) { await say(`${label} changed just now, so it wasn't approved here. Open the Approvals app.`); return; }
  if (isReport && d.kind === "vcr") {
    for (const id of d.voucherIds || []) {
      const vd = await get("vouchers/" + id);
      if (vd) await db.from("app_docs").update({ data: { ...vd, approvedAt: now, approvedBy: uid, approvedIn: path.slice(8) }, updated_at: new Date().toISOString(), updated_by: authId }).eq("path", "vouchers/" + id);
    }
  }
  await db.from("app_docs").insert({ path: "audit/a_" + now.toString(36) + crypto.randomUUID().slice(0, 5), data: { at: now, by: uid, byName: name, action: "approved on Slack", col: path.split("/")[0], docId: path.split("/")[1], label: d.no || d.name || "", changes: [] }, updated_by: authId });
  await say(`✅ *${label}* approved by ${name} (${money}) on Slack. <${APP}|Open Approvals>`, true);
}
