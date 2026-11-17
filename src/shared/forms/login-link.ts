import { isSafeNextPath } from "@/shared/navigation/safe-next-path";

/**
 * Lenken til innloggingssiden fra et skjema. `neste` tas bare med når stien er godkjent av
 * `isSafeNextPath`; da er den uten spørrestreng og `#`, så den aldri bærer søketekst eller navn.
 */
export function loginHref(path: string): string {
  return isSafeNextPath(path) ? `/logg-inn?neste=${encodeURIComponent(path)}` : "/logg-inn";
}
