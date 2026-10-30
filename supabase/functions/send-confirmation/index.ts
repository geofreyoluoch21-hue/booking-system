// Supabase Edge Function: emails a confirmation via SMTP. Only admins can call it.
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.14";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const env = Deno.env.toObject();
    // 1. Caller must be a signed-in admin
    const userClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: isAdmin } = await userClient.rpc("is_admin");
    if (!isAdmin) return json({ error: "Not allowed" }, 403);

    // 2. Load the booking
    const { booking_id } = await req.json();
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: b, error } = await db.from("bookings")
      .select("*, ticket_tiers(name, price_kes)").eq("id", booking_id).single();
    if (error || !b) return json({ error: "Booking not found" }, 404);
    if (b.status !== "confirmed") return json({ error: "Booking is not confirmed" }, 400);
    if (!b.email) return json({ error: "Booking has no email" }, 400);

    // 3. Send via SMTP
    const port = Number(env.SMTP_PORT || 465);
    const mail = nodemailer.createTransport({
      host: env.SMTP_HOST, port, secure: port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
    const total = (b.quantity * b.ticket_tiers.price_kes).toLocaleString("en-KE");
    const link = `${env.SITE_URL}/#mybooking`;
    const text = `Hi ${b.full_name},\n\nYour payment is confirmed.\n\nMatch: Bayern Munich vs Ajax, 5 January 2027, Raila Odinga International Stadium, Talanta Sports City, Nairobi\nBooking reference: ${b.reference}\nTicket: ${b.quantity} x ${b.ticket_tiers.name}\nTotal paid: KES ${total}\n\nView your ticket and QR code: ${link}\n(Use your reference and the phone number you booked with.)\n`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:520px">
      <h2 style="color:#dc052d">Booking confirmed</h2>
      <p>Hi ${esc(b.full_name)}, your payment is confirmed.</p>
      <p><b>Bayern Munich vs Ajax</b><br>5 January 2027, Raila Odinga International Stadium, Talanta Sports City, Nairobi</p>
      <p>Reference: <b style="font-size:20px">${esc(b.reference)}</b><br>
      Ticket: ${b.quantity} × ${esc(b.ticket_tiers.name)}<br>Total paid: KES ${total}</p>
      <p><a href="${esc(link)}">View your ticket and QR code</a><br>
      <small>Use your reference and the phone number you booked with.</small></p></div>`;
    await mail.sendMail({
      from: env.SMTP_FROM || env.SMTP_USER, to: b.email,
      subject: `Booking confirmed: ${b.reference}`, text, html,
    });

    await db.from("bookings").update({ email_sent_at: new Date().toISOString() }).eq("id", b.id);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
