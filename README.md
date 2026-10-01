# Austin road conditions

A static Astro site that shows the latest reading from selected road-surface
sensors on a map, with the nearby CCTV snapshot for each. Data comes straight
from the City of Austin open data portal
([Real-Time Road Conditions, ypbq-i42h](https://data.austintexas.gov/Transportation-and-Mobility/Real-Time-Road-Conditions/ypbq-i42h)).
The browser queries the portal's SODA API directly, so there is no server to run.

## Run it

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static site in dist/
```

## Configure

Everything lives in `src/config/sensors.ts`:

- `SENSORS`: sensor ids, display names, and CCTV URLs (same data as your bot config).
- `staleAfterHours`: readings older than this are flagged "Outdated" (default 4).
- `refreshMinutes`: how often the page re-queries the portal (default 5).
- `timestampTimeZone`: see below.
- `tileUrl` / `tileAttribution`: basemap tiles (default: OpenStreetMap's public server, no key needed, light use only).
- `cctvCacheBustMinutes`: camera URLs get a shared `?t=<time bucket>` so visitors in
  the same window request the same URL. Set to `0` to use the bare URL.

Condition codes and their labels are in `src/lib/conditions.ts`.

Optional: copy `.env.example` to `.env` and set `PUBLIC_SOCRATA_APP_TOKEN` for a
higher API rate limit.

## Weather alerts

Active National Weather Service alerts (watches, warnings, advisories) appear as banners at
the top of the map, for example "Flash Flood Watch in effect until 9 PM Friday". They come from
the free [api.weather.gov](https://www.weather.gov/documentation/services-web-api) alerts
endpoint, which needs no key. Banners are coloured by the alert's severity, sorted most
severe first, and expand to show the NWS description, affected areas and what to do. Only
three show at once; the rest sit behind "Show more alerts".

The alerts are looked up by point (`alertPoints` in `src/config/sensors.ts`; Austin and
Round Rock by default) and merged. Add a point to cover another area, or list event names
in `ignoredAlertEvents` to leave some out. Alerts load separately from the sensors and never
hold up the loading screen. If the lookup fails, a notice links to the National Weather
Service instead of silently showing nothing.

## Loading

Sensors are shown one by one as their own requests finish. The full-screen loading screen
ends as soon as the first sensor has a real reading (or once every sensor has answered, if
none succeed), and any card still waiting shows grey shimmering placeholders. Pins appear on
the map as sensors arrive, and the map keeps re-framing to fit them until the visitor first
touches it. Traffic incidents and weather alerts load independently and never hold anything up.

## Outdated sites

A site whose latest reading is older than `staleAfterHours` is hidden by default, both
its card and its map pin. When at least one site is outdated, a note under the list says
how many are hidden, with a **Show outdated sites** button. Once shown, outdated sites
keep their "Outdated" badge and hatched grey pin. The map re-frames to whichever sites
are visible.

## Portal request errors

Each request to the open data portal makes one attempt and gives up after 30 seconds. If a
sensor can't load, its card says why ("took too long to respond", "is limiting requests right
now", "had a problem (HTTP 503)") instead of a generic message. The Refresh button, or the
5-minute timer, tries again.

## Traffic incidents

The map also shows active traffic incidents from the
[Real-Time Traffic Incident Reports](https://data.austintexas.gov/Transportation-and-Mobility/Real-Time-Traffic-Incident-Reports/dx9v-zd7x)
dataset (`dx9v-zd7x`). The query filters on `traffic_report_status='ACTIVE'` on the
server, and the code re-checks that status on every row. Incidents sit on their own map
pane beneath the sensor pins, and a checkbox under the sensor list turns them on or off.
The settings `incidentsDatasetId`, `incidentStatus` and `showIncidentsByDefault` are in
`src/config/sensors.ts`. Incidents refresh on the same timer as the sensors.

## Verify the timestamp timezone

The dataset's `timestamp` column is a floating timestamp (no zone). The 4-hour
check depends on reading it in the right zone, and this is set to
`America/Chicago` by default. To confirm, compare the newest row for a sensor
in the portal against the current time. If everything shows "Outdated", or the
page warns that a timestamp is in the future, switch `timestampTimeZone` to `"UTC"`.

## How data is fetched

The dataset is a history table (one row per reading), so for each configured
sensor the page asks for one row: `sensor_id = <id>`, ordered by `timestamp DESC`,
limit 1. The incident request sends no `$select` or `$order` (sorting happens in the browser), so a renamed column can't fail the whole request. Temperatures of 100.1 are the sensor's error value and display as
"Not available".

## Deploy to GitHub Pages

The site is fully static (all data is fetched in the visitor's browser), so GitHub Pages
can host it. The workflow in `.github/workflows/deploy.yml` builds and publishes it.

1. Create a GitHub repository and push this project to its `main` branch.
2. In the repository go to **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Push (or run the workflow from the **Actions** tab). When it finishes, the site is at
   `https://<username>.github.io/<repo-name>/`.

The workflow works out the site URL and base path from the repository, so there is nothing
to edit. The exceptions:

- **`<username>.github.io` repository:** served from the root. The workflow detects this.
- **Custom domain:** add a file `public/CNAME` containing the domain, point DNS at GitHub,
  and set a repository variable `SITE_URL` (Settings > Secrets and variables > Actions >
  Variables) to `https://your-domain`.
- **Socrata app token (optional):** set a repository variable `PUBLIC_SOCRATA_APP_TOKEN`. It
  is embedded in the built site, so use a read-only token.

GitHub Pages on a free GitHub account needs a public repository. Node 22.12 or newer is
required to build (the workflow uses Node 24).

To build by hand for a project site:
`SITE=https://<username>.github.io BASE_PATH=/<repo-name> npm run build`.

Other static hosts work too. On Cloudflare Pages use build command `npm run build` and
output directory `dist`.
