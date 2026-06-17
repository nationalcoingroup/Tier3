// GOOMBA Append - live person and next-of-kin lookup, plus nearest Walgreens
// (FedEx OnSite) to the customer's home.
//
// Whitepages Premium API:  GET https://api.whitepages.com/v2/person
// Google Maps Platform:    Geocoding API + Places API (Nearby Search)
//
// Both keys are read from environment variables and never leave the server.
//   WHITEPAGES_API_KEY   - Whitepages Premium key
//   GOOGLE_MAPS_API_KEY  - Google Maps Platform key (Geocoding + Places enabled)

process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err && err.stack ? err.stack : err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err && err.stack ? err.stack : err));

const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.WHITEPAGES_API_KEY || "";
const WP_BASE = process.env.WHITEPAGES_BASE_URL || "https://api.whitepages.com/v2/person";
const GMAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const GMAPS_BASE = process.env.GOOGLE_MAPS_BASE_URL || "https://maps.googleapis.com/maps/api";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt) => Math.min(8000, 1000 * Math.pow(2, attempt - 1));

// House rule: strip em and en dashes from any value we hand back.
function noDashes(v) {
  if (v == null) return "";
  return String(v).replace(/[\u2012\u2013\u2014\u2015]/g, "-");
}

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
    try {
      res = await fetch(url, { headers: { "X-Api-Key": API_KEY } });
    } catch (e) {
      if (attempt++ < maxRetries) { await sleep(backoff(attempt)); continue; }
      return { ok: false, code: "network_error" };
    }
    if (res.status === 200) {
      const data = await res.json().catch(() => []);
      return { ok: true, code: 200, data: Array.isArray(data) ? data : [] };
    }
    if (res.status === 404) return { ok: true, code: 404, data: [] };
    if (res.status === 403) return { ok: false, code: 403 };
    if (res.status === 400) return { ok: false, code: 400 };
    if (res.status === 429 || res.status >= 500) {
      if (attempt++ < maxRetries) {
        const ra = parseInt(res.headers.get("retry-after") || "0", 10);
        await sleep(ra > 0 ? ra * 1000 : backoff(attempt));
        continue;
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
  for (const p of sorted) { if (!seen.has(p.number)) { seen.add(p.number); uniq.push(p); } }
  return uniq;
}

function personView(person) {
  const phones = rankPhones(person.phones);
  const best = phones[0] || null;
  const alt = phones[1] || null;
  const email = bestByScore(person.emails || [], (e) => e.score);
  const cur = (person.current_addresses || [])[0];
  const hist = (person.historic_addresses || [])[0];
  const addr = cur ? (cur.address || cur.full_address) : (hist ? (hist.address || hist.full_address) : "");
  return {
    name: noDashes(person.name),
    score: person.score != null ? person.score : null,
    is_dead: person.is_dead === true,
    dob: noDashes(person.date_of_birth || ""),
    best_phone: best ? { number: noDashes(best.number), type: noDashes(best.type || ""), score: best.score != null ? best.score : null } : null,
    alt_phone: alt ? { number: noDashes(alt.number), type: noDashes(alt.type || ""), score: alt.score != null ? alt.score : null } : null,
    best_address: noDashes(addr),
    email: email ? noDashes(email.address || email.email) : "",
  };
}

function regionFor(body, person) {
  let city = (body.city || "").trim();
  let state = (body.state_code || "").trim();
  if (!state || !city) {
    const cur = (person.current_addresses || [])[0];
    const addr = cur ? (cur.address || cur.full_address || "") : "";
    const m = addr.match(/,\s*([A-Za-z .'-]+),\s*([A-Z]{2})\s+\d{5}/);
    if (m) { if (!city) city = m[1].trim(); if (!state) state = m[2].trim(); }
  }
  return { city, state };
}

// ---------------------------------------------------------------------------
// Google Maps: geocode the home, then find nearest Walgreens
// ---------------------------------------------------------------------------

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function gFetch(url) {
  try {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    return { httpOk: res.ok, data };
  } catch (e) {
    return { httpOk: false, data: { status: "NETWORK_ERROR" } };
  }
}

async function geocode(address) {
  const url = GMAPS_BASE + "/geocode/json?address=" + encodeURIComponent(address) + "&key=" + encodeURIComponent(GMAPS_KEY);
  const { data } = await gFetch(url);
  if (data.status === "OK" && data.results && data.results.length) {
    const r = data.results[0];
    return { ok: true, lat: r.geometry.location.lat, lng: r.geometry.location.lng, formatted: r.formatted_address };
  }
  return { ok: false, status: data.status || "ERROR" };
}

async function nearestWalgreens(lat, lng, homeAddr, limit = 3) {
  const url = GMAPS_BASE + "/place/nearbysearch/json?location=" + lat + "," + lng +
    "&rankby=distance&keyword=walgreens&key=" + encodeURIComponent(GMAPS_KEY);
  const { data } = await gFetch(url);
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    return { status: data.status || "ERROR", stores: [] };
  }
  const results = (data.results || []).filter((r) => /walgreens/i.test(r.name || ""));
  const stores = results.slice(0, limit).map((r) => {
    const loc = r.geometry && r.geometry.location ? r.geometry.location : {};
    const miles = (loc.lat != null && loc.lng != null) ? haversineMiles(lat, lng, loc.lat, loc.lng) : null;
    const vicinity = r.vicinity || r.formatted_address || "";
    const dir = "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(homeAddr) +
      "&destination=" + encodeURIComponent((r.name || "Walgreens") + " " + vicinity);
    return {
      name: noDashes(r.name || "Walgreens"),
      address: noDashes(vicinity),
      distance_mi: miles != null ? Math.round(miles * 10) / 10 : null,
      open_now: r.opening_hours && typeof r.opening_hours.open_now === "boolean" ? r.opening_hours.open_now : null,
      directions_url: dir,
    };
  });
  return { status: stores.length ? "ok" : "none_found", stores };
}

async function findWalgreens(homeAddr) {
  if (!GMAPS_KEY) return { status: "maps_not_configured", stores: [] };
  if (!homeAddr) return { status: "no_address", stores: [] };
  const geo = await geocode(homeAddr);
  if (!geo.ok) {
    if (geo.status === "REQUEST_DENIED") return { status: "maps_key_denied", stores: [] };
    if (geo.status === "ZERO_RESULTS") return { status: "geocode_failed", stores: [] };
    return { status: "geocode_failed", stores: [] };
  }
  const near = await nearestWalgreens(geo.lat, geo.lng, geo.formatted || homeAddr);
  return { status: near.status, home: geo.formatted || homeAddr, stores: near.stores };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

app.get("/api/health", (req, res) => res.json({
  ok: true,
  keyConfigured: API_KEY.length > 0,
  mapsConfigured: GMAPS_KEY.length > 0,
}));

app.get("/api/test-key", async (req, res) => {
  if (!API_KEY) return res.json({ ok: false, reason: "no_key" });
  const r = await wpPerson({ name: "John Smith", city: "Seattle", state_code: "WA" });
  if (r.code === 403) return res.json({ ok: false, reason: "invalid_key" });
  if (r.ok || r.code === 404) return res.json({ ok: true, reason: "key_works" });
  return res.json({ ok: false, reason: "error_" + r.code });
});

app.post("/api/search", async (req, res) => {
  if (!API_KEY) return res.status(400).json({ error: "WHITEPAGES_API_KEY is not set on the server" });
  const b = req.body || {};

  const q = {};
  if (b.name) q.name = b.name;
  else { if (b.first_name) q.first_name = b.first_name; if (b.last_name) q.last_name = b.last_name; }
  if (b.street) q.street = b.street;
  if (b.city) q.city = b.city;
  if (b.state_code) q.state_code = b.state_code;
  if (b.zipcode) q.zipcode = b.zipcode;
  if (b.phone) q.phone = String(b.phone).replace(/\D/g, "");
  if (b.include_historical) q.include_historical_locations = "true";
  if (b.include_fuzzy) q.include_fuzzy_matching = "true";

  if (Object.keys(q).length === 0) return res.json({ status: "no_input" });

  const r = await wpPerson(q);
  if (!r.ok) {
    const m = { 403: "invalid_key", 400: "bad_request", 429: "rate_limited", network_error: "network_error" };
    const st = m[r.code] || (typeof r.code === "number" && r.code >= 500 ? "server_error" : "error");
    return res.json({ status: st });
  }
  if (!r.data || r.data.length === 0) return res.json({ status: "no_match" });

  const person = bestByScore(r.data, (p) => p.score) || r.data[0];
  const pv = personView(person);

  // Relatives
  const traceRel = b.trace_relatives !== false;
  const maxRel = Math.min(8, Math.max(0, parseInt(b.max_relatives != null ? b.max_relatives : 4, 10)));
  const region = regionFor(b, person);
  const relatives = [];
  if (traceRel && maxRel > 0) {
    for (const rel of (person.relatives || []).slice(0, maxRel)) {
      const block = { name: noDashes(rel.name || ""), found: false };
      if (rel.name) {
        const rq = { name: rel.name };
        if (region.state) rq.state_code = region.state;
        if (region.city) rq.city = region.city;
        const rr = await wpPerson(rq);
        if (rr.ok && rr.data && rr.data.length) {
          const rm = bestByScore(rr.data, (p) => p.score) || rr.data[0];
          Object.assign(block, personView(rm), { name: noDashes(rel.name || rm.name), found: true });
        }
      }
      relatives.push(block);
    }
  }

  // Nearest Walgreens (FedEx OnSite) to the home address
  let walgreens = null;
  if (b.find_walgreens !== false) {
    const homeAddr = pv.best_address ||
      [b.street, b.city, b.state_code, b.zipcode].filter(Boolean).join(", ");
    walgreens = await findWalgreens(homeAddr);
  }

  res.json({ status: "matched", person: pv, relatives, walgreens });
});

app.listen(PORT, () => {
  console.log("GOOMBA Append (search) running on port " + PORT);
  console.log("Whitepages key configured: " + (API_KEY ? "yes" : "no"));
  console.log("Google Maps key configured: " + (GMAPS_KEY ? "yes" : "no"));
});
