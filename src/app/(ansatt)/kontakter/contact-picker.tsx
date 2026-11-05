"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Field, Input } from "@/shared/ui/form";
import { searchContactsAction, type ContactHit } from "./actions";

export type { ContactHit };

/** Søket starter ved så mange tegn (samme grense som i handlingen). */
const MIN_LENGTH = 2;

/** Ventetid etter siste tastetrykk før søket sendes. */
const SEARCH_DELAY_MS = 250;

/** Kontakten parten eller ordren er koblet til: id-en og navnet fra friteksten. */
export type LinkedContact = { id: string; name: string };

/**
 * Søk i kontaktregisteret fra et skjema (partene på oppdraget og bestilleren på ny ordre).
 * Treffene er vanlige knapper: de nås med Tab og velges med Enter eller trykk, uten egen
 * tastaturhåndtering. Valget fyller feltene via `onSelect` (brukeren kan rette dem etterpå) og
 * setter det skjulte feltet `name`. «Fjern kobling» tømmer bare koblingen, ikke feltene.
 * Startverdien kommer fra parten (id-en og navnet i friteksten), uten oppslag i registeret.
 * Ingen tilgangslogikk her: handlingen og kjernen sjekker tilgangen.
 */
export function ContactPicker({
  idPrefix,
  name,
  initial,
  error,
  onSelect,
}: {
  idPrefix: string;
  name: "contactId" | "orderedByContactId";
  initial: LinkedContact | null;
  error?: string;
  onSelect: (contact: ContactHit) => void;
}) {
  const [linked, setLinked] = useState<LinkedContact | null>(initial);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [searched, setSearched] = useState("");
  const latest = useRef(0);
  const linkedRef = useRef<HTMLParagraphElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusAfterChange = useRef<"linked" | "search" | null>(null);

  const text = query.trim();
  const active = text.length >= MIN_LENGTH;

  useEffect(() => {
    if (!active) return;
    const request = ++latest.current;
    const timer = setTimeout(() => {
      searchContactsAction(text)
        .then((result) => {
          if (request !== latest.current) return;
          setHits(result);
          setSearched(text);
        })
        .catch(() => {
          if (request !== latest.current) return;
          setHits([]);
          setSearched(text);
        });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, text]);

  // Fokus flyttes etter valg og «Fjern kobling», fordi knappen man trykket på forsvinner.
  useEffect(() => {
    if (focusAfterChange.current === "linked") linkedRef.current?.focus();
    if (focusAfterChange.current === "search") searchRef.current?.focus();
    focusAfterChange.current = null;
  }, [linked]);

  function choose(hit: ContactHit) {
    onSelect(hit);
    focusAfterChange.current = "linked";
    setLinked({ id: hit.id, name: hit.name });
    setQuery("");
    setHits([]);
    setSearched("");
  }

  function unlink() {
    focusAfterChange.current = "search";
    setLinked(null);
  }

  const shownHits = active && searched === text ? hits : [];
  const noHits = active && searched === text && hits.length === 0;
  const searchId = `${idPrefix}-contact-search`;

  return (
    <div className="space-y-3">
      <input type="hidden" name={name} value={linked?.id ?? ""} />
      {linked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-brand-50 px-4 py-2">
          <p
            ref={linkedRef}
            tabIndex={-1}
            className="min-w-0 flex-1 basis-48 font-medium break-words text-slate-900"
          >
            Koblet til {linked.name}
          </p>
          <Button variant="secondary" onClick={unlink}>
            Fjern kobling
          </Button>
        </div>
      ) : (
        <>
          <Field
            label="Søk i kontakter"
            htmlFor={searchId}
            hint="Skriv minst to bokstaver av navn, e-post eller firma."
          >
            <Input
              ref={searchRef}
              id={searchId}
              type="search"
              maxLength={100}
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              // Enter i søkefeltet skal ikke lagre skjemaet.
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          </Field>
          {shownHits.length > 0 && (
            <ul
              aria-label="Treff i kontakter"
              className="overflow-hidden rounded-xl border border-slate-200"
            >
              {shownHits.map((hit) => (
                <li key={hit.id} className="border-t border-slate-200 first:border-t-0">
                  <button
                    type="button"
                    onClick={() => choose(hit)}
                    className="flex min-h-11 w-full flex-col items-start px-4 py-2 text-left hover:bg-brand-50 focus-visible:-outline-offset-2"
                  >
                    <span className="font-medium break-words text-slate-900">{hit.name}</span>
                    {hit.firmName && (
                      <span className="text-sm break-words text-slate-600">{hit.firmName}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div aria-live="polite">
            {noHits && (
              <p className="text-sm text-slate-700">
                Ingen kontakter passer. Skriv inn opplysningene under, eller{" "}
                <Link href="/kontakter/ny" className="font-medium text-brand-700 underline">
                  legg inn kontakten i registeret
                </Link>
                .
              </p>
            )}
          </div>
        </>
      )}
      {error && (
        <p id={`${idPrefix}-contact-error`} className="text-sm text-red-800">
          <span className="sr-only">Feil: </span>
          {error}
        </p>
      )}
    </div>
  );
}
