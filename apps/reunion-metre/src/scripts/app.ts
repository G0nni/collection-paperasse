// Colle entre le DOM et la logique pure de src/lib. Ce module lit l'état (le lien, le
// formulaire), appelle la logique, affiche. Tout texte venant du lien est écrit en textContent ;
// aucune donnée utilisateur ne finit dans un href, un src ou un style (CLAUDE.md, Sécurité).
import {
  canRemove,
  checkRow,
  nextSuggestion,
  proposeMeeting,
  rowsFrom,
  suggestedRate,
  type DraftRow,
  type Proposal,
  type ProposalError,
  type RowCheck,
} from "../lib/drafts";
import {
  formatClock,
  formatCount,
  formatEuros,
  ghostDigits,
  ledAmount,
  ledHourly,
  receiptWhen,
  spokenSummary,
} from "../lib/format";
import { buildQuery, parseLink, parseTitle, type Notice } from "../lib/link";
import { LIMITS, TARIFF_CODES, screenOf, type Meeting, type Screen } from "../lib/meeting";
import {
  TEXT,
  noticeText,
  proposalErrorText,
  rateText,
  removeContext,
  rowLegend,
} from "../lib/messages";
import {
  costCents,
  elapsed,
  endFor,
  hourlyCents,
  mailVerdict,
  rateSum,
  receiptLines,
} from "../lib/meter";
import { createCopier } from "@paperasse/shared/copy";
import { byId, fillList, setText, slot } from "@paperasse/shared/dom";
import { everySecond, summaryDue } from "@paperasse/shared/ticker";
import { parseEnum } from "@paperasse/shared/url";

// ---------------------------------------------------------------------------------------------
// Éléments
// ---------------------------------------------------------------------------------------------

const view = {
  app: byId("app", HTMLElement),
  subtitle: byId("subtitle", HTMLElement),
  copyMeter: byId("copy-meter", HTMLButtonElement),
  copyTicket: byId("copy-ticket", HTMLButtonElement),
  finish: byId("finish", HTMLButtonElement),
  newMeeting: byId("new-meeting", HTMLButtonElement),
  notices: byId("notices", HTMLUListElement),
  dismissNotices: byId("dismiss-notices", HTMLButtonElement),
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

const copier = createCopier(
  {
    status: byId("copy-status", HTMLElement),
    dialog: byId("copy-dialog", HTMLDialogElement),
    field: byId("copy-field", HTMLInputElement),
  },
  TEXT.copied,
);

const tariffInputs = [...view.form.querySelectorAll('input[name="tariff"]')].filter(
  (input) => input instanceof HTMLInputElement,
);

// ---------------------------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------------------------

/** La réunion affichée : toujours exactement ce que dit l'URL. */
let meeting: Meeting;
/** Lignes du formulaire, telles que tapées (seules les valides entrent dans `meeting`). */
let rows: DraftRow[] = [];
let nextRowId = 1;
/** Titre tel que tapé en Configuration (validé au lancement, comme les lignes). */
let titleDraft = "";
/** Messages issus de la lecture du lien, affichés jusqu'au changement d'écran ou « Fermer ». */
let linkNotices: readonly Notice[] = [];
let stopTicker: (() => void) | null = null;
let lastSummaryAt: number | null = null;
let shownAlerts = "";
/** Montants des lignes facturées du ticket : créés avec la réunion, mis à jour chaque seconde. */
let receiptAmounts: HTMLElement[] = [];
/** CL-6 : ne dépend que des participants, calculé quand la réunion change. */
let volunteer = false;

const now = () => Date.now();

// ---------------------------------------------------------------------------------------------
// Lien
// ---------------------------------------------------------------------------------------------

function urlFor(query: string): string {
  return `${import.meta.env.BASE_URL}${query}`;
}

/** Réécrit l'URL sans créer d'entrée d'historique (CA-2, CA-5, CA-6, Configuration). */
function replaceUrl(next: Meeting): void {
  history.replaceState(null, "", urlFor(buildQuery(next)));
}

function loadFromLocation(): void {
  const parsed = parseLink(location.search, now());
  meeting = parsed.meeting;
  linkNotices = parsed.notices;
  // Forme propre du lien (spec, « Écrans ») : c'est elle que « Copier le lien » copiera. Un lien
  // d'une version inconnue (`query` nulle) reste tel quel : il ne doit pas être perdu.
  if (parsed.query !== null) history.replaceState(null, "", urlFor(parsed.query));
  resetRows();
  render();
}

/**
 * Changement d'écran voulu par l'utilisateur (Lancer, Terminer, Nouvelle réunion) : l'URL suit,
 * les messages du lien s'effacent (spec, « Écrans »), tout est redessiné, puis le focus va à
 * l'action suivante. `push` crée une entrée d'historique (« Précédent » rend l'écran quitté).
 */
function goTo(next: Meeting, options: { push: boolean; focus: HTMLElement }): void {
  meeting = next;
  const url = urlFor(buildQuery(next));
  if (options.push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
  linkNotices = [];
  resetRows();
  render();
  options.focus.focus();
}

/**
 * Applique une modification de la réunion. L'URL suit (CA-5 pendant le Compteur, et la
 * Configuration aussi) et tout est recalculé depuis `s`.
 */
function updateMeeting(next: Meeting): void {
  // « Lien copié » ne vaut plus dès que le lien change : le presse-papiers contient l'ancien.
  if (buildQuery(next) !== buildQuery(meeting)) copier.clearStatus();
  meeting = next;
  replaceUrl(next);
  renderMeetingFacts();
  tick();
}

/** Dit pourquoi une modification n'entre pas dans le lien, ou efface le message (`null`). */
function showProposalError(error: ProposalError | null): void {
  setText(view.formError, error === null ? "" : proposalErrorText(error));
}

/** Met la réunion proposée par le formulaire, ou dit pourquoi elle ne passe pas. */
function applyProposal(proposal: Proposal): void {
  if (!proposal.ok) {
    showProposalError(proposal.error);
    return;
  }
  showProposalError(null);
  updateMeeting(proposal.meeting);
}

/** Relit le brouillon (titre en Configuration, lignes) et l'applique si possible. */
function applyForm(): void {
  const title =
    screenOf(meeting) === "setup" ? (parseTitle(titleDraft) ?? meeting.title) : meeting.title;
  applyProposal(proposeMeeting({ ...meeting, title }, rows));
}

// ---------------------------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------------------------

/** Changement d'écran (ou de réunion entière) : tout est redessiné. */
function render(): void {
  const screen = screenOf(meeting);
  view.app.dataset["screen"] = screen;
  showFor(screen);
  view.subtitle.textContent = meeting.title === "" ? TEXT.tagline : meeting.title;
  renderNotices();
  copier.clear();
  showProposalError(null);
  showTitleError(false);
  titleDraft = meeting.title;
  view.title.value = meeting.title;
  for (const input of tariffInputs) input.checked = input.value === meeting.tariff;
  renderRows();
  renderMeetingFacts();

  stopTicker?.();
  stopTicker = null;
  if (screen === "meter") {
    stopTicker = everySecond(tick, now, {
      set: (callback, delay) => window.setTimeout(callback, delay),
      clear: (handle) => window.clearTimeout(handle),
    });
  }
  lastSummaryAt = null;
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

function renderNotices(): void {
  fillList(view.notices, linkNotices.map(noticeText));
  view.dismissNotices.hidden = linkNotices.length === 0;
}

function receiptLine(label: string, value: string): { line: HTMLDivElement; amount: HTMLElement } {
  const line = document.createElement("div");
  line.className = "receipt-line";
  const term = document.createElement("dt");
  term.textContent = label;
  const amount = document.createElement("dd");
  amount.textContent = value;
  line.append(term, amount);
  return { line, amount };
}

/** Tout ce qui ne dépend que de la réunion, pas de l'heure : redessiné quand elle change. */
function renderMeetingFacts(): void {
  const hourly = ledHourly(hourlyCents(meeting.participants, meeting.tariff));
  setText(view.count, formatCount(meeting.participants.length));
  setText(view.hourly, hourly);
  setText(view.hourlyPreview, hourly);
  volunteer = rateSum(meeting.participants) === 0;

  view.receiptTitle.hidden = meeting.title === "";
  setText(view.receiptTitle, meeting.title);
  setText(view.receiptWhen, receiptWhen(meeting));
  setText(view.receiptMail, mailVerdict(meeting.tariff));
  view.receiptPeople.replaceChildren(
    ...meeting.participants.map((person) => receiptLine(person.label, rateText(person.rate)).line),
  );
  // Les lignes facturées sont construites ici, une fois : chaque seconde, tick() ne change que
  // leurs montants (un lecteur d'écran garde sa position dans le ticket).
  const lines = receiptLines(meeting.participants.length, 0).map((line) =>
    receiptLine(line.label, ""),
  );
  view.receiptLines.replaceChildren(...lines.map((line) => line.line));
  receiptAmounts = lines.map((line) => line.amount);
}

/** Recalcule ce qui dépend de l'heure (CL-9) : appelé chaque seconde et à chaque changement. */
function tick(): void {
  const at = now();
  const { seconds, capped } = elapsed(meeting, at);
  const cents = costCents(seconds, meeting.participants, meeting.tariff);
  const amount = ledAmount(cents);

  setText(view.amount, amount);
  view.amount.dataset["ghost"] = ghostDigits(amount);
  view.timer.style.setProperty("--digits", String(amount.length));
  setText(view.clock, formatClock(seconds));
  renderAlerts(capped);

  receiptLines(meeting.participants.length, cents).forEach((line, index) => {
    const cell = receiptAmounts[index];
    if (cell !== undefined) setText(cell, formatEuros(line.cents));
  });
  setText(view.receiptTotal, formatEuros(cents));
  setText(view.receiptDuration, formatClock(seconds));

  // Résumé accessible : au plus toutes les 30 s (CA-8), le premier tout de suite.
  if (summaryDue(lastSummaryAt, at)) {
    view.timer.setAttribute("aria-label", spokenSummary(cents, seconds));
    lastSummaryAt = at;
  }
}

/** CL-6 et CL-2, réécrits seulement s'ils changent (la région live n'annonce que du neuf). */
function renderAlerts(capped: boolean): void {
  const alerts = [];
  if (volunteer) alerts.push(TEXT.volunteer);
  if (capped) alerts.push(TEXT.capped);
  const key = alerts.join("\n");
  if (key === shownAlerts) return;
  fillList(view.alerts, alerts);
  shownAlerts = key;
}

// ---------------------------------------------------------------------------------------------
// Lignes participant
// ---------------------------------------------------------------------------------------------

function resetRows(): void {
  rows = rowsFrom(meeting.participants);
  nextRowId = rows.length + 1;
}

function renderRows(): void {
  view.people.replaceChildren(...rows.map((row, index) => buildRow(row, index + 1)));
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
function refreshRows(checks: readonly RowCheck[] = rows.map(checkRow)): void {
  const items = [...view.people.children];
  checks.forEach((check, index) => {
    const item = items[index];
    if (item === undefined) return;
    setInvalid(slot(item, "who", HTMLInputElement), check.labelError);
    setInvalid(slot(item, "rate", HTMLInputElement), check.rateError);
    const messages = [];
    if (check.labelError) messages.push(TEXT.labelError);
    if (check.rateError) messages.push(TEXT.rateError);
    setText(slot(item, "error", HTMLElement), messages.join(" "));
    slot(item, "remove", HTMLButtonElement).disabled = !canRemove(checks, index);
  });
  const full = rows.length >= LIMITS.maxParticipants;
  view.addPerson.disabled = full;
  view.peopleFull.hidden = !full;
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
  refreshRows();
  applyForm();
});

view.people.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("button");
  if (button === null || button.dataset["slot"] !== "remove") return;
  const index = rowIndexOf(button);
  if (index === -1) return;
  rows = rows.filter((_, position) => position !== index);
  renderRows();
  applyForm();
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
  // La ligne n'est ajoutée que si le lien qui en résulte reste valide (CL-8).
  const proposal = proposeMeeting(meeting, candidate);
  if (!proposal.ok) {
    showProposalError(proposal.error);
    return;
  }
  nextRowId += 1;
  rows = candidate;
  renderRows();
  applyProposal(proposal);
  const added = view.people.lastElementChild;
  if (added !== null) slot(added, "who", HTMLInputElement).focus();
});

// ---------------------------------------------------------------------------------------------
// Titre, tarif, lancement, fin
// ---------------------------------------------------------------------------------------------

function showTitleError(invalid: boolean): void {
  setText(view.titleError, invalid ? TEXT.titleError : "");
  setInvalid(view.title, invalid);
}

// Pas de maxlength (il compte en UTF-16) : la longueur est vérifiée en points de code, à la
// frappe, avec les mêmes règles que `n` dans le lien.
view.title.addEventListener("input", () => {
  titleDraft = view.title.value;
  showTitleError(parseTitle(titleDraft) === null);
  applyForm();
});

view.form.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLInputElement) || event.target.name !== "tariff") return;
  const tariff = parseEnum(event.target.value, TARIFF_CODES);
  // Tarif rétroactif (CA-5) : l'URL change et tout est recalculé depuis `s`.
  if (tariff !== null) updateMeeting({ ...meeting, tariff });
});

view.form.addEventListener("submit", (event) => {
  event.preventDefault();
  // Entrée dans un champ pendant le Compteur soumet aussi ce formulaire : sans effet.
  if (screenOf(meeting) === "setup") launch();
});

function launch(): void {
  // Tout est vérifié sur le brouillon avant d'afficher quoi que ce soit.
  const title = parseTitle(titleDraft);
  const checks = rows.map(checkRow);
  const invalidIndex = checks.findIndex((check) => check.participant === null);
  // CA-2 : s = maintenant. Ne sert que si le titre et toutes les lignes sont valides.
  const start = Math.floor(now() / 1000);
  const proposal = proposeMeeting({ ...meeting, title: title ?? "", start, end: null }, rows);

  showTitleError(title === null);
  refreshRows(checks);
  if (title === null) {
    view.title.focus();
    return;
  }
  const invalidItem = view.people.children[invalidIndex];
  if (invalidItem !== undefined) {
    setText(view.formError, TEXT.fixRows);
    slot(invalidItem, checks[invalidIndex]?.labelError ? "who" : "rate", HTMLInputElement).focus();
    return;
  }
  if (!proposal.ok) {
    showProposalError(proposal.error);
    return;
  }
  // CA-2 : via history.replaceState.
  goTo(proposal.meeting, { push: false, focus: view.finish });
}

view.finish.addEventListener("click", () => {
  const start = meeting.start;
  if (start === null) return;
  // CA-6 : e = maintenant, borné à [s + 1, s + 24 h] pour rester un lien valide.
  goTo({ ...meeting, start, end: endFor(start, now()) }, { push: false, focus: view.copyTicket });
});

view.newMeeting.addEventListener("click", () => {
  // Même équipe, même tarif, même titre. Nouvelle entrée d'historique : « Précédent » rend le
  // ticket ; ensuite, chaque modification de la Configuration réécrit cette entrée.
  goTo({ ...meeting, start: null, end: null }, { push: true, focus: view.setupHeading });
});

view.dismissNotices.addEventListener("click", () => {
  linkNotices = [];
  renderNotices();
  // Le bouton disparaît : le focus va à l'action principale de l'écran.
  const screen = screenOf(meeting);
  if (screen === "meter") view.finish.focus();
  else if (screen === "ticket") view.copyTicket.focus();
  else view.setupHeading.focus();
});

window.addEventListener("popstate", loadFromLocation);

// CL-9 : au retour sur l'onglet, le montant est juste tout de suite (calcul depuis l'heure).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && screenOf(meeting) === "meter") tick();
});

// CA-7
for (const button of [view.copyMeter, view.copyTicket]) {
  button.addEventListener("click", () => void copier.copy(location.href, button));
}

loadFromLocation();
