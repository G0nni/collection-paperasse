// États visuels d'un élément, lus dans la page. Fonctions autonomes (sérialisées par Playwright).

/** Propriétés qui distinguent un état sans passer par la couleur. */
export function nonColorState(element: Element) {
  const style = getComputedStyle(element);
  return {
    textDecorationLine: style.textDecorationLine,
    textDecorationThickness: style.textDecorationThickness,
    textDecorationStyle: style.textDecorationStyle,
    outlineStyle: style.outlineStyle,
    outlineWidth: style.outlineWidth,
    borderWidth: `${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth}`,
    borderStyle: style.borderTopStyle,
    boxShadow: style.boxShadow,
    transform: style.transform,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
  };
}

export function colorState(element: Element) {
  const style = getComputedStyle(element);
  return `${style.color} | ${style.backgroundColor} | ${style.textDecorationColor}`;
}

/** Angle de rotation effectif (en degrés) d'un élément, ancêtres compris. Autonome. */
export function effectiveRotation(element: Element): number {
  let a = 1;
  let b = 0;
  let c = 0;
  let d = 1;
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    const transform = getComputedStyle(current).transform;
    if (transform === "none") continue;
    const values = (/matrix\(([^)]+)\)/u.exec(transform)?.[1] ?? "1,0,0,1,0,0")
      .split(",")
      .map(Number);
    const [ma = 1, mb = 0, mc = 0, md = 1] = values;
    // Le transform de l'ancêtre s'applique après celui du descendant : M_ancêtre × M_courant.
    const na = ma * a + mc * b;
    const nb = mb * a + md * b;
    const nc = ma * c + mc * d;
    const nd = mb * c + md * d;
    a = na;
    b = nb;
    c = nc;
    d = nd;
  }
  return (Math.atan2(b, a) * 180) / Math.PI;
}
