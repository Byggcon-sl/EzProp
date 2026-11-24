import type { Actor } from "@/core/access";
import type { PublishOverrideReasonCode } from "@/db/schema";

/**
 * Grensesnittet til «Kontrollpunkt» på reklamasjonen (docs/funksjoner/fase2a-overstyringer-leder.md,
 * A564 og A576). Utvikleren bygger mot typene her.
 *
 * Støtter hovedmål: færre reklamasjoner (saken kobles til punktet, så overstyringer som ga
 * reklamasjon, blir synlige) og de ansatte (punktet er nesten valgt på forhånd).
 *
 * `checkpoint_key` lagres på saken som fast kode (regel 6). Ved lagring sjekker serveren at koden
 * er et kontrollpunkt i malversjonen til en rapport på oppdraget, med `grant.organizationId` i
 * alle ledd. Ukjent kode, kode fra en annen organisasjon og kode fra et annet oppdrag gir samme
 * feil (`ClaimCheckpointNotFoundError`). Tomt felt (`null`) godtas alltid. En kode som alt står på
 * saken, godtas uendret selv om punktet senere er arkivert.
 *
 * KI er ikke med: forhåndsvalget er en enkel tekstsammenligning på serveren, og friteksten på
 * saken går aldri til KI.
 */

/** Overstyringen som vises ved punktet: «Krysset bort ved publisering (dato, grunn)». */
export type ClaimCheckpointOverride = {
  /** Utgivelsesdatoen i norsk tid, `YYYY-MM-DD`. Siste utgivelse der punktet ble krysset bort. */
  releasedDate: string;
  reasonCode: PublishOverrideReasonCode;
  reasonLabel: string;
};

export type ClaimCheckpointOption = {
  checkpointKey: string;
  /** Navnet fra malversjonen til rapporten. */
  name: string;
  /** Overskriften i nedtrekksmenyen: rom eller kapittel. */
  groupLabel: string;
  /** Satt når punktet ble krysset bort i en utgivelse på oppdraget. Disse står øverst. */
  override: ClaimCheckpointOverride | null;
  /** Punktet er arkivert i malen. Vises bare når koden alt står på saken. */
  archived: boolean;
};

export type ClaimCheckpointOptions = {
  /** Bortkryssede punkter først, deretter i malens rekkefølge. Tom når oppdraget ikke har rapport. */
  options: ClaimCheckpointOption[];
  /** Forhåndsvalget fra `RankCheckpointMatch`. `null` = «Ikke valgt». */
  suggestedKey: string | null;
};

/**
 * Punktene som kan velges på en reklamasjon på oppdraget (`claims.manage`). Har oppdraget én
 * rapport, kommer bare punktene fra den. `buildingPartText` er teksten i skjemaet akkurat nå; den
 * brukes bare til forhåndsvalget, og lagres og logges ikke her. Leser aldri begrunnelsesteksten
 * eller hvem som krysset bort.
 */
export type ListClaimCheckpointOptions = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input?: { buildingPartText?: string | null },
) => Promise<ClaimCheckpointOptions>;

/**
 * Beste treff mellom fritekst og punktnavn (ren funksjon, ingen KI). Gir en kode bare når treffet
 * er tydelig: ett punkt skiller seg klart fra de andre. Ellers `null`. Bortkryssede punkter vinner
 * ved likt treff.
 */
export type RankCheckpointMatch = (
  buildingPartText: string | null,
  options: readonly Pick<ClaimCheckpointOption, "checkpointKey" | "name" | "override">[],
) => string | null;
