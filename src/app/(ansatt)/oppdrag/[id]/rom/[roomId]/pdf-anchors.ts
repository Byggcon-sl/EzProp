/*
 * Lenkene fra PDF-utkastet tilbake til skjemaet (F4 i docs/funksjoner/fase2a-pdf-badet.md):
 * `#punkt-<checkpointId>` og `#avvik-<deviationId>`. Adressen har bare id-er. Her finnes punktet
 * som skal åpnes, og elementet som skal få fokus. Ren TypeScript, testet i pdf-anchors.test.ts.
 * Støtter hovedmål: de ansatte (fra utkastet med ett klikk rett til feltet som skal rettes).
 */

const ANCHOR = /^#(punkt|avvik)-([0-9a-f-]{1,36})$/i;

export type AnchorTarget = {
  /** Punktet som skal vises. */
  checkpointKey: string;
  /** `null` for et punkt (overskriften får fokus), avvikets id for et avvik. */
  deviationId: string | null;
};

/**
 * Hva adressens anker peker på, eller `null` når ankeret er tomt, ukjent eller hører til et
 * annet rom. `checkpointKeyById` er punktene i rapportens låste malversjon.
 */
export function anchorTarget(
  hash: string,
  checkpointKeyById: ReadonlyMap<string, string>,
  checkpoints: readonly { checkpointKey: string; deviations: readonly { id: string }[] }[],
): AnchorTarget | null {
  const match = ANCHOR.exec(hash);
  if (!match) return null;
  const kind = match[1]!.toLowerCase();
  const id = match[2]!.toLowerCase();
  if (kind === "punkt") {
    const checkpointKey = checkpointKeyById.get(id);
    if (!checkpointKey) return null;
    if (!checkpoints.some((c) => c.checkpointKey === checkpointKey)) return null;
    return { checkpointKey, deviationId: null };
  }
  const owner = checkpoints.find((c) => c.deviations.some((d) => d.id.toLowerCase() === id));
  if (!owner) return null;
  const deviation = owner.deviations.find((d) => d.id.toLowerCase() === id)!;
  return { checkpointKey: owner.checkpointKey, deviationId: deviation.id };
}
