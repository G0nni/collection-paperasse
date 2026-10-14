// Couleurs et contraste, calculés à partir des styles calculés (axe ne voit ni :hover ni
// :focus-visible, et classe « incomplete » tout ce qui est sur un dégradé).
// Les fonctions passées à `evaluate` (snapshotTextNodes, focusRing) sont autonomes : Playwright
// les sérialise et les exécute dans la page, elles ne peuvent rien importer.

export type Rgba = { r: number; g: number; b: number; a: number };

export type Layer = { background: string; image: string; opacity: string };

export type StyleSnapshot = {
  text: string;
  color: string;
  fontSize: number;
  fontWeight: number;
  /** Du nœud lui-même jusqu'à <html>. */
  chain: Layer[];
};

export function parseColor(value: string): Rgba[] {
  const colors: Rgba[] = [];
  for (const match of value.matchAll(/rgba?\(([^)]+)\)/gu)) {
    const parts = (match[1] ?? "")
      .split(/[\s,/]+/u)
      .filter(Boolean)
      .map(Number);
    const [r = 0, g = 0, b = 0, a = 1] = parts;
    colors.push({ r, g, b, a });
  }
  for (const match of value.matchAll(/#([0-9a-f]{6})\b/giu)) {
    const hex = match[1] ?? "000000";
    colors.push({
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    });
  }
  return colors;
}

export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

export function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(first: Rgba, second: Rgba): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/**
 * Fonds possibles derrière un nœud. Chaque dégradé rencontré ajoute ses couleurs comme fonds
 * candidats (on garde le pire cas). Une image `url(…)` rend le calcul impossible : signalé.
 */
export function backdrops(chain: Layer[]): { candidates: Rgba[]; unknown: string[] } {
  const unknown: string[] = [];
  const stack: Layer[] = [];
  for (const layer of chain) {
    stack.push(layer);
    const color = parseColor(layer.background)[0];
    if (color !== undefined && color.a >= 1) break;
  }
  let candidates: Rgba[] = [{ r: 255, g: 255, b: 255, a: 1 }];
  for (const layer of stack.reverse()) {
    const color = parseColor(layer.background)[0] ?? { r: 0, g: 0, b: 0, a: 0 };
    let next = candidates.map((candidate) => over(color, candidate));
    if (layer.image !== "none") {
      if (layer.image.includes("url(")) unknown.push(layer.image);
      for (const stop of parseColor(layer.image)) {
        next = next.concat(candidates.map((candidate) => over(stop, over(color, candidate))));
      }
    }
    if (Number(layer.opacity) < 1) unknown.push(`opacity ${layer.opacity}`);
    candidates = next;
  }
  return { candidates, unknown };
}

export function worstContrast(foreground: string, chain: Layer[]) {
  const { candidates, unknown } = backdrops(chain);
  const text = parseColor(foreground)[0] ?? { r: 0, g: 0, b: 0, a: 1 };
  const ratios = candidates.map((background) => contrast(over(text, background), background));
  return { ratio: Math.min(...ratios), unknown };
}

export function requiredRatio(snapshot: StyleSnapshot): number {
  const large =
    snapshot.fontSize >= 24 || (snapshot.fontSize >= 18.66 && snapshot.fontWeight >= 700);
  return large ? 3 : 4.5;
}

/** Instantané des nœuds porteurs de texte sous `root` (lui compris). Autonome : sérialisé. */
export function snapshotTextNodes(root: Element): StyleSnapshot[] {
  const layerOf = (node: Element) => {
    const style = getComputedStyle(node);
    return {
      background: style.backgroundColor,
      image: style.backgroundImage,
      opacity: style.opacity,
    };
  };
  const result: StyleSnapshot[] = [];
  const nodes = [root, ...root.querySelectorAll("*")];
  for (const node of nodes) {
    if (node.closest("svg") !== null) continue;
    const ownText = [...node.childNodes]
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent ?? "")
      .join("")
      .trim();
    if (ownText === "") continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) continue;
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const chain = [];
    for (let current: Element | null = node; current !== null; current = current.parentElement) {
      chain.push(layerOf(current));
    }
    result.push({
      text: ownText.slice(0, 50),
      color: style.color,
      fontSize: parseFloat(style.fontSize),
      fontWeight: Number(style.fontWeight),
      chain,
    });
  }
  return result;
}

export function contrastFailures(snapshots: StyleSnapshot[]): string[] {
  const failures: string[] = [];
  for (const snapshot of snapshots) {
    const { ratio, unknown } = worstContrast(snapshot.color, snapshot.chain);
    const required = requiredRatio(snapshot);
    if (unknown.length > 0) {
      failures.push(`« ${snapshot.text} » : fond non calculable (${unknown.join(", ")})`);
    } else if (ratio < required) {
      failures.push(
        `« ${snapshot.text} » : ${ratio.toFixed(2)}:1 < ${required}:1 (${snapshot.color}, ${snapshot.fontSize}px)`,
      );
    }
  }
  return failures;
}

/** Instantané du contour de focus et du fond qui l'entoure (celui du parent). */
export function focusRing(element: Element) {
  const style = getComputedStyle(element);
  const chain = [];
  for (
    let current: Element | null = element.parentElement;
    current !== null;
    current = current.parentElement
  ) {
    const parentStyle = getComputedStyle(current);
    chain.push({
      background: parentStyle.backgroundColor,
      image: parentStyle.backgroundImage,
      opacity: parentStyle.opacity,
    });
  }
  return {
    focusVisible: element.matches(":focus-visible"),
    outlineStyle: style.outlineStyle,
    outlineWidth: parseFloat(style.outlineWidth),
    outlineColor: style.outlineColor,
    outlineOffset: parseFloat(style.outlineOffset),
    boxShadow: style.boxShadow,
    chain,
  };
}
