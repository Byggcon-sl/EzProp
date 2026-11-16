import { SEARCH_QUERY_MAX_LENGTH } from "@/shared/lib/like-pattern";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/form";

/**
 * Søkefelt for listene (/kontakter, /firma og /tilbud). Vanlig GET-skjema med parameteren `q`, så
 * søket virker uten klientkode og kan deles som lenke. `type="search"` gir søketasten på iPaden.
 * `hidden` blir skjulte felt i skjemaet, slik at for eksempel filteret i tilbudslisten følger med
 * når man søker.
 */
export function SearchBox({
  label,
  query,
  hidden = {},
}: {
  label: string;
  query: string;
  hidden?: Record<string, string>;
}) {
  return (
    <form role="search" method="get" className="mt-6 flex flex-wrap items-end gap-3">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="min-w-0 flex-1 basis-56 space-y-1.5">
        <label htmlFor="q" className="block text-sm font-medium text-slate-700">
          {label}
        </label>
        <Input
          id="q"
          name="q"
          type="search"
          maxLength={SEARCH_QUERY_MAX_LENGTH}
          defaultValue={query}
        />
      </div>
      <Button type="submit" variant="secondary">
        Søk
      </Button>
    </form>
  );
}

/** Søket fra adressen: første verdi, trimmet. */
export function searchQuery(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return (first ?? "").trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
}
