// « Copier le lien » (CA-7, spec « Écrans ») : le mécanisme est commun à la collection
// (packages/shared/src/copy.ts) ; le Réunion-mètre n'y ajoute que son texte de confirmation.
import {
  createCopier as createSharedCopier,
  type Copier,
  type CopyView,
} from "@paperasse/shared/copy";
import { TEXT } from "../lib/messages";

export type { Copier, CopyView };

export function createCopier(view: CopyView): Copier {
  return createSharedCopier(view, TEXT.copied);
}
