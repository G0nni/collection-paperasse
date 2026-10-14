// Colle entre le DOM et la logique pure de src/lib. Ce module lit l'état (le lien, le
// formulaire), appelle la logique, affiche. Tout texte venant du lien est écrit en textContent ;
// aucune donnée utilisateur ne finit dans un href, un src ou un style (CLAUDE.md, Sécurité).
import {
  canRemove,
  checkRow,
  nextSuggestion,
  rowsFrom,
  suggestedRate,
  validParticipants,
  type DraftRow,
  type RowCheck,
} from "../lib/drafts";
import {
  formatClock,
  formatCount,
  formatDate,
  formatEuros,
  formatHourly,
  formatTime,
  ghostDigits,
  ledAmount,
  spokenSummary,
} from "../lib/format";
import { buildQuery, fitsInLink, parseLink, parseTitle, type Notice } from "../lib/link";
import {
  LIMITS,
  TARIFF_CODES,
  screenOf,
  type Meeting,
  type Participant,
  type Screen,
} from "../lib/meeting";
import { TEXT, noticeText, rateText, removeContext, rowLegend } from "../lib/messages";
import {
  costCents,
  elapsed,
  endFor,
  hourlyCents,
  mailVerdict,
  rateSum,
  receiptLines,
} from "../lib/meter";
import { everySecond, summaryDue } from "../lib/ticker";
import { parseEnum } from "@paperasse/shared/url";

// ---------------------------------------------------------------------------------------------
// Éléments
// ---------------------------------------------------------------------------------------------

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Élément #${id} introuvable.`);
  return element;
}

function slot<T extends HTMLElement>(root: ParentNode, name: string, type: new () => T): T {
  const element = root.querySelector(`[data-slot="${name}"]`);
  if (!(element instanceof type)) throw new Error(`Emplacement ${name} introuvable.`);
  return element;
}

const view = {
  app: byId("app", HTMLElement),
  subtitle: byId("subtitle", HTMLElement),
  copyMeter: byId("copy-meter", HTMLButtonElement),
  copyTicket: byId("copy-ticket", HTMLButtonElement),
  finish: byId("finish", HTMLButtonElement),
  newMeeting: byId("new-meeting", HTMLButtonElement),
  copyStatus: byId("copy-status", HTMLElement),
  copyFallback: byId("copy-fallback", HTMLElement),
  copyField: byId("copy-field", HTMLInputElement),
  notices: byId("notices", HTMLUListElement),
  board: byId("board", HTMLElement),
  timer: byId("timer", HTMLElement),
  amount: byId("amount", HTMLElement),
  alerts: byId("alerts", HTMLUListElement),
  clock: byId("clock", HTMLElement),
  count: byId("count", HTMLElement),
  hourly: byId("hourly", HTMLElement),
  form: byId("controls", HTMLFormElement),
  setupHeading: byId("setup-heading", HTMLElement),
  title: byId("title", HTMLInputElement),
  titleError: byId("title-error", HTMLElement),
  people: byId("people", HTMLOListElement),
  addPerson: byId("add-person", HTMLButtonElement),
  peopleFull: byId("people-full", HTMLElement),
  hourlyPreview: byId("hourly-preview", HTMLElement),
  formError: byId("form-error", HTMLElement),
  receipt: byId("receipt", HTMLElement),
  receiptTitle: byId("receipt-title", HTMLElement),
  receiptWhen: byId("receipt-when", HTMLElement),
  receiptDuration: byId("receipt-duration", HTMLElement),
  receiptPeople: byId("receipt-people", HTMLElement),
  receiptLines: byId("receipt-lines", HTMLElement),
  receiptTotal: byId("receipt-total", HTMLElement),
  receiptMail: byId("receipt-mail", HTMLElement),
  template: byId("person-template", HTMLTemplateElement),
};

const tariffInputs = [...view.form.querySelectorAll('input[name="tariff"]')].filter(
  (input) => input instanceof HTMLInputElement,
);

// ---------------------------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------------------------

/** La réunion affichée. Hors Configuration, c'est exactement ce que dit le lien. */
let meeting: Meeting;
/** Lignes du formulaire, telles que tapées (seules les valides entrent dans `meeting`). */
let rows: DraftRow[] = [];
let nextRowId = 1;
/** Messages issus de la lecture du lien, affichés jusqu'au prochain changement d'écran. */
let linkNotices: readonly Notice[] = [];
let stopTicker: (() => void) | null = null;
let lastSummaryAt: number | null = null;
let shownAlerts = "";

const now = () => Date.now();

// ---------------------------------------------------------------------------------------------
// Lien
// ---------------------------------------------------------------------------------------------

function urlFor(next: Meeting): string {
  return `${import.meta.env.BASE_URL}${buildQuery(next)}`;
}

/** Remplace l'URL sans créer d'entrée d'historique (CA-2, CA-5, CA-6). */
function commit(next: Meeting): void {
  meeting = next;
  history.replaceState(null, "", urlFor(next));
}

function loadFromLocation(): void {
  const parsed = parseLink(location.search, now());
  meeting = parsed.meeting;
  linkNotices = parsed.notices;
  rows = rowsFrom(meeting.participants, 1);
  nextRowId = rows.length + 1;
  render();
}

// ---------------------------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------------------------

function fillList(list: HTMLElement, texts: readonly string[]): void {
  list.replaceChildren(
    ...texts.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
  );
}

function receiptLine(label: string, value: string): HTMLDivElement {
  const line = document.createElement("div");
  line.className = "receipt-line";
  const term = document.createElement("dt");
  term.textContent = label;
  const amount = document.createElement("dd");
  amount.textContent = value;
  line.append(term, amount);
  return line;
}

function render(): void {
  const screen = screenOf(meeting);
  view.app.dataset["screen"] = screen;
  showFor(screen);
  view.subtitle.textContent = meeting.title === "" ? TEXT.tagline : meeting.title;
  fillList(view.notices, linkNotices.map(noticeText));
  clearCopyFeedback();
  view.formError.textContent = "";
  view.titleError.textContent = "";
  view.title.removeAttribute("aria-invalid");
  view.title.value = meeting.title;
  for (const input of tariffInputs) input.checked = input.value === meeting.tariff;
  renderRows();
  renderReceiptFrame();

  stopTicker?.();
  stopTicker = null;
  if (screen === "meter") {
    stopTicker = everySecond(() => tick(), now, {
      set: (callback, delay) => window.setTimeout(callback, delay),
      clear: (handle) => window.clearTimeout(handle),
    });
  }
  lastSummaryAt = null;
  shownAlerts = "";
  tick();
}

function showFor(screen: Screen): void {
  view.board.hidden = screen === "setup";
  view.receipt.hidden = screen === "setup";
  view.copyMeter.hidden = screen !== "meter";
  view.finish.hidden = screen !== "meter";
  view.copyTicket.hidden = screen !== "ticket";
  view.newMeeting.hidden = screen !== "ticket";
}

/** Recalcule tout depuis l'heure (CL-9) : appelé chaque seconde et à chaque changement. */
function tick(): void {
  const at = now();
  const { seconds, capped } = elapsed(meeting, at);
  const cents = costCents(seconds, meeting.participants, meeting.tariff);
  const amount = ledAmount(cents);

  view.amount.textContent = amount;
  view.amount.dataset["ghost"] = ghostDigits(amount);
  view.timer.style.setProperty("--digits", String(amount.length));
  view.clock.textContent = formatClock(seconds);
  view.count.textContent = formatCount(meeting.participants.length);
  view.hourly.textContent = formatHourly(hourlyCents(meeting.participants, meeting.tariff));
  view.hourlyPreview.textContent = formatHourly(hourlyCents(meeting.participants, meeting.tariff));

  const alerts = [];
  if (rateSum(meeting.participants) === 0) alerts.push(TEXT.volunteer);
  if (capped) alerts.push(TEXT.capped);
  const alertsKey = alerts.join("\n");
  if (alertsKey !== shownAlerts) {
    fillList(view.alerts, alerts);
    shownAlerts = alertsKey;
  }

  updateReceipt(cents, seconds);

  // Résumé accessible : au plus toutes les 30 s (CA-8), le premier tout de suite.
  if (summaryDue(lastSummaryAt, at)) {
    view.timer.setAttribute("aria-label", spokenSummary(cents, seconds));
    lastSummaryAt = at;
  }
}

/** Parties du ticket qui ne changent qu'avec la réunion (pas à chaque seconde). */
function renderReceiptFrame(): void {
  view.receiptTitle.hidden = meeting.title === "";
  view.receiptTitle.textContent = meeting.title;
  view.receiptWhen.textContent = whenText(meeting);
  view.receiptMail.textContent = mailVerdict(meeting.tariff);
  view.receiptPeople.replaceChildren(
    ...meeting.participants.map((person) => receiptLine(person.label, rateText(person.rate))),
  );
}

function whenText(current: Meeting): string {
  if (current.start === null) return "";
  const startDate = formatDate(current.start);
  const startText = `${startDate} · ${formatTime(current.start)}`;
  if (current.end === null) return `${startText} – ${TEXT.receiptRunning}`;
  const endDate = formatDate(current.end);
  const endTime = formatTime(current.end);
  return `${startText} – ${endDate === startDate ? endTime : `${endDate} ${endTime}`}`;
}

function updateReceipt(cents: number, seconds: number): void {
  view.receiptLines.replaceChildren(
    ...receiptLines(meeting.participants.length, cents).map((line) =>
      receiptLine(line.label, formatEuros(line.cents)),
    ),
  );
  view.receiptTotal.textContent = formatEuros(cents);
  view.receiptDuration.textContent = formatClock(seconds);
}

// ---------------------------------------------------------------------------------------------
// Lignes participant
// ---------------------------------------------------------------------------------------------

function renderRows(): void {
  const items = rows.map((row, index) => buildRow(row, index + 1));
  view.people.replaceChildren(...items);
  refreshRows();
}

function buildRow(row: DraftRow, position: number): HTMLLIElement {
  const fragment = view.template.content.cloneNode(true);
  if (!(fragment instanceof DocumentFragment)) throw new Error("Modèle de ligne invalide.");
  const item = fragment.querySelector("li");
  if (item === null) throw new Error("Modèle de ligne invalide.");
  item.dataset["rowId"] = String(row.id);

  const who = slot(item, "who", HTMLInputElement);
  const rate = slot(item, "rate", HTMLInputElement);
  const error = slot(item, "error", HTMLElement);
  who.id = `who-${row.id}`;
  rate.id = `rate-${row.id}`;
  error.id = `error-${row.id}`;
  slot(item, "who-label", HTMLLabelElement).htmlFor = who.id;
  slot(item, "rate-label", HTMLLabelElement).htmlFor = rate.id;
  who.setAttribute("aria-describedby", error.id);
  rate.setAttribute("aria-describedby", error.id);
  who.value = row.label;
  rate.value = row.rate;
  slot(item, "legend", HTMLElement).textContent = rowLegend(position);
  slot(item, "remove-context", HTMLElement).textContent = ` ${removeContext(position)}`;
  return item;
}

/** Erreurs, boutons Retirer/Ajouter : tout ce qui dépend de la validité des lignes. */
function refreshRows(): RowCheck[] {
  const checks = rows.map(checkRow);
  const items = [...view.people.children];
  checks.forEach((check, index) => {
    const item = items[index];
    if (item === undefined) return;
    const who = slot(item, "who", HTMLInputElement);
    const rate = slot(item, "rate", HTMLInputElement);
    setInvalid(who, check.labelError);
    setInvalid(rate, check.rateError);
    const messages = [];
    if (check.labelError) messages.push(TEXT.labelError);
    if (check.rateError) messages.push(TEXT.rateError);
    slot(item, "error", HTMLElement).textContent = messages.join(" ");
    slot(item, "remove", HTMLButtonElement).disabled = !canRemove(checks, index);
  });
  const full = rows.length >= LIMITS.maxParticipants;
  view.addPerson.disabled = full;
  view.peopleFull.hidden = !full;
  return checks;
}

function setInvalid(input: HTMLInputElement, invalid: boolean): void {
  if (invalid) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

function rowIndexOf(target: EventTarget | null): number {
  if (!(target instanceof Element)) return -1;
  const id = Number(target.closest("li")?.dataset["rowId"]);
  return rows.findIndex((row) => row.id === id);
}

/**
 * Applique les lignes valides à la réunion. Pendant le Compteur, l'URL suit (CA-5) et tout est
 * recalculé depuis `s`. Sans participant valide, ou si le lien deviendrait trop long, la réunion
 * (donc le lien) reste telle quelle et un message le dit.
 */
function applyRows(checks: readonly RowCheck[]): void {
  const participants: Participant[] = validParticipants(checks);
  if (participants.length === 0) {
    view.formError.textContent = TEXT.noValidPeople;
    return;
  }
  const next = { ...meeting, participants };
  if (!fitsInLink(next)) {
    view.formError.textContent = TEXT.linkTooLong;
    return;
  }
  view.formError.textContent = "";
  if (screenOf(meeting) === "meter") {
    commit(next);
    renderReceiptFrame();
  } else {
    meeting = next;
  }
  tick();
}

view.people.addEventListener("input", (event) => {
  const index = rowIndexOf(event.target);
  const row = rows[index];
  if (row === undefined || !(event.target instanceof HTMLInputElement)) return;
  const field = event.target.dataset["slot"];
  const item = view.people.children[index];
  if (field === "who") {
    let rate = row.rate;
    // Une suggestion choisie pré-remplit le taux, si le champ taux est vide (spec, ROLES).
    const suggested = suggestedRate(event.target.value);
    if (rate.trim() === "" && suggested !== null && item !== undefined) {
      rate = String(suggested);
      slot(item, "rate", HTMLInputElement).value = rate;
    }
    rows[index] = { ...row, label: event.target.value, rate };
  } else if (field === "rate") {
    rows[index] = { ...row, rate: event.target.value };
  }
  applyRows(refreshRows());
});

view.people.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("button");
  if (button === null || button.dataset["slot"] !== "remove") return;
  const index = rowIndexOf(button);
  if (index === -1) return;
  rows = rows.filter((_, position) => position !== index);
  renderRows();
  applyRows(refreshRows());
  // Le focus va au bouton Retirer qui prend la place, sinon au bouton d'ajout.
  const next = view.people.children[Math.min(index, rows.length - 1)];
  const nextRemove = next === undefined ? null : slot(next, "remove", HTMLButtonElement);
  (nextRemove !== null && !nextRemove.disabled ? nextRemove : view.addPerson).focus();
});

view.addPerson.addEventListener("click", () => {
  if (rows.length >= LIMITS.maxParticipants) return;
  const suggestion = nextSuggestion(rows.map((row) => row.label));
  const candidate = [
    ...rows,
    { id: nextRowId, label: suggestion.label, rate: String(suggestion.rate) },
  ];
  const participants = validParticipants(candidate.map(checkRow));
  if (!fitsInLink({ ...meeting, participants })) {
    view.formError.textContent = TEXT.linkTooLong;
    return;
  }
  nextRowId += 1;
  rows = candidate;
  renderRows();
  applyRows(refreshRows());
  const added = view.people.lastElementChild;
  if (added !== null) slot(added, "who", HTMLInputElement).focus();
});

// ---------------------------------------------------------------------------------------------
// Tarif, lancement, fin
// ---------------------------------------------------------------------------------------------

view.form.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLInputElement) || event.target.name !== "tariff") return;
  const tariff = parseEnum(event.target.value, TARIFF_CODES);
  if (tariff === null) return;
  const next = { ...meeting, tariff };
  // Tarif rétroactif (CA-5) : l'URL change et tout est recalculé depuis `s`.
  if (screenOf(meeting) === "meter") {
    commit(next);
    renderReceiptFrame();
  } else {
    meeting = next;
  }
  tick();
});

view.form.addEventListener("submit", (event) => {
  event.preventDefault();
  // Entrée dans un champ pendant le Compteur soumet aussi ce formulaire : sans effet.
  if (screenOf(meeting) === "setup") launch();
});

function launch(): void {
  const checks = refreshRows();
  const title = parseTitle(view.title.value);
  view.titleError.textContent = title === null ? TEXT.titleError : "";
  setInvalid(view.title, title === null);
  const firstInvalid = view.people.querySelector('[aria-invalid="true"]');
  if (title === null) {
    view.title.focus();
    return;
  }
  if (firstInvalid instanceof HTMLInputElement) {
    view.formError.textContent = TEXT.fixRows;
    firstInvalid.focus();
    return;
  }
  const participants = validParticipants(checks);
  if (participants.length === 0) {
    view.formError.textContent = TEXT.noValidPeople;
    return;
  }
  const next: Meeting = {
    ...meeting,
    participants,
    title,
    start: Math.floor(now() / 1000),
    end: null,
  };
  if (!fitsInLink(next)) {
    view.formError.textContent = TEXT.linkTooLong;
    return;
  }
  // CA-2 : s = maintenant, via history.replaceState.
  commit(next);
  linkNotices = [];
  render();
  view.finish.focus();
}

view.finish.addEventListener("click", () => {
  if (meeting.start === null) return;
  // CA-6 : e = maintenant (toujours dans ]s, s + 24 h] pour rester un lien valide).
  commit({ ...meeting, end: endFor(meeting.start, now()) });
  linkNotices = [];
  render();
  view.copyTicket.focus();
});

view.newMeeting.addEventListener("click", () => {
  // Même équipe, nouvelle réunion. Nouvelle entrée d'historique : « Précédent » rend le ticket.
  meeting = { ...meeting, start: null, end: null };
  history.pushState(null, "", urlFor(meeting));
  linkNotices = [];
  render();
  view.setupHeading.focus();
});

window.addEventListener("popstate", loadFromLocation);

// CL-9 : au retour sur l'onglet, le montant est juste tout de suite (calcul depuis l'heure).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && screenOf(meeting) === "meter") tick();
});

// ---------------------------------------------------------------------------------------------
// Copie du lien (CA-7)
// ---------------------------------------------------------------------------------------------

function clearCopyFeedback(): void {
  view.copyStatus.textContent = "";
  view.copyFallback.hidden = true;
  view.copyField.value = "";
}

async function copyLink(): Promise<void> {
  const link = location.href;
  view.copyFallback.hidden = true;
  try {
    // Absent hors contexte sécurisé : traité comme un refus.
    if (typeof navigator.clipboard?.writeText !== "function")
      throw new Error("Presse-papiers absent");
    await navigator.clipboard.writeText(link);
    view.copyStatus.textContent = TEXT.copied;
  } catch {
    view.copyField.value = link;
    view.copyFallback.hidden = false;
    view.copyStatus.textContent = TEXT.copyRefused;
    view.copyField.focus();
    view.copyField.select();
  }
}

view.copyMeter.addEventListener("click", () => void copyLink());
view.copyTicket.addEventListener("click", () => void copyLink());

loadFromLocation();
