# GOOMBA Append

Password protected lookup tool. Live person and next-of-kin search backed by the
Whitepages Premium API, plus the nearest Walgreens (FedEx OnSite) to the
customer's home using Google Maps.

All files sit flat in the repo root. There is no subfolder to get wrong.

## Environment variables (set in the Render dashboard)

- `WHITEPAGES_API_KEY` - your Whitepages Premium key (required)
- `GOOGLE_MAPS_API_KEY` - Google Maps key with Geocoding API and Places API both
  enabled (required for the Walgreens feature)
- `APP_PASSWORD` - the password to open the site. Pick your own. If left blank,
  the site has no password.
- `APP_USER` - the username, defaults to `ncg` if you do not set it.

## Deploy on Render

1. Build Command: `npm install`
2. Start Command: `npm start`
3. Add the environment variables above.
4. Deploy, open the URL. The browser asks for the username and password first.
   Username is `ncg` (or whatever you set APP_USER to) and the password is your
   APP_PASSWORD value. After that the page loads and the key and maps pills
   should read ok.

## Run locally

```
npm install
WHITEPAGES_API_KEY=your_wp_key GOOGLE_MAPS_API_KEY=your_maps_key APP_PASSWORD=pickone npm start
```

Then open http://localhost:3000

## Billing

- Whitepages: each search is one query, each relative traced is one more.
- Google: each search with Walgreens on is one geocode call plus one places call.
- Toggles let you skip relatives or Walgreens per search.
- Em and en dashes are stripped from every value returned.

## Compliance flag

Whitepages Premium contact data is not an FCRA consumer report and must not be
used for credit, employment, insurance, or tenant screening. Locating a customer
or their next of kin to deliver goods they already own is a standard permissible
use.
