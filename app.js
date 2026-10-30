// ===== CONFIG: paste from Supabase > Project Settings > API =====
const SUPABASE_URL = "https://jtjpeoxnahtfjkixabcf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_famxwWBU9nnoRS4X-1Xojw_OfZ4r0_L";   // the anon key is safe in the browser; RLS protects data
const PAY_NUMBER = "6254898"; // M-Pesa Buy Goods Till number
const KICKOFF = new Date("2027-01-05T16:00:00+03:00"); // EDIT to the real kickoff time
const SALES_OPEN = new Date("2026-01-01T00:00:00+03:00"); // bookings open

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const kes = (n) => "KES " + Number(n).toLocaleString("en-KE");
let current = null;

document.getElementById("payNum").textContent = PAY_NUMBER;
document.querySelectorAll(".payNum").forEach((e) => (e.textContent = PAY_NUMBER));

// Countdown
function tick() {
  const d = Math.max(0, KICKOFF - Date.now());
  const v = [Math.floor(d / 864e5), Math.floor(d / 36e5) % 24, Math.floor(d / 6e4) % 60, Math.floor(d / 1e3) % 60];
  document.querySelectorAll("#cd b").forEach((b, i) => (b.textContent = String(v[i]).padStart(2, "0")));
}
tick(); setInterval(tick, 1000);

// Tiers
async function loadTiers() {
  const { data, error } = await sb.from("tier_availability").select("*").order("sort_order");
  const box = $("tiers");
  if (error) { box.innerHTML = '<p class="err">Could not load tickets. Refresh the page.</p>'; return; }
  const open = Date.now() >= SALES_OPEN;
  box.innerHTML = "";
  data.forEach((t) => {
    const soldOut = t.remaining <= 0;
    const el = document.createElement("div");
    el.className = "tier";
    el.innerHTML = `<h3 style="font-size:28px">${t.name}</h3><p>${t.description || ""}</p>
      <div class="price">${kes(t.price_kes)}</div>
      <div class="left ${t.remaining < 50 ? "low" : ""}">${soldOut ? "Sold out" : t.remaining + " left"}</div>`;
    const b = document.createElement("button");
    b.className = "btn";
    b.disabled = soldOut || !open;
    b.textContent = soldOut ? "Sold out" : open ? "Book " + t.name : "Opens 5 Nov";
    b.onclick = () => openBooking(t);
    el.appendChild(b);
    box.appendChild(el);
  });
}

function openBooking(t) {
  current = t;
  $("dTitle").textContent = t.name + " ticket";
  const max = Math.min(6, t.remaining);
  $("qty").innerHTML = Array.from({ length: max }, (_, i) => `<option>${i + 1}</option>`).join("");
  $("bmsg").textContent = ""; $("bmsg").className = "msg";
  $("bookForm").reset(); updateTotal();
  $("dlg").showModal();
}
const updateTotal = () => ($("total").textContent = current ? kes(current.price_kes * $("qty").value) : "");
$("qty").onchange = updateTotal;
$("bclose").onclick = () => $("dlg").close();

$("bookForm").onsubmit = async (e) => {
  e.preventDefault();
  const phone = $("ph").value.trim();
  if (!/^(\+?254|0)[17]\d{8}$/.test(phone)) { return showMsg("Enter a valid Kenyan phone number.", true); }
  $("bsub").disabled = true;
  const { data, error } = await sb.rpc("create_booking", {
    p_tier: current.id, p_qty: +$("qty").value, p_name: $("fn").value,
    p_phone: phone, p_email: $("em").value, p_code: $("code").value,
  });
  $("bsub").disabled = false;
  if (error) {
    const dup = error.message.includes("bookings_mpesa_code_uq");
    return showMsg(dup ? "That M-Pesa code was already used." : error.message, true);
  }
  $("bmsg").className = "msg";
  $("bmsg").innerHTML = `Booking received. Your reference:<div class="ref">${data}</div>
    Save it. Check My booking after we verify your payment.`;
  loadTiers();
};
function showMsg(m, isErr) { $("bmsg").textContent = m; $("bmsg").className = "msg" + (isErr ? " err" : ""); }

// Look up a booking
$("lookup").onsubmit = async (e) => {
  e.preventDefault();
  const out = $("result");
  const { data, error } = await sb.rpc("lookup_booking", { p_ref: $("lref").value, p_phone: $("lph").value });
  if (error || !data.length) { out.innerHTML = '<span class="err">No booking found. Check the reference and phone number.</span>'; return; }
  const b = data[0];
  const text = { pending: "Waiting for payment check", confirmed: "Confirmed", rejected: "Payment not verified. Contact us." }[b.status];
  out.innerHTML = `<p><b>${b.full_name}</b>: ${b.quantity} × ${b.tier_name} (${kes(b.total_kes)})</p>
    <p><span class="badge ${b.status}">${text}</span></p><div id="qr"></div>`;
  if (b.status === "confirmed") {
    new QRCode($("qr"), { text: `${b.reference}|${b.quantity}|${b.tier_name}`, width: 180, height: 180 });
  }
};

loadTiers();
