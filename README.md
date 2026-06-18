# GOOMBA Lookup

One search box, full workup. Password protected. Backed by the Whitepages
Premium API plus Google Maps for nearest Walgreens (FedEx OnSite).

## How it works

Type one thing and hit enter:
- A phone number (any format) runs a reverse lookup and leads with the owner.
- A name with a city and state, or just a name and state, runs a person search.

It auto-detects which. Every search returns the full workup: all phones, email,
current address plus every other address on file, the first next of kin with a
phone, and the nearest Walgreens with their store phone numbers. Historical
addresses are matched by default, so it finds people on any address they have
ever had, the way the public site does.

Examples:
- `wayne nettnay, north attleboro, ma`
- `wayne nettnay fl`
- `561-536-7687`

## Login

A single password page, no username. Set `APP_PASSWORD` to the password you want.
Anyone who knows it gets in. Leave it blank to run with no login.

## Environment variables (set in Render)

- `WHITEPAGES_API_KEY` - Whitepages Premium key (required)
- `GOOGLE_MAPS_API_KEY` - Google Maps key with Geocoding API and Places API enabled
- `APP_PASSWORD` - the login password

## Deploy on Render

Build Command `npm install`, Start Command `npm start`, add the three variables.
Or deploy the included render.yaml as a Blueprint and fill the values when asked.

## Billing note

A name search is one Whitepages query (plus one more per relative checked for a
next-of-kin phone). The Walgreens panel adds Google calls (one geocode, one
nearby search, one details call per store shown). Pennies, but it adds up at
volume.

## Compliance flag

Whitepages Premium data is not an FCRA consumer report. Do not use it for credit,
employment, insurance, or tenant screening. Locating a customer or their next of
kin to deliver goods they already own is a standard permissible use.
