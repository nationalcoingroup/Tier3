# GOOMBA Append

Live person and next-of-kin lookup backed by the Whitepages Premium API, plus
the nearest Walgreens (FedEx OnSite) to the customer's home using Google Maps.

One search box. Type in whoever you are looking for with as much detail as you
have, and it returns best phone, alt phone, best address, and email for the
person, the same block for each relative, and the closest Walgreens stores with
distance and a directions link so you can ship to a FedEx OnSite counter near
them.

## How it works

1. Person: calls `GET https://api.whitepages.com/v2/person` with the fields you
   filled in, takes the highest scoring match, and shows best phone, alt phone,
   best address, and email.
2. Relatives: with Trace relatives on, it pulls the match's relatives and runs a
   follow-up lookup on each, scoped to the household city and state, and shows
   the same block per relative.
3. Walgreens: with Nearest Walgreens on, it geocodes the home address with
   Google, runs a Places nearby search for the closest Walgreens, and shows the
   nearest few with distance, open-now status, and a directions link.

Note: Whitepages returns relatives by name only, no relationship label. And not
every Walgreens runs FedEx OnSite, so confirm the counter before sending.

## Keys you need

- `WHITEPAGES_API_KEY` - your Whitepages Premium key.
- `GOOGLE_MAPS_API_KEY` - a Google Maps Platform key with the Geocoding API and
  the Places API both enabled. If only one is enabled the store lookup fails with
  a key-denied note while person and relative lookups still work.

## Deploy on Render

1. Push this folder to a GitHub repo (or connect it directly).
2. New Web Service on Render, point it at the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add two environment variables:
   - `WHITEPAGES_API_KEY` = your Whitepages Premium key
   - `GOOGLE_MAPS_API_KEY` = your Google Maps Platform key
6. Deploy and open the URL. The header shows a key pill and a maps pill. Both
   should read ok.

Optional staging overrides: `WHITEPAGES_BASE_URL` and `GOOGLE_MAPS_BASE_URL`.

Both keys are read from the environment on the server and never reach the
browser.

## Run locally

```
npm install
WHITEPAGES_API_KEY=your_wp_key GOOGLE_MAPS_API_KEY=your_maps_key npm start
```

Then open http://localhost:3000

## Billing

- Whitepages: each search is one query, each relative traced is one more. With
  relatives on and 4 traced, a search can cost up to 5 Whitepages queries.
- Google: each search with Walgreens on costs one Geocoding call plus one Places
  Nearby Search call. Google bills these separately from Whitepages.
- Turn off Trace relatives or Nearest Walgreens to skip those calls.
- Em and en dashes are stripped from every value returned.

## Compliance flag

Whitepages Premium contact data is not an FCRA consumer report and must not be
used for credit, employment, insurance, or tenant screening. Locating a customer
or their next of kin to deliver goods they already own is a standard permissible
use. Keep usage inside that lane.
