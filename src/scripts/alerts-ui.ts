import { SETTINGS } from "../config/sensors";
import { describeAlertWindow, type WeatherAlert } from "../lib/alerts";

export interface AlertsUI {
  setAlerts(alerts: WeatherAlert[]): void;
  /** The last lookup failed. Alerts already on screen stay, plus a notice. */
  setFailed(): void;
  render(now?: Date): void;
}

const NWS_OFFICE_URL = "https://www.weather.gov/ewx/";

/** NWS text hard-wraps lines; blank lines separate paragraphs. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createAlertsUI(root: HTMLElement): AlertsUI {
  let alerts: WeatherAlert[] = [];
  let failed = false;
  let showAll = false;
  const open = new Set<string>();
  let lastSignature = "";
  let nextId = 0;

  function render(now: Date = new Date()) {
    const active = alerts.filter((a) => !a.end || a.end.getTime() > now.getTime());
    const shown = showAll ? active : active.slice(0, SETTINGS.maxAlertsShown);
    const extra = active.length - shown.length;
    // Non-breaking spaces keep "9 PM Friday" together if the banner wraps on a narrow screen.
    const keepTogether = (t: string) => t.replace(/(\d{1,2}(?::\d{2})?) (AM|PM) ([A-Z][a-z]+)/g, "$1\u00A0$2\u00A0$3");
    const items = shown.map((alert) => ({
      alert,
      text: keepTogether(describeAlertWindow(alert, now, SETTINGS.displayTimeZone)),
    }));

    // Skip rebuilding when nothing visible changed, so focus and scroll position survive the 30 s tick.
    const signature = JSON.stringify([items.map((i) => [i.alert.id, i.text, open.has(i.alert.id)]), extra, showAll, failed]);
    if (signature === lastSignature) return;
    lastSignature = signature;

    const focusKey = root.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.key
      : undefined;

    const nodes: HTMLElement[] = [];
    for (const { alert, text } of items) {
      const isOpen = open.has(alert.id);
      const detailsId = `alert-details-${nextId++}`;

      const card = el("div", "alert");
      card.dataset.severity = alert.severity;
      card.dataset.open = String(isOpen);

      const head = el("button", "alert__head");
      head.type = "button";
      head.dataset.key = `alert:${alert.id}`;
      head.setAttribute("aria-expanded", String(isOpen));
      head.setAttribute("aria-controls", detailsId);
      const icon = el("span", "alert__icon", "\u26A0\uFE0F");
      icon.setAttribute("aria-hidden", "true");
      head.append(icon, el("span", "alert__text", text), el("span", "alert__toggle", isOpen ? "Hide details" : "Details"));
      head.addEventListener("click", () => {
        if (open.has(alert.id)) open.delete(alert.id);
        else open.add(alert.id);
        lastSignature = "";
        render();
      });

      const details = el("div", "alert__details");
      details.id = detailsId;
      details.hidden = !isOpen;
      if (alert.sender) details.append(el("p", "alert__source", `Issued by ${alert.sender}`));
      if (alert.areas) details.append(el("p", "alert__areas", `Areas: ${alert.areas}`));
      for (const para of paragraphs(alert.description)) details.append(el("p", undefined, para));
      if (alert.instruction) {
        const p = el("p", "alert__instruction");
        p.append(el("strong", undefined, "What to do: "), document.createTextNode(paragraphs(alert.instruction).join(" ")));
        details.append(p);
      }

      card.append(head, details);
      nodes.push(card);
    }

    if (extra > 0 || (showAll && active.length > SETTINGS.maxAlertsShown)) {
      const more = el(
        "button",
        "alerts__more",
        showAll ? "Show fewer alerts" : `Show ${extra} more ${extra === 1 ? "alert" : "alerts"}`,
      );
      more.type = "button";
      more.dataset.key = "alerts:more";
      more.addEventListener("click", () => {
        showAll = !showAll;
        lastSignature = "";
        render();
      });
      nodes.push(more);
    }

    if (failed) {
      const notice = el("div", "alert alert--notice");
      notice.dataset.severity = "unknown";
      const p = el("p", undefined, "Couldn't check weather alerts right now. ");
      const link = el("a", undefined, "See the National Weather Service");
      link.href = NWS_OFFICE_URL;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      p.append(link, document.createTextNode(" for current alerts."));
      notice.append(p);
      nodes.push(notice);
    }

    root.replaceChildren(...nodes);
    if (focusKey) root.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  return {
    setAlerts(next) {
      alerts = next;
      failed = false;
      render();
    },
    setFailed() {
      failed = true;
      render();
    },
    render,
  };
}
