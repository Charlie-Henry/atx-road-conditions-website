import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SENSORS, SETTINGS, type SensorConfig } from "../config/sensors";
import { describeCondition, describeGrip, gripTagText, type ConditionInfo, type GripInfo } from "../lib/conditions";
import { fetchWeatherAlerts } from "../lib/alerts";
import { createAlertsUI } from "./alerts-ui";
import { formatAge, formatAgeLong, formatDuration, getFreshness, type Freshness } from "../lib/freshness";
import { fetchActiveIncidents, type Incident } from "../lib/incidents";
import { fetchLatestReading, type Reading } from "../lib/socrata";

interface CardRefs {
  li: HTMLLIElement;
  head: HTMLButtonElement;
  chip: HTMLSpanElement;
  grip: HTMLSpanElement;
  badge: HTMLSpanElement;
  age: HTMLSpanElement;
  body: HTMLDivElement;
  notes: HTMLDivElement;
  img: HTMLImageElement;
  camNote: HTMLParagraphElement;
  facts: HTMLDListElement;
}

interface SensorState {
  config: SensorConfig;
  card: CardRefs;
  loaded: boolean;
  /** Latest reading is older than SETTINGS.staleAfterHours. */
  stale: boolean;
  reading: Reading | null;
  /** Message from the most recent failed fetch; cleared on success. */
  error: string | null;
  marker: L.Marker | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const listEl = $<HTMLOListElement>("sensor-list");
const bannerEl = $<HTMLParagraphElement>("banner");
const checkedEl = $<HTMLSpanElement>("checked");
const refreshBtn = $<HTMLButtonElement>("refresh");
const incidentsToggle = $<HTMLInputElement>("toggle-incidents");
const incidentsLabel = $<HTMLSpanElement>("incidents-label");
const outdatedBox = $<HTMLDivElement>("outdated-filter");
const outdatedNote = $<HTMLParagraphElement>("outdated-note");
const outdatedBtn = $<HTMLButtonElement>("toggle-outdated");
const alertsUI = createAlertsUI($<HTMLDivElement>("alerts"));
const loadingEl = $<HTMLDivElement>("loading");
const loadingSlowEl = $<HTMLParagraphElement>("loading-slow");

const displayTime = new Intl.DateTimeFormat("en-US", {
  timeZone: SETTINGS.displayTimeZone,
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const displayDateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: SETTINGS.displayTimeZone,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

// ---------- map ----------

const map = L.map("map").setView(SETTINGS.mapCenter, SETTINGS.mapZoom);
L.tileLayer(SETTINGS.tileUrl, {
  attribution: SETTINGS.tileAttribution,
  maxZoom: SETTINGS.tileMaxZoom,
}).addTo(map);

// ---------- traffic incidents layer ----------

// Own pane, just below the default marker pane, so sensor pins always sit on top.
map.createPane("incidents").style.zIndex = "590";
const incidentLayer = L.layerGroup();
const incidentMarkers = new Map<string, { marker: L.Marker; incident: Incident }>();
let incidents: Incident[] = [];
let incidentsLoaded = false;
let incidentsError = false;

incidentsToggle.checked = SETTINGS.showIncidentsByDefault;
if (incidentsToggle.checked) incidentLayer.addTo(map);
incidentsToggle.addEventListener("change", () => {
  if (incidentsToggle.checked) incidentLayer.addTo(map);
  else incidentLayer.remove();
});

function renderIncidentLabel() {
  let text = "Traffic incidents";
  if (incidentsLoaded) {
    text += incidentsError && incidents.length === 0 ? " (unavailable)" : ` (${incidents.length} active)`;
  }
  incidentsLabel.textContent = text;
}

function incidentPopup(incident: Incident): HTMLElement {
  const root = document.createElement("div");
  root.className = "incident-popup";
  const add = (tag: "strong" | "p", text: string, cls?: string) => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    root.append(el);
  };

  add("strong", `Incident Reported: ${incident.issue}`, "incident-popup__issue");

  // "Reported 7 minutes ago by AUSTIN PD", dropping whichever part the data doesn't have
  const when = incident.reportedAt ? ` ${formatAgeLong(Date.now() - incident.reportedAt.getTime())}` : "";
  const who = incident.agency ? ` by ${incident.agency}` : "";
  if (when || who) add("p", `Reported${when}${who}`);

  if (incident.address) add("p", `Location: ${incident.address}`);
  return root;
}

function syncIncidentMarkers() {
  const seen = new Set<string>();
  for (const incident of incidents) {
    seen.add(incident.id);
    const existing = incidentMarkers.get(incident.id);
    if (existing) {
      existing.incident = incident;
      existing.marker.setLatLng([incident.lat, incident.lng]);
      continue;
    }
    const entry = {
      incident,
      marker: L.marker([incident.lat, incident.lng], {
        pane: "incidents",
        keyboard: true,
        riseOnHover: true,
        title: incident.address ? `${incident.issue}, ${incident.address}` : incident.issue,
        icon: L.divIcon({
          className: "incident-wrap",
          iconSize: [22, 22],
          iconAnchor: [11, 11],
          popupAnchor: [0, -12],
          html: `<span class="incident-pin" aria-hidden="true"><svg viewBox="0 0 22 22" aria-hidden="true" focusable="false"><rect x="9.6" y="4.3" width="2.8" height="8.4" rx="1.4"/><circle cx="11" cy="16.2" r="1.7"/></svg></span>`,
        }),
      }),
    };
    // Content is built on open, so "Reported x min ago" is always current.
    entry.marker.bindPopup(() => incidentPopup(entry.incident));
    incidentMarkers.set(incident.id, entry);
    incidentLayer.addLayer(entry.marker);
  }
  // Incidents that are no longer active disappear from the map.
  for (const [id, entry] of incidentMarkers) {
    if (!seen.has(id)) {
      incidentLayer.removeLayer(entry.marker);
      incidentMarkers.delete(id);
    }
  }
  renderIncidentLabel();
}

// ---------- cards ----------

function buildCard(config: SensorConfig): CardRefs {
  const li = document.createElement("li");
  li.className = "sensor";
  li.innerHTML = `
    <button type="button" class="sensor__head" aria-expanded="false">
      <span class="sensor__name"></span>
      <span class="sensor__tags">
        <span class="chip"></span>
        <span class="grip" hidden></span>
        <span class="badge" hidden>Outdated</span>
      </span>
      <span class="sensor__age"></span>
    </button>
    <div class="sensor__body" hidden>
      <div class="notes"></div>
      <figure class="cam">
        <img alt="" decoding="async" />
        <figcaption class="cam__note"></figcaption>
      </figure>
      <dl class="facts"></dl>
    </div>`;
  (li.querySelector(".sensor__name") as HTMLElement).textContent = config.name;
  const img = li.querySelector("img") as HTMLImageElement;
  img.alt = `Traffic camera view near ${config.name}`;
  const camNote = li.querySelector(".cam__note") as HTMLParagraphElement;
  camNote.textContent = "Loading camera view…";
  img.addEventListener("load", () => {
    camNote.textContent = "Snapshot from a traffic camera nearby";
  });
  img.addEventListener("error", () => {
    camNote.textContent = "Camera view unavailable right now.";
  });
  listEl.append(li);
  return {
    li,
    head: li.querySelector(".sensor__head") as HTMLButtonElement,
    chip: li.querySelector(".chip") as HTMLSpanElement,
    grip: li.querySelector(".grip") as HTMLSpanElement,
    badge: li.querySelector(".badge") as HTMLSpanElement,
    age: li.querySelector(".sensor__age") as HTMLSpanElement,
    body: li.querySelector(".sensor__body") as HTMLDivElement,
    notes: li.querySelector(".notes") as HTMLDivElement,
    img,
    camNote,
    facts: li.querySelector(".facts") as HTMLDListElement,
  };
}

const states: SensorState[] = SENSORS.map((config) => ({
  config,
  card: buildCard(config),
  loaded: false,
  stale: false,
  reading: null,
  error: null,
  marker: null,
}));

let selectedId: string | null = null;
/** Outdated sites are hidden (card and map pin) until the visitor asks for them. */
let showOutdated = false;

// ---------- formatting ----------

const fahrenheit = (c: number) => Math.round((c * 9) / 5 + 32);
const tempText = (c: number | null) => (c === null ? "Not available" : `${fahrenheit(c)}°F (${Math.round(c)}°C)`);

function addFact(dl: HTMLElement, label: string, value: string) {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  row.append(dt, dd);
  dl.append(row);
}

function addNote(container: HTMLElement, text: string, kind: "stale" | "error") {
  const p = document.createElement("p");
  p.className = `note note--${kind}`;
  p.textContent = text;
  container.append(p);
}

// ---------- rendering ----------

function pinIcon(
  label: string,
  info: ConditionInfo,
  grip: GripInfo | null,
  fresh: Freshness,
  selected: boolean,
): L.DivIcon {
  // Labels here come from fixed lookup tables, never from raw feed text, so they are safe to inline.
  const gripHtml =
    grip && grip.level !== "other"
      ? `<span class="pin__grip" data-grip="${grip.level}">${gripTagText(grip)}</span>`
      : "";
  return L.divIcon({
    className: "pin-wrap",
    iconSize: [0, 0],
    html: `<span class="pin" data-severity="${info.severity}" data-stale="${fresh.isStale}" data-selected="${selected}"><span class="pin__cond">${label}</span>${gripHtml}<span class="pin__stale">Outdated</span></span>`,
  });
}

function renderSensor(state: SensorState, now: Date) {
  const { card, reading, config } = state;

  if (!state.loaded) {
    card.chip.textContent = "Loading";
    card.chip.dataset.severity = "unknown";
    card.li.dataset.severity = "unknown";
    card.grip.hidden = true;
    card.li.hidden = false;
    state.stale = false;
    card.age.textContent = "";
    return;
  }

  card.notes.replaceChildren();
  card.facts.replaceChildren();

  if (!reading) {
    card.chip.textContent = "No data";
    card.chip.dataset.severity = "unknown";
    card.li.dataset.severity = "unknown";
    card.grip.hidden = true;
    card.li.hidden = false;
    state.stale = false;
    card.badge.hidden = true;
    card.li.dataset.stale = "false";
    card.age.textContent = state.error ?? "No readings found";
    if (state.error) addNote(card.notes, state.error, "error");
    return;
  }

  const info = describeCondition(reading.conditionCode);
  const fresh = getFreshness(reading.observedAt, now, SETTINGS.staleAfterHours);

  card.chip.textContent = info.label;
  card.chip.dataset.severity = info.severity;
  card.li.dataset.severity = info.severity;
  card.badge.hidden = !fresh.isStale;
  card.li.dataset.stale = String(fresh.isStale);
  state.stale = fresh.isStale;
  const hideSite = fresh.isStale && !showOutdated;
  card.li.hidden = hideSite;

  const grip = describeGrip(reading.grip);
  const showGrip = grip !== null && grip.level !== "other";
  card.grip.hidden = !showGrip;
  if (showGrip) {
    card.grip.textContent = gripTagText(grip);
    card.grip.dataset.grip = grip.level;
  }
  card.age.textContent = fresh.isFuture ? "Time looks wrong" : `Updated ${formatAge(fresh.ageMs)}`;

  if (fresh.isStale) {
    addNote(
      card.notes,
      `This reading is ${formatDuration(fresh.ageMs)} old (more than ${SETTINGS.staleAfterHours} hours). It may not match what the road is like now.`,
      "stale",
    );
  }
  if (state.error) {
    addNote(card.notes, `${state.error} Showing the last reading that loaded.`, "error");
  }

  addFact(card.facts, "Observed", displayDateTime.format(reading.observedAt));
  addFact(card.facts, "Road surface", tempText(reading.surfaceTempC));
  addFact(card.facts, "Air", tempText(reading.airTempC));
  if (reading.humidity !== null) addFact(card.facts, "Humidity", `${Math.round(reading.humidity)}%`);
  // Good/fair/poor grip is shown as a tag above; only unrecognized values land here.
  if (grip?.level === "other") addFact(card.facts, "Grip", grip.label);
  if (reading.measuredCode && reading.measuredCode !== reading.conditionCode) {
    addFact(card.facts, "Raw sensor reading", describeCondition(reading.measuredCode).label);
  }

  // Map marker
  const lat = reading.lat ?? config.lat ?? null;
  const lng = reading.lng ?? config.lng ?? null;
  if (lat !== null && lng !== null) {
    const icon = pinIcon(info.label, info, grip, fresh, selectedId === config.id);
    if (state.marker) {
      state.marker.setLatLng([lat, lng]).setIcon(icon);
    } else {
      state.marker = L.marker([lat, lng], {
        icon,
        keyboard: true,
        riseOnHover: true,
        title: config.name,
      })
        .on("click", () => select(config.id, { toggle: false, fromMap: true }));
    }
    state.marker.options.title = `${config.name}: ${info.label}${showGrip ? `, ${grip.label.toLowerCase()} grip` : ""}${fresh.isStale ? " (outdated)" : ""}`;
    state.marker.getElement()?.setAttribute("title", state.marker.options.title);

    // Outdated sites leave the map too, unless the visitor chose to show them.
    const onMap = map.hasLayer(state.marker);
    if (hideSite && onMap) state.marker.remove();
    else if (!hideSite && !onMap) state.marker.addTo(map);
  }
}

function renderAll() {
  const now = new Date();
  states.forEach((s) => renderSensor(s, now));

  // If the open card just became hidden (e.g. its reading aged past the limit), close it.
  const open = states.find((s) => s.config.id === selectedId);
  if (open?.card.li.hidden) {
    selectedId = null;
    open.card.head.setAttribute("aria-expanded", "false");
    open.card.body.hidden = true;
    open.card.li.dataset.selected = "false";
  }

  renderOutdatedFilter();
  renderBanner(now);
  alertsUI.render(now);
}

function renderOutdatedFilter() {
  const count = states.filter((s) => s.stale).length;
  outdatedBox.hidden = count === 0;
  if (count === 0) return;

  const sites = (n: number) => `${n} ${n === 1 ? "site" : "sites"}`;
  const hours = `${SETTINGS.staleAfterHours} ${SETTINGS.staleAfterHours === 1 ? "hour" : "hours"}`;
  const anyVisible = states.some((s) => !s.card.li.hidden);

  if (showOutdated) {
    outdatedNote.textContent = `Showing ${sites(count)} whose latest reading is more than ${hours} old.`;
  } else if (!anyVisible) {
    outdatedNote.textContent = `No sites have recent data. ${
      count === 1 ? "The only site has" : `All ${count} sites have`
    } a latest reading more than ${hours} old.`;
  } else {
    outdatedNote.textContent = `${sites(count)} hidden because the latest reading is more than ${hours} old.`;
  }
  outdatedBtn.textContent = showOutdated ? "Hide outdated sites" : "Show outdated sites";
}

/** Zoom the map to the sites currently shown. Returns false if there is nothing to frame. */
function fitToVisible(): boolean {
  const points = states.flatMap((s) => (s.marker && map.hasLayer(s.marker) ? [s.marker.getLatLng()] : []));
  if (!points.length) return false;
  map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 13 });
  return true;
}

outdatedBtn.addEventListener("click", () => {
  showOutdated = !showOutdated;
  renderAll();
  fitToVisible();
});

function renderBanner(now: Date) {
  const loadedStates = states.filter((s) => s.loaded);
  const anyFuture = states.some(
    (s) => s.reading && getFreshness(s.reading.observedAt, now, SETTINGS.staleAfterHours).isFuture,
  );
  const allFailed = loadedStates.length > 0 && loadedStates.every((s) => s.error);
  const anyReading = states.some((s) => s.reading);

  const messages: string[] = [];
  if (anyFuture) {
    messages.push(
      "A sensor timestamp is in the future, so outdated-data checks can't be trusted. Check timestampTimeZone in src/config/sensors.ts.",
    );
  } else if (allFailed) {
    messages.push(
      anyReading
        ? "Couldn't reach the open data portal. Showing the last readings that loaded."
        : "Couldn't load sensor data from the open data portal. Try again in a minute.",
    );
  }
  if (incidentsError) {
    messages.push(
      incidents.length
        ? "Couldn't refresh traffic incidents. Showing the last ones that loaded."
        : "Couldn't load traffic incidents.",
    );
  }
  bannerEl.textContent = messages.join(" ");
  bannerEl.hidden = messages.length === 0;
}

// ---------- selection & camera ----------

function cameraUrl(url: string): string {
  const minutes = SETTINGS.cctvCacheBustMinutes;
  if (!minutes) return url;
  const bucket = Math.floor(Date.now() / (minutes * 60_000));
  return `${url}${url.includes("?") ? "&" : "?"}t=${bucket}`;
}

function loadCamera(state: SensorState) {
  const next = cameraUrl(state.config.cctvUrl);
  if (state.card.img.getAttribute("src") !== next) state.card.img.src = next;
}

function select(id: string | null, opts: { toggle: boolean; fromMap?: boolean }) {
  selectedId = opts.toggle && selectedId === id ? null : id;
  for (const s of states) {
    const open = s.config.id === selectedId;
    s.card.head.setAttribute("aria-expanded", String(open));
    s.card.body.hidden = !open;
    s.card.li.dataset.selected = String(open);
    // Only fetch a camera image once someone actually opens that sensor.
    if (open) loadCamera(s);
  }
  renderAll();
  const active = states.find((s) => s.config.id === selectedId);
  if (active?.marker) map.panTo(active.marker.getLatLng());
  if (opts.fromMap && active) active.card.li.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

states.forEach((s) =>
  s.card.head.addEventListener("click", () => select(s.config.id, { toggle: true })),
);

// ---------- loading screen ----------

type StepState = "done" | "partial" | "failed";
const STEP_TEXT: Record<StepState, string> = {
  done: "Loaded",
  partial: "Some unavailable",
  failed: "Couldn't load",
};

function setStep(step: "sensors" | "incidents", state: StepState) {
  const li = loadingEl.querySelector<HTMLElement>(`[data-step="${step}"]`);
  if (!li) return;
  li.dataset.state = state;
  (li.querySelector(".step__state") as HTMLElement).textContent = STEP_TEXT[state];
}

// Let people know it's still working if the portal is slow.
const slowTimer = window.setTimeout(() => {
  loadingSlowEl.hidden = false;
}, 6_000);

function hideLoading() {
  if (loadingEl.hidden) return;
  window.clearTimeout(slowTimer);
  loadingEl.classList.add("is-done");
  window.setTimeout(() => {
    loadingEl.hidden = true;
  }, 250);
}

// ---------- data loading ----------

let loading = false;
let latestAlertRequest = 0;
let lastFetch = 0;
let fitted = false;

async function load() {
  if (loading) return;
  loading = true;
  refreshBtn.disabled = true;
  if (lastFetch) checkedEl.textContent = "Refreshing…";

  // Weather alerts load on their own. They never hold up the loading screen, and an
  // older, slower response can't overwrite a newer one.
  const alertRequest = ++latestAlertRequest;
  void fetchWeatherAlerts().then(
    (list) => {
      if (alertRequest === latestAlertRequest) alertsUI.setAlerts(list);
    },
    (reason: unknown) => {
      console.error("Weather alerts failed", reason);
      if (alertRequest === latestAlertRequest) alertsUI.setFailed();
    },
  );

  const incidentsPromise = fetchActiveIncidents().then(
    (value) => ({ ok: true as const, value }),
    (reason: unknown) => ({ ok: false as const, reason }),
  );
  void incidentsPromise.then((r) => setStep("incidents", r.ok ? "done" : "failed"));

  const sensorsPromise = Promise.allSettled(SENSORS.map((s) => fetchLatestReading(Number(s.id))));
  void sensorsPromise.then((rs) => {
    const failed = rs.filter((r) => r.status === "rejected").length;
    setStep("sensors", failed === 0 ? "done" : failed === rs.length ? "failed" : "partial");
  });
  const results = await sensorsPromise;
  results.forEach((result, i) => {
    const state = states[i];
    state.loaded = true;
    if (result.status === "fulfilled") {
      if (result.value) {
        state.reading = result.value;
        state.error = null;
      } else {
        state.error = "No readings found for this sensor.";
      }
    } else {
      console.error(`Sensor ${state.config.id} failed`, result.reason);
      state.error = "Couldn't reach the open data portal.";
    }
  });

  const incidentResult = await incidentsPromise;
  incidentsLoaded = true;
  if (incidentResult.ok) {
    incidents = incidentResult.value;
    incidentsError = false;
  } else {
    console.error("Traffic incidents failed", incidentResult.reason);
    incidentsError = true; // keep showing the last incidents that loaded, if any
  }
  syncIncidentMarkers();

  lastFetch = Date.now();
  checkedEl.textContent = `Checked ${displayTime.format(new Date(lastFetch))}. Refreshes every ${SETTINGS.refreshMinutes} minutes.`;
  renderAll();

  if (!fitted) fitted = fitToVisible();

  // Refresh the camera view for whichever sensor is open.
  const open = states.find((s) => s.config.id === selectedId);
  if (open) loadCamera(open);

  loading = false;
  refreshBtn.disabled = false;
  hideLoading();
}

refreshBtn.addEventListener("click", () => void load());

const refreshMs = SETTINGS.refreshMinutes * 60_000;
setInterval(() => {
  if (!document.hidden) void load();
}, refreshMs);
// Keep "updated x min ago" and the outdated flag current between fetches.
setInterval(renderAll, 30_000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastFetch > refreshMs) void load();
});

renderAll();
void load();
