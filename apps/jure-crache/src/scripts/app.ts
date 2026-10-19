// Colle entre le DOM et la logique pure de src/lib. Ce module lit l'état (le hash, le
// formulaire), appelle la logique, affiche. Tout texte venant du lien est écrit en textContent ;
// aucune donnée utilisateur ne finit dans un href, un src ou un style (CLAUDE.md, Sécurité).
import { createCopier } from "@paperasse/shared/copy";
import { byId, fillList, setText, slot, trapFocus } from "@paperasse/shared/dom";
import { everySecond, summaryDue } from "@paperasse/shared/ticker";
import { parseEnum } from "@paperasse/shared/url";
import { countdown, spokenCountdown, stubs } from "../lib/countdown";
import type { Deed } from "../lib/deed";
import {
  DEFAULT_ARTICLES,
  MISSING_DEADLINE,
  defaultDeadline,
  localToEpoch,
  parseLocalDateTime,
  toLocalInputValue,
  validateDraft,
  type Draft,
  type FieldError,
  type FieldName,
} from "../lib/draft";
import { formatDate, formatDateTime } from "../lib/format";
import { VERDICTS, buildHash, parseHash, type LinkState, type Verdict } from "../lib/link";
import { LIMITS } from "../lib/deed";
import {
  TEXT,
  articleLabel,
  articlePrefix,
  deadlineLine,
  fieldErrorText,
  formErrorText,
  judgedLine,
  noticeText,
  registeredLine,
  removeArticleContext,
  unreadableDetail,
  verdictLine,
} from "../lib/messages";
import { browserDigest, deedNumber, fingerprint, numberSegments, waxIndex } from "../lib/seal";
import { signaturePath } from "../lib/signature";

// ---------------------------------------------------------------------------------------------
// Éléments
// ---------------------------------------------------------------------------------------------

const view = {
  app: byId("app", HTMLElement),
  newDeed: byId("new-deed", HTMLButtonElement),
  notices: byId("notices", HTMLUListElement),
  dismissNotices: byId("dismiss-notices", HTMLButtonElement),

  draft: byId("draft", HTMLElement),
  form: byId("draft-form", HTMLFormElement),
  draftHeading: byId("draft-heading", HTMLElement),
  bettor: byId("bettor", HTMLInputElement),
  opponent: byId("opponent", HTMLInputElement),
  subject: byId("subject", HTMLTextAreaElement),
  stake: byId("stake", HTMLTextAreaElement),
  articleRows: byId("article-rows", HTMLOListElement),
  addArticle: byId("add-article", HTMLButtonElement),
  articlesFull: byId("articles-full", HTMLElement),
  deadline: byId("deadline", HTMLInputElement),
  formError: byId("form-error", HTMLElement),
  sealDeed: byId("seal-deed", HTMLButtonElement),
  articleTemplate: byId("article-template", HTMLTemplateElement),

  deedScreen: byId("deed-screen", HTMLElement),
  unsealed: byId("unsealed", HTMLElement),
  deedNumber: byId("deed-number", HTMLElement),
  deedRegistered: byId("deed-registered", HTMLElement),
  deedBettor: byId("deed-bettor", HTMLElement),
  deedOpponent: byId("deed-opponent", HTMLElement),
  stampBettor: byId("stamp-bettor", HTMLElement),
  stampOpponent: byId("stamp-opponent", HTMLElement),
  deedSubject: byId("deed-subject", HTMLElement),
  deedStake: byId("deed-stake", HTMLElement),
  deedArticles: byId("deed-articles", HTMLOListElement),
  noArticles: byId("no-articles", HTMLElement),
  deadlineLine: byId("deadline-line", HTMLElement),
  countdownWrap: byId("countdown-wrap", HTMLElement),
  countdown: byId("countdown", HTMLElement),
  stubValues: [
    byId("stub-days", HTMLElement),
    byId("stub-hours", HTMLElement),
    byId("stub-minutes", HTMLElement),
    byId("stub-seconds", HTMLElement),
  ],
  passed: byId("passed", HTMLElement),
  judged: byId("judged", HTMLElement),
  judgedLine: byId("judged-line", HTMLElement),
  verdictLine: byId("verdict-line", HTMLElement),
  signatureBettor: byId("signature-bettor", SVGPathElement),
  signatureOpponent: byId("signature-opponent", SVGPathElement),
  seal: byId("seal", SVGSVGElement),
  copy: byId("copy", HTMLButtonElement),
  print: byId("print", HTMLButtonElement),
  declare: byId("declare", HTMLButtonElement),

  refused: byId("refused", HTMLElement),
  refusedTitle: byId("refused-title", HTMLElement),
  refusedText: byId("refused-text", HTMLElement),
  refusedDetail: byId("refused-detail", HTMLElement),
  restart: byId("restart", HTMLButtonElement),

  verdictDialog: byId("verdict-dialog", HTMLDialogElement),
  choiceBettor: byId("choice-bettor", HTMLElement),
  choiceOpponent: byId("choice-opponent", HTMLElement),
};

// Le copieur partagé piège lui-même le focus dans son repli (CA-7).
const copier = createCopier(
  {
    status: byId("copy-status", HTMLElement),
    dialog: byId("copy-dialog", HTMLDialogElement),
    field: byId("copy-field", HTMLInputElement),
  },
  TEXT.copied,
);

// CA-5 : focus piégé dans la boîte de dialogue du verdict.
trapFocus(view.verdictDialog);

/** SHA-256 du navigateur, ou `null` hors contexte sécurisé (CL-6). */
const digest = browserDigest(globalThis.crypto);

const now = () => Date.now();

// ---------------------------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------------------------

/** Ce que dit le hash affiché : toujours exactement l'URL courante. */
let state: LinkState = { screen: "draft" };
/** Hash pour lequel l'écran a été dessiné : un hashchange vers le même hash ne redessine rien. */
let renderedHash: string | null = null;
/** Numéro de chargement : un calcul d'empreinte dépassé par un autre lien est ignoré. */
let loadToken = 0;
let stopTicker: (() => void) | null = null;
let lastSummaryAt: number | null = null;
/** Après un premier « Sceller l'acte » refusé, les erreurs suivent la frappe. */
let showLiveErrors = false;
let nextArticleId = 1;
/** Verdict qui vient d'être déclaré ici : seul lui a droit au coup de tampon animé. */
let freshVerdict = false;

// ---------------------------------------------------------------------------------------------
// Lien
// ---------------------------------------------------------------------------------------------

function urlFor(hash: string): string {
  return `${import.meta.env.BASE_URL}${hash}`;
}

/**
 * Lit le hash et dessine l'écran qui lui correspond. `focus` désigne l'élément qui reçoit le
 * focus une fois l'écran dessiné (changement d'écran voulu par l'utilisateur).
 */
async function load(focus?: () => HTMLElement): Promise<void> {
  const token = ++loadToken;
  // Posé avant le calcul d'empreinte : un hashchange vers ce même hash, reçu pendant l'attente,
  // ne relance pas un second chargement.
  renderedHash = location.hash;
  const parsed = parseHash(location.hash, now());
  let fingerprintHex: string | null = null;
  if (parsed.screen === "deed") {
    fingerprintHex = await fingerprint(parsed.deed, digest);
    // Un autre lien a été ouvert pendant le calcul : il a la main.
    if (token !== loadToken) return;
    // Forme propre (textes nettoyés, verdict inconnu retiré) : c'est elle que « Copier le
    // lien » copiera. Les liens refusés restent tels quels, pour qu'on voie ce qu'on a reçu.
    if (location.hash !== parsed.hash) history.replaceState(null, "", urlFor(parsed.hash));
    renderedHash = location.hash;
  }
  state = parsed;
  render(parsed, fingerprintHex);
  focus?.().focus();
}

function reloadIfChanged(): void {
  // CL-8 : hash modifié à la main, Précédent / Suivant.
  if (location.hash !== renderedHash) void load();
}

window.addEventListener("hashchange", reloadIfChanged);
window.addEventListener("popstate", reloadIfChanged);

// ---------------------------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------------------------

function render(parsed: LinkState, fingerprintHex: string | null): void {
  const screen = parsed.screen;
  view.app.dataset["screen"] = screen;
  view.draft.hidden = screen !== "draft";
  view.deedScreen.hidden = screen !== "deed";
  view.refused.hidden = screen !== "unreadable" && screen !== "unknown-version";
  // Rédaction : on y est déjà. Refus : l'écran a son propre « Rédiger un nouvel acte ».
  view.newDeed.hidden = screen !== "deed";

  copier.clear();
  if (view.verdictDialog.open) {
    view.verdictDialog.returnValue = "";
    view.verdictDialog.close();
  }
  stopTicker?.();
  stopTicker = null;
  lastSummaryAt = null;

  renderNotices(parsed.screen === "deed" ? parsed.notices.map(noticeText) : []);

  if (parsed.screen === "deed") {
    renderDeed(parsed.deed, parsed.verdict, fingerprintHex);
  } else if (parsed.screen === "unreadable") {
    setText(view.refusedTitle, TEXT.unreadableTitle);
    setText(view.refusedText, TEXT.unreadableText);
    setText(view.refusedDetail, unreadableDetail(parsed.reason));
  } else if (parsed.screen === "unknown-version") {
    setText(view.refusedTitle, TEXT.unknownVersionTitle);
    setText(view.refusedText, TEXT.unknownVersionText);
    setText(view.refusedDetail, "");
  }
  freshVerdict = false;
}

function renderNotices(texts: readonly string[]): void {
  fillList(view.notices, texts);
  view.dismissNotices.hidden = texts.length === 0;
}

/**
 * Écrit le numéro avec une possibilité de retour à la ligne (<wbr>) après chaque tiret : à 360 px,
 * il ne tient pas sur une ligne, et il ne doit jamais se couper au milieu d'un groupe. Les
 * morceaux sont des nœuds texte, jamais du HTML.
 */
function writeDeedNumber(element: HTMLElement, number: string): void {
  if (element.textContent === number) return;
  element.replaceChildren(
    ...numberSegments(number).flatMap((segment, index) =>
      index === 0 ? [segment] : [document.createElement("wbr"), segment],
    ),
  );
}

function renderDeed(deed: Deed, verdict: Verdict | null, fingerprintHex: string | null): void {
  writeDeedNumber(view.deedNumber, deedNumber(fingerprintHex, deed.draftedAt));
  setText(view.deedRegistered, registeredLine(formatDate(deed.draftedAt)));
  view.unsealed.hidden = fingerprintHex !== null;
  // Index de palette (0 à 3), jamais une couleur venue du lien.
  view.seal.dataset["wax"] = String(waxIndex(fingerprintHex));

  setText(view.deedBettor, deed.bettor);
  setText(view.deedOpponent, deed.opponent);
  setText(view.deedSubject, deed.subject);
  setText(view.deedStake, deed.stake);
  view.deedArticles.replaceChildren(
    ...deed.articles.map((article, index) => {
      const item = document.createElement("li");
      const prefix = document.createElement("strong");
      prefix.textContent = articlePrefix(index + 1);
      item.append(prefix, ` ${article}`);
      return item;
    }),
  );
  view.noArticles.hidden = deed.articles.length > 0;
  setText(view.deadlineLine, deadlineLine(formatDateTime(deed.deadline)));

  // Le tracé n'est fait que de nombres calculés ici (signature.ts) : jamais du nom lui-même.
  view.signatureBettor.setAttribute("d", signaturePath(deed.bettor));
  view.signatureOpponent.setAttribute("d", signaturePath(deed.opponent));

  renderVerdict(deed, verdict);
  if (verdict === null) {
    stopTicker = everySecond(
      () => tick(deed),
      // Horloge comptée depuis l'échéance : les secondes changent pile quand la seconde
      // restante change, même pour une échéance qui n'est pas une seconde ronde.
      () => now() - deed.deadline,
      {
        set: (callback, delay) => window.setTimeout(callback, delay),
        clear: (handle) => window.clearTimeout(handle),
      },
    );
    tick(deed);
  }
}

function setStamp(stamp: HTMLElement, text: string | null): void {
  stamp.hidden = text === null;
  setText(stamp, text ?? "");
  stamp.classList.toggle("just-stamped", text !== null && freshVerdict);
}

function renderVerdict(deed: Deed, verdict: Verdict | null): void {
  const judged = verdict !== null;
  const draw = verdict === "n";
  setStamp(view.stampBettor, verdict === "p" ? TEXT.winnerStamp : draw ? TEXT.drawStamp : null);
  setStamp(view.stampOpponent, verdict === "c" ? TEXT.winnerStamp : draw ? TEXT.drawStamp : null);

  view.countdownWrap.hidden = judged;
  view.judged.hidden = !judged;
  setText(view.declare, judged ? TEXT.changeVerdict : TEXT.declare);
  if (verdict !== null) {
    setText(view.passed, "");
    setText(view.judgedLine, judgedLine(formatDate(deed.deadline)));
    setText(view.verdictLine, verdictLine(verdict, deed));
  }
}

/** Compte à rebours (CA-4) : recalculé depuis l'heure à chaque seconde, jamais décrémenté. */
function tick(deed: Deed): void {
  const at = now();
  const remaining = countdown(deed.deadline, at);
  if (remaining.passed) {
    view.countdownWrap.hidden = true;
    setText(view.passed, TEXT.passed);
    stopTicker?.();
    stopTicker = null;
  } else {
    view.countdownWrap.hidden = false;
    setText(view.passed, "");
    stubs(remaining).forEach((stub, index) => {
      const cell = view.stubValues[index];
      if (cell !== undefined) setText(cell, stub.value);
    });
  }
  // Résumé accessible : au plus toutes les 30 s (CLAUDE.md), le premier tout de suite.
  if (summaryDue(lastSummaryAt, at)) {
    view.countdown.setAttribute("aria-label", spokenCountdown(remaining, TEXT.passed));
    lastSummaryAt = at;
  }
}

document.addEventListener("visibilitychange", () => {
  // Retour sur l'onglet : le compte à rebours est juste tout de suite.
  if (document.visibilityState === "visible" && state.screen === "deed" && stopTicker !== null) {
    tick(state.deed);
  }
});

// ---------------------------------------------------------------------------------------------
// Formulaire de rédaction
// ---------------------------------------------------------------------------------------------

function articleItems(): HTMLLIElement[] {
  return [...view.articleRows.children].filter((item) => item instanceof HTMLLIElement);
}

function buildArticleRow(text: string): HTMLLIElement {
  const fragment = view.articleTemplate.content.cloneNode(true);
  if (!(fragment instanceof DocumentFragment)) throw new Error("Modèle d'article invalide.");
  const item = fragment.querySelector("li");
  if (item === null) throw new Error("Modèle d'article invalide.");
  const id = nextArticleId;
  nextArticleId += 1;
  const textarea = slot(item, "text", HTMLTextAreaElement);
  const error = slot(item, "error", HTMLElement);
  textarea.id = `article-${id}`;
  error.id = `article-${id}-error`;
  textarea.setAttribute("aria-describedby", error.id);
  slot(item, "label", HTMLLabelElement).htmlFor = textarea.id;
  textarea.value = text;
  return item;
}

/** Numérote les articles (libellés, boutons) et borne l'ajout à 5. */
function refreshArticles(): void {
  articleItems().forEach((item, index) => {
    setText(slot(item, "label", HTMLElement), articleLabel(index + 1));
    setText(slot(item, "remove-context", HTMLElement), ` ${removeArticleContext(index + 1)}`);
  });
  const full = articleItems().length >= LIMITS.articlesMax;
  view.addArticle.disabled = full;
  view.articlesFull.hidden = !full;
}

/** Remet le formulaire vierge : champs vides, 3 articles par défaut (CA-10), échéance proposée. */
function resetForm(): void {
  view.form.reset();
  view.articleRows.replaceChildren(...DEFAULT_ARTICLES.map(buildArticleRow));
  refreshArticles();
  const at = now();
  view.deadline.value = toLocalInputValue(defaultDeadline(at));
  view.deadline.min = toLocalInputValue(at);
  showLiveErrors = false;
  showErrors([]);
  setText(view.formError, "");
}

function readDeadline(): Draft["deadline"] {
  const local = parseLocalDateTime(view.deadline.value);
  return local === null ? MISSING_DEADLINE : localToEpoch(local);
}

function readDraft(): Draft {
  return {
    bettor: view.bettor.value,
    opponent: view.opponent.value,
    subject: view.subject.value,
    stake: view.stake.value,
    articles: articleItems().map((item) => slot(item, "text", HTMLTextAreaElement).value),
    deadline: readDeadline(),
  };
}

type FieldControl = HTMLInputElement | HTMLTextAreaElement;

/** Champ et zone d'erreur d'une erreur du formulaire. */
function fieldOf(field: FieldName, index: number): { control: FieldControl; error: HTMLElement } {
  if (field === "article") {
    const item = articleItems()[index];
    if (item === undefined) throw new Error(`Article ${index} introuvable.`);
    return {
      control: slot(item, "text", HTMLTextAreaElement),
      error: slot(item, "error", HTMLElement),
    };
  }
  const control = {
    bettor: view.bettor,
    opponent: view.opponent,
    subject: view.subject,
    stake: view.stake,
    deadline: view.deadline,
  }[field];
  return { control, error: byId(`${field}-error`, HTMLElement) };
}

function allFields(): { control: FieldControl; error: HTMLElement }[] {
  const fixed: FieldName[] = ["bettor", "opponent", "subject", "stake", "deadline"];
  return [
    ...fixed.map((field) => fieldOf(field, 0)),
    ...articleItems().map((_, index) => fieldOf("article", index)),
  ];
}

/** Écrit les erreurs (CA-1) : message relié au champ par aria-describedby, aria-invalid. */
function showErrors(errors: readonly FieldError[]): void {
  for (const { control, error } of allFields()) {
    control.removeAttribute("aria-invalid");
    setText(error, "");
  }
  for (const fieldError of errors) {
    const { control, error } = fieldOf(fieldError.field, fieldError.index);
    control.setAttribute("aria-invalid", "true");
    setText(error, fieldErrorText(fieldError));
  }
}

/** Revalide pendant la frappe, une fois qu'un premier scellé a été refusé. */
function liveValidate(): void {
  if (!showLiveErrors) return;
  const result = validateDraft(readDraft(), now());
  const errors = result.ok ? [] : result.errors;
  showErrors(errors);
  setText(view.formError, errors.length === 0 ? "" : formErrorText(errors));
}

view.form.addEventListener("input", liveValidate);

view.form.addEventListener("submit", (event) => {
  event.preventDefault();
  sealDraft();
});

function sealDraft(): void {
  const result = validateDraft(readDraft(), now());
  showLiveErrors = true;
  if (!result.ok) {
    showErrors(result.errors);
    if (result.reason === "clock") {
      // Aucun champ en cause : seule l'horloge de l'appareil bloque.
      setText(view.formError, TEXT.clock);
      return;
    }
    // Acte trop long pour un lien compris : l'erreur est sur le texte à raccourcir (CA-1).
    setText(view.formError, formErrorText(result.errors));
    const [first] = result.errors;
    fieldOf(first.field, first.index).control.focus();
    return;
  }
  showErrors([]);
  setText(view.formError, "");
  // Nouvelle entrée d'historique : « Précédent » rend le formulaire tel qu'il était tapé.
  history.pushState(null, "", urlFor(buildHash(result.deed, null)));
  void load(() => view.copy);
}

view.addArticle.addEventListener("click", () => {
  if (articleItems().length >= LIMITS.articlesMax) return;
  const item = buildArticleRow("");
  view.articleRows.append(item);
  refreshArticles();
  slot(item, "text", HTMLTextAreaElement).focus();
});

view.articleRows.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("button");
  if (button === null || button.dataset["slot"] !== "remove") return;
  const items = articleItems();
  const index = items.findIndex((item) => item.contains(button));
  if (index === -1) return;
  items[index]?.remove();
  refreshArticles();
  liveValidate();
  // Le focus va au bouton Retirer qui prend la place, sinon au précédent, sinon à l'ajout.
  const remaining = articleItems();
  const next = remaining[Math.min(index, remaining.length - 1)];
  (next === undefined ? view.addArticle : slot(next, "remove", HTMLButtonElement)).focus();
});

// ---------------------------------------------------------------------------------------------
// Actions de l'acte
// ---------------------------------------------------------------------------------------------

// CA-7
view.copy.addEventListener("click", () => void copier.copy(location.href, view.copy));

// CA-6
view.print.addEventListener("click", () => window.print());

// CA-5 : le dialogue du verdict, modal (focus piégé), Échap le referme.
view.declare.addEventListener("click", () => {
  if (state.screen !== "deed") return;
  setText(view.choiceBettor, state.deed.bettor);
  setText(view.choiceOpponent, state.deed.opponent);
  // Échap ne touche pas returnValue : sans remise à zéro, il reprendrait le choix précédent.
  view.verdictDialog.returnValue = "";
  view.verdictDialog.showModal();
});

view.verdictDialog.addEventListener("close", () => {
  const verdict = parseEnum(view.verdictDialog.returnValue, VERDICTS);
  view.verdictDialog.returnValue = "";
  if (verdict === null || state.screen !== "deed") {
    // Échap ou « Annuler » : rien ne change, le focus revient au bouton.
    if (view.declare.isConnected && !view.deedScreen.hidden) view.declare.focus();
    return;
  }
  // Le verdict s'ajoute au hash, dans une nouvelle entrée d'historique.
  history.pushState(null, "", urlFor(buildHash(state.deed, verdict)));
  freshVerdict = true;
  void load(() => view.judged);
});

function startNewDeed(): void {
  resetForm();
  history.pushState(null, "", urlFor(""));
  void load(() => view.draftHeading);
}

view.newDeed.addEventListener("click", startNewDeed);
view.restart.addEventListener("click", startNewDeed);

view.dismissNotices.addEventListener("click", () => {
  renderNotices([]);
  // Le bouton disparaît : le focus va au titre de l'acte.
  byId("deed-title", HTMLElement).focus();
});

resetForm();
void load();
