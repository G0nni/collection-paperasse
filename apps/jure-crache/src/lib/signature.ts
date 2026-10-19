// Signatures SVG générées (Design, « signatures SVG générées ») : un gribouillis déterministe
// tiré du nom. Même nom, même gribouillis, sur tous les appareils : seuls des entiers 32 bits
// (Math.imul) et des arrondis au dixième, identiques dans tous les moteurs. Le tracé ne contient
// que des commandes et des nombres écrits ici : jamais le nom lui-même.

/** Cadre du tracé, en unités du viewBox (« 0 0 180 48 », comme la maquette). */
export const SIGNATURE_BOX = { width: 180, height: 48 } as const;

const MARGIN = 3;

/** FNV-1a 32 bits sur les points de code du nom. */
export function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (const char of name) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Générateur pseudo-aléatoire mulberry32 : [0, 1), déterministe pour une graine donnée. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Un point du tracé, gardé dans le cadre et arrondi au dixième. */
function point(x: number, y: number): string {
  const px = clamp(x, MARGIN, SIGNATURE_BOX.width - MARGIN);
  const py = clamp(y, MARGIN, SIGNATURE_BOX.height - MARGIN);
  return `${px.toFixed(1)} ${py.toFixed(1)}`;
}

/**
 * Attribut `d` de la signature d'un nom : une majuscule en boucle, 5 à 8 « lettres » attachées
 * (grandes boucles comme un l, petites comme un e, ponts comme un n), puis un paraphe qui
 * souligne le tout. Le nom est déjà nettoyé (sanitizeText).
 */
export function signaturePath(name: string): string {
  const random = seededRandom(hashName(name));
  const between = (min: number, max: number) => min + random() * (max - min);

  const base = between(30, 34);
  let x = between(6, 12);
  // Majuscule : un grand jambage qui monte et redescend sur la ligne.
  const capitalTop = between(4, 9);
  const parts = [
    `M${point(x + between(2, 6), base + between(4, 8))}`,
    `C${point(x - between(2, 6), capitalTop + 6)} ${point(x + between(14, 22), capitalTop)} ` +
      point(x + between(10, 16), base),
  ];
  x += between(12, 16);

  const letters = 5 + Math.floor(random() * 4);
  for (let letter = 0; letter < letters; letter += 1) {
    const width = between(15, 21);
    const kind = random();
    const lineY = base + between(-2, 2);
    if (kind < 0.4) {
      // Boucle : le second point de contrôle repasse à gauche du départ, la courbe se croise.
      const height = kind < 0.2 ? between(18, 25) : between(8, 12);
      parts.push(
        `C${point(x + width * 1.25, lineY - height)} ` +
          `${point(x - width * 0.45, lineY - height)} ${point(x + width * 0.7, lineY)}`,
      );
    } else {
      // Pont : une bosse arrondie, comme un n.
      const height = between(7, 12);
      parts.push(
        `C${point(x + width * 0.05, lineY - height)} ` +
          `${point(x + width * 0.65, lineY - height)} ${point(x + width * 0.7, lineY)}`,
      );
    }
    x += width * 0.7;
  }

  // Paraphe : un trait qui repart sous la signature et remonte à droite.
  parts.push(
    `M${point(between(8, 22), between(40, 44))} ` +
      `Q${point(between(70, 110), between(45, 47))} ${point(between(160, 176), between(30, 38))}`,
  );
  return parts.join(" ");
}
