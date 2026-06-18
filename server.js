// GOOMBA Lookup - one box, full workup.
// Type a name with a place OR a phone number. It auto-detects which and returns
// the owner or person with all phones, email, every address on file, next of kin
// with a phone, and the nearest Walgreens (FedEx OnSite) with store phones.
//
// Whitepages Premium API:  GET https://api.whitepages.com/v2/person
//   (passing `phone` runs a reverse lookup; passing name/location runs a person search)
// Google Maps Platform:    Geocoding API + Places API
//
// Environment variables (set in Render):
//   WHITEPAGES_API_KEY   - Whitepages Premium key
//   GOOGLE_MAPS_API_KEY  - Google Maps key (Geocoding + Places enabled)
//   APP_PASSWORD         - the one password to log in (blank = no login)

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e && e.stack ? e.stack : e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e && e.stack ? e.stack : e));

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const app = express();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.WHITEPAGES_API_KEY || "";
const WP_BASE = process.env.WHITEPAGES_BASE_URL || "https://api.whitepages.com/v2/person";
const GMAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const GMAPS_BASE = process.env.GOOGLE_MAPS_BASE_URL || "https://maps.googleapis.com/maps/api";
const APP_PASSWORD = process.env.APP_PASSWORD || "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (a) => Math.min(8000, 1000 * Math.pow(2, a - 1));
const noDashes = (v) => (v == null ? "" : String(v).replace(/[\u2012\u2013\u2014\u2015]/g, "-"));

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Password-only login (signed cookie, no username)
// ---------------------------------------------------------------------------
function authToken() {
  return crypto.createHmac("sha256", APP_PASSWORD).update("goomba-auth-v1").digest("hex");
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isAuthed(req) {
  if (!APP_PASSWORD) return true;
  const c = parseCookies(req);
  return !!(c.gauth && safeEqual(c.gauth, authToken()));
}

const LOGIN_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><title>GOOMBA Lookup</title>
<style>
:root{--bg:#161009;--panel:#2a1d10;--line:#4a3318;--gold:#f0a82e;--cream:#f6ecd9;--muted:#b39873;--red:#d4452f}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--cream);
background:radial-gradient(1000px 500px at 50% -120px,#3a2812,var(--bg) 60%);min-height:100vh;display:flex;align-items:center;justify-content:center}
.box{width:340px;max-width:90vw;background:linear-gradient(180deg,var(--panel),#1f160d);border:1px solid var(--line);border-radius:14px;padding:28px;text-align:center;box-shadow:0 8px 28px rgba(0,0,0,.5)}
svg{margin-bottom:8px}
h1{margin:0 0 4px;font-size:20px;font-weight:900;letter-spacing:2px;color:var(--gold);text-shadow:2px 2px 0 #1a1209}
p{color:var(--muted);font-size:12px;letter-spacing:1px;margin:0 0 18px}
input{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:9px;font-size:16px;background:#140d07;color:var(--cream);margin-bottom:12px}
button{width:100%;background:var(--gold);color:#241910;border:none;border-radius:9px;padding:13px;font-size:15px;font-weight:900;letter-spacing:1px;text-transform:uppercase;cursor:pointer}
button:hover{background:#d8902a}.err{color:#ff7a6b;font-size:13px;min-height:18px;margin-top:6px}
</style></head><body>
<div class="box">
<svg width="48" height="48" viewBox="0 0 64 64"><ellipse cx="32" cy="54" rx="20" ry="7" fill="#1a1209"/><path d="M14 30c0-13 8-22 18-22s18 9 18 22c0 9-8 14-18 14s-18-5-18-14z" fill="#8a5a2b"/><path d="M16 31c0-11 7-19 16-19s16 8 16 19" fill="#a06a32"/><ellipse cx="24" cy="34" rx="6" ry="7" fill="#fff"/><ellipse cx="40" cy="34" rx="6" ry="7" fill="#fff"/><circle cx="26" cy="36" r="2.6" fill="#d4452f"/><circle cx="38" cy="36" r="2.6" fill="#d4452f"/><path d="M17 27l11 4M47 27l-11 4" stroke="#1a1209" stroke-width="3" stroke-linecap="round"/><path d="M22 46h20l-3 5H25z" fill="#f6ecd9"/></svg>
<h1>GOOMBA LOOKUP</h1><p>ENTER PASSWORD</p>
<input id="pw" type="password" placeholder="Password" autofocus />
<button id="go" type="button">Enter</button>
<div class="err" id="err"></div>
</div>
<script>
const pw=document.getElementById("pw"),go=document.getElementById("go"),err=document.getElementById("err");
async function submit(){err.textContent="";go.disabled=true;
try{const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw.value})});
if(r.ok){location.href="/";}else{err.textContent="Wrong password.";go.disabled=false;pw.focus();pw.select();}}
catch(e){err.textContent="Try again.";go.disabled=false;}}
go.onclick=submit;pw.addEventListener("keydown",e=>{if(e.key==="Enter")submit();});
</script></body></html>`;

// ---------------------------------------------------------------------------
// Whitepages
// ---------------------------------------------------------------------------
async function wpPerson(params, maxRetries = 4) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = v == null ? "" : String(v).trim();
    if (s) qs.append(k, s);
  }
  if ([...qs.keys()].length === 0) return { ok: false, code: "no_input" };
  const url = WP_BASE + "?" + qs.toString();
  let attempt = 0;
  while (true) {
    let res;
    try { res = await fetch(url, { headers: { "X-Api-Key": API_KEY } }); }
    catch (e) { if (attempt++ < maxRetries) { await sleep(backoff(attempt)); continue; } return { ok: false, code: "network_error" }; }
    if (res.status === 200) {
      const json = await res.json().catch(() => null);
      let data = [];
      if (Array.isArray(json)) data = json;
      else if (json && Array.isArray(json.results)) data = json.results;
      return { ok: true, code: 200, data };
    }
    if (res.status === 404) return { ok: true, code: 404, data: [] };
    if (res.status === 403) return { ok: false, code: 403 };
    if (res.status === 400) return { ok: false, code: 400 };
    if (res.status === 429 || res.status >= 500) {
      if (attempt++ < maxRetries) {
        const ra = parseInt(res.headers.get("retry-after") || "0", 10);
        await sleep(ra > 0 ? ra * 1000 : backoff(attempt)); continue;
      }
      return { ok: false, code: res.status };
    }
    return { ok: false, code: res.status };
  }
}

function bestByScore(arr, getScore) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  let best = null, bestScore = -1;
  for (const item of arr) {
    const s = getScore(item);
    const score = typeof s === "number" ? s : -0.5;
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return best;
}
function rankPhones(phones) {
  const sorted = [...(phones || [])].filter((p) => p && p.number)
    .sort((a, b) => ((b.score != null ? b.score : -1) - (a.score != null ? a.score : -1)));
  const seen = new Set(), uniq = [];
  for (const p of sorted) if (!seen.has(p.number)) { seen.add(p.number); uniq.push(p); }
  return uniq;
}
function personView(person) {
  const phones = rankPhones(person.phones);
  const email = bestByScore(person.emails || [], (e) => e.score);
  const curAll = (person.current_addresses || []).map((a) => a.address || a.full_address).filter(Boolean);
  const histAll = (person.historic_addresses || []).map((a) => a.address || a.full_address).filter(Boolean);
  const seen = new Set(), addresses = [];
  for (const a of [...curAll, ...histAll]) { const k = String(a).trim(); if (k && !seen.has(k)) { seen.add(k); addresses.push(noDashes(a)); } }
  return {
    name: noDashes(person.name),
    score: person.score != null ? person.score : null,
    is_dead: person.is_dead === true,
    dob: noDashes(person.date_of_birth || ""),
    phones: phones.map((p) => ({ number: noDashes(p.number), type: noDashes(p.type || ""), score: p.score != null ? p.score : null })),
    best_address: addresses[0] || "",
    addresses,
    email: email ? noDashes(email.address || email.email) : "",
  };
}
function regionFor(body, person) {
  let city = (body.city || "").trim(), state = (body.state_code || "").trim();
  if (!state || !city) {
    const cur = (person.current_addresses || [])[0];
    const addr = cur ? (cur.address || cur.full_address || "") : "";
    const m = addr.match(/,\s*([A-Za-z .'-]+),\s*([A-Z]{2})\s+\d{5}/);
    if (m) { if (!city) city = m[1].trim(); if (!state) state = m[2].trim(); }
  }
  return { city, state };
}

// ---------------------------------------------------------------------------
// Google Maps
// ---------------------------------------------------------------------------
function haversineMiles(la1, lo1, la2, lo2) {
  const R = 3958.8, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(la2 - la1), dLon = toR(lo2 - lo1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
async function gFetch(url) {
  try { const res = await fetch(url); const data = await res.json().catch(() => ({})); return { data }; }
  catch (e) { return { data: { status: "NETWORK_ERROR" } }; }
}
async function geocode(address) {
  const { data } = await gFetch(GMAPS_BASE + "/geocode/json?address=" + encodeURIComponent(address) + "&key=" + encodeURIComponent(GMAPS_KEY));
  if (data.status === "OK" && data.results && data.results.length) {
    const r = data.results[0];
    return { ok: true, lat: r.geometry.location.lat, lng: r.geometry.location.lng, formatted: r.formatted_address };
  }
  return { ok: false, status: data.status || "ERROR" };
}
async function placePhone(placeId) {
  if (!placeId) return "";
  const { data } = await gFetch(GMAPS_BASE + "/place/details/json?place_id=" + encodeURIComponent(placeId) + "&fields=formatted_phone_number&key=" + encodeURIComponent(GMAPS_KEY));
  if (data.status === "OK" && data.result) return data.result.formatted_phone_number || "";
  return "";
}
async function nearestWalgreens(lat, lng, limit = 3) {
  const { data } = await gFetch(GMAPS_BASE + "/place/nearbysearch/json?location=" + lat + "," + lng + "&rankby=distance&keyword=walgreens&key=" + encodeURIComponent(GMAPS_KEY));
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return { status: data.status || "ERROR", stores: [] };
  const results = (data.results || []).filter((r) => /walgreens/i.test(r.name || "")).slice(0, limit);
  const stores = [];
  for (const r of results) {
    const loc = r.geometry && r.geometry.location ? r.geometry.location : {};
    const miles = (loc.lat != null && loc.lng != null) ? haversineMiles(lat, lng, loc.lat, loc.lng) : null;
    const phone = await placePhone(r.place_id);
    stores.push({
      name: noDashes(r.name || "Walgreens"),
      address: noDashes(r.vicinity || r.formatted_address || ""),
      distance_mi: miles != null ? Math.round(miles * 10) / 10 : null,
      open_now: r.opening_hours && typeof r.opening_hours.open_now === "boolean" ? r.opening_hours.open_now : null,
      phone: noDashes(phone),
    });
  }
  return { status: stores.length ? "ok" : "none_found", stores };
}
async function findWalgreens(homeAddr) {
  if (!GMAPS_KEY) return { status: "maps_not_configured", stores: [] };
  if (!homeAddr) return { status: "no_address", stores: [] };
  const geo = await geocode(homeAddr);
  if (!geo.ok) return { status: geo.status === "REQUEST_DENIED" ? "maps_key_denied" : "geocode_failed", stores: [] };
  const near = await nearestWalgreens(geo.lat, geo.lng);
  return { status: near.status, home: geo.formatted || homeAddr, stores: near.stores };
}

// ---------------------------------------------------------------------------
// App wiring + login gate
// ---------------------------------------------------------------------------
app.use(express.json({ limit: "1mb" }));

app.post("/api/login", (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  const pw = (req.body && req.body.password) || "";
  if (safeEqual(pw, APP_PASSWORD)) {
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    res.setHeader("Set-Cookie", "gauth=" + authToken() + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000" + secure);
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false });
});

app.use((req, res, next) => {
  if (req.path === "/api/login") return next();
  if (isAuthed(req)) return next();
  if (req.method === "GET" && (req.path === "/" || req.path === "")) return res.send(LOGIN_HTML);
  return res.status(401).json({ error: "auth required" });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.get("/api/health", (req, res) => res.json({ ok: true, keyConfigured: API_KEY.length > 0, mapsConfigured: GMAPS_KEY.length > 0 }));

app.get("/api/test-key", async (req, res) => {
  if (!API_KEY) return res.json({ ok: false, reason: "no_key" });
  const r = await wpPerson({ name: "John Smith", city: "Seattle", state_code: "WA" });
  if (r.code === 403) return res.json({ ok: false, reason: "invalid_key" });
  if (r.ok || r.code === 404) return res.json({ ok: true, reason: "key_works" });
  return res.json({ ok: false, reason: "error_" + r.code });
});

app.get("/api/raw", async (req, res) => {
  const fields = ["name", "first_name", "last_name", "street", "city", "state_code", "zipcode", "phone", "radius", "include_historical_locations", "include_fuzzy_matching"];
  const qs = new URLSearchParams();
  for (const f of fields) { const v = req.query[f]; if (v != null && String(v).trim()) qs.append(f, String(v).trim()); }
  if (![...qs.keys()].length) return res.json({ note: "Add params, e.g. /api/raw?phone=5615367687" });
  const url = WP_BASE + "?" + qs.toString();
  const out = { request: url, http_status: null, body: null };
  try { const r = await fetch(url, { headers: { "X-Api-Key": API_KEY } }); out.http_status = r.status; const t = await r.text(); try { out.body = JSON.parse(t); } catch { out.body = t; } }
  catch (e) { out.error = String(e); }
  res.json(out);
});

app.post("/api/search", async (req, res) => {
  if (!API_KEY) return res.status(400).json({ error: "WHITEPAGES_API_KEY is not set on the server" });
  const b = req.body || {};
  const isPhone = !!(b.phone && String(b.phone).replace(/\D/g, "").length >= 10);

  const q = {};
  if (b.phone) q.phone = String(b.phone).replace(/\D/g, "");
  if (!isPhone) {
    if (b.name) q.name = b.name;
    else { if (b.first_name) q.first_name = b.first_name; if (b.last_name) q.last_name = b.last_name; }
    if (b.street) q.street = b.street;
    if (b.city) q.city = b.city;
    if (b.state_code) q.state_code = b.state_code;
    if (b.zipcode) q.zipcode = b.zipcode;
    if (b.include_fuzzy) q.include_fuzzy_matching = "true";
    if (b.include_historical !== false) q.include_historical_locations = "true";
    const radiusMi = Math.min(100, Math.max(0, parseInt(b.radius || 0, 10)));
    if (radiusMi > 0 && (q.street || q.city || q.zipcode)) q.radius = radiusMi;
  }
  if (Object.keys(q).length === 0) return res.json({ status: "no_input" });

  const r = await wpPerson(q);
  if (!r.ok) {
    const m = { 403: "invalid_key", 400: "bad_request", 429: "rate_limited", network_error: "network_error" };
    return res.json({ status: m[r.code] || (typeof r.code === "number" && r.code >= 500 ? "server_error" : "error") });
  }

  let data = r.data || [];
  let widened = false;
  // Widen only for name searches that came up empty with a location given.
  if (!isPhone && data.length === 0 && (q.city || q.street || q.zipcode)) {
    const q2 = {};
    if (b.name) q2.name = b.name;
    else { if (b.first_name) q2.first_name = b.first_name; if (b.last_name) q2.last_name = b.last_name; }
    if (b.state_code) q2.state_code = b.state_code;
    if (b.include_fuzzy) q2.include_fuzzy_matching = "true";
    q2.include_historical_locations = "true";
    if (Object.keys(q2).length) {
      const r2 = await wpPerson(q2);
      if (r2.ok && r2.data && r2.data.length) { data = r2.data; widened = true; }
    }
  }
  if (data.length === 0) return res.json({ status: "no_match" });

  const person = bestByScore(data, (p) => p.score) || data[0];
  const pv = personView(person);

  // Next of kin: first relative with a phone.
  let nok = { found: false, tried: 0 };
  const region = regionFor(b, person);
  for (const rel of (person.relatives || []).slice(0, 8)) {
    if (!rel.name) continue;
    nok.tried++;
    const rq = { name: rel.name, include_historical_locations: "true" };
    if (region.state) rq.state_code = region.state;
    if (region.city) rq.city = region.city;
    const rr = await wpPerson(rq);
    if (rr.ok && rr.data && rr.data.length) {
      const rm = bestByScore(rr.data, (p) => p.score) || rr.data[0];
      const bp = rankPhones(rm.phones)[0];
      if (bp && bp.number) { nok = { found: true, name: noDashes(rel.name || rm.name), phone: noDashes(bp.number), type: noDashes(bp.type || ""), score: bp.score != null ? bp.score : null, tried: nok.tried }; break; }
    }
  }

  const walgreens = await findWalgreens(pv.best_address);

  res.json({ status: "matched", mode: isPhone ? "phone" : "name", queried_phone: isPhone ? String(b.phone).replace(/\D/g, "") : null, widened, person: pv, nok, walgreens });
});

app.listen(PORT, () => {
  console.log("GOOMBA Lookup on port " + PORT + " | WP:" + (API_KEY ? "y" : "n") + " Maps:" + (GMAPS_KEY ? "y" : "n") + " Login:" + (APP_PASSWORD ? "on" : "off"));
});
