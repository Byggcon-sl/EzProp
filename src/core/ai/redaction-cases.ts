/*
 * Testsett med fasit for vasken før KI (docs/funksjoner/fase2a-vask-for-ki.md, akseptkriterier,
 * testplan V3.11).
 *
 * Hovedmål: KI i bunnen og færre reklamasjoner. Settet låser at persondata aldri går til KI
 * (`mustRemove`, krav 0 bom), og at faginnholdet KI trenger står (`mustKeep`).
 *
 * Alt er oppdiktet: navn, adresser, numre og matrikkel (gnr 999) finnes ikke. Tekstene er egne
 * formuleringer, ikke fra NS 3600, IVIT eller SmartTakst.
 */

import type { KnownValues } from "./redaction";

export type RedactionCase = {
  name: string;
  input: string;
  knownValues?: KnownValues;
  mustRemove: string[];
  mustKeep: string[];
};

/** Kjente verdier for et oppdiktet oppdrag. */
export const REDACTION_CASE_KNOWN_VALUES: KnownValues = {
  personNames: ["Åse Testesen", "Anne-Lise Prøvedal", "Bo Li", "Kåre Øvreli", "Jens Hansen"],
  phrases: [
    "Prøvebygg og Tak AS",
    "Borettslaget Testlia",
    "Testforvaltning AS",
    "Fiktiv Megling & Co A/S",
    "Ola Diktesen, Fiktiv Megling & Co A/S",
  ],
  emails: ["ase.testesen@eksempel.no"],
  phones: ["123 45 678", "+47 98765432"],
  orgNumbers: ["999888777"],
  addresses: {
    full: ["Prøvegata 7B, 9999 Testby"],
    places: ["Testby", "Diktekommune"],
    postalCodes: ["9999"],
  },
  cadastral: {
    units: [{ gnr: "999", bnr: "88", fnr: null, snr: "3", shareNumber: "42" }],
    municipalityNumbers: ["9999"],
  },
};

const K = REDACTION_CASE_KNOWN_VALUES;

export const REDACTION_CASES: RedactionCase[] = [
  // Kjente verdier: personnavn
  {
    name: "eier med fullt navn i notat",
    input: "Åse Testesen var til stede under befaringen og viste rundt i boligen.",
    knownValues: K,
    mustRemove: ["Åse", "Testesen"],
    mustKeep: ["befaringen", "boligen"],
  },
  {
    name: "fornavn alene med liten forbokstav",
    input: "åse opplyste at taket ble lagt om i 2004.",
    knownValues: K,
    mustRemove: ["åse"],
    mustKeep: ["taket", "2004"],
  },
  {
    name: "etternavn i store bokstaver",
    input: "EIER: TESTESEN. Bad pusset opp 2015, TG 2 på membran.",
    knownValues: K,
    mustRemove: ["TESTESEN"],
    mustKeep: ["Bad", "2015", "TG 2", "membran"],
  },
  {
    name: "dobbelt fornavn med bindestrek",
    input: "Anne-Lise Prøvedal har ikke dokumentasjon på våtrommet.",
    knownValues: K,
    mustRemove: ["Anne-Lise", "Prøvedal"],
    mustKeep: ["dokumentasjon", "våtrommet"],
  },
  {
    name: "del av dobbelt fornavn alene",
    input: "Lise sa at Anne hadde malt kjelleren i 2019.",
    knownValues: K,
    mustRemove: ["Lise", "Anne"],
    mustKeep: ["kjelleren", "2019"],
  },
  {
    name: "genitiv på etternavn",
    input: "Hansens bad har synlige sprekker i fugene, cirka 2 mm brede.",
    knownValues: K,
    mustRemove: ["Hansen"],
    mustKeep: ["bad", "sprekker", "2 mm"],
  },
  {
    name: "genitiv med apostrof og bindestrek",
    input: "Anne-Lises bod og Hansen's garasje ble ikke kontrollert.",
    knownValues: K,
    mustRemove: ["Anne-Lise", "Hansen"],
    mustKeep: ["bod", "garasje"],
  },
  {
    name: "kort navn som frase",
    input: "Selger Bo Li var ikke til stede.",
    knownValues: K,
    mustRemove: ["Bo Li"],
    mustKeep: ["Selger", "til stede"],
  },
  {
    name: "ansatt på oppdraget med æøå",
    input: "Kåre Øvreli tok fuktmåling i yttervegg mot nord, 18 vektprosent.",
    knownValues: K,
    mustRemove: ["Kåre", "Øvreli"],
    mustKeep: ["fuktmåling", "yttervegg", "18 vektprosent"],
  },
  // Kjente verdier: firma, borettslag og forretningsfører
  {
    name: "firmanavn som hel frase, fagord står",
    input: "Prøvebygg og Tak AS la nytt tak i 2012. Bygg og tak ellers uten merknad.",
    knownValues: K,
    mustRemove: ["Prøvebygg og Tak AS"],
    mustKeep: ["nytt tak", "2012", "Bygg og tak"],
  },
  {
    name: "borettslag og forretningsfører",
    input:
      "Borettslaget Testlia har vedlikeholdsplan. Testforvaltning AS svarer på spørsmål om fellesareal.",
    knownValues: K,
    mustRemove: ["Borettslaget Testlia", "Testforvaltning"],
    mustKeep: ["vedlikeholdsplan", "fellesareal"],
  },
  {
    name: "firmanavn med regex-tegn",
    input: "Bestilt av Fiktiv Megling & Co A/S. Oppdraget gjelder enebolig.",
    knownValues: K,
    mustRemove: ["Fiktiv Megling & Co A/S"],
    mustKeep: ["Bestilt av", "enebolig"],
  },
  {
    name: "firmanavn uten selskapsform",
    input: "Megler fra Fiktiv Megling & Co ringte om tidspunkt.",
    knownValues: K,
    mustRemove: ["Fiktiv Megling & Co"],
    mustKeep: ["Megler", "tidspunkt"],
  },
  {
    name: "bestillerteksten med to deler",
    input: "Ola Diktesen ba om rapport innen fredag.",
    knownValues: K,
    mustRemove: ["Ola Diktesen"],
    mustKeep: ["rapport", "fredag"],
  },
  // Kjente verdier: kontakt
  {
    name: "kjent e-post",
    input: "Send kopi til ase.testesen@eksempel.no når rapporten er klar.",
    knownValues: K,
    mustRemove: ["ase.testesen@eksempel.no"],
    mustKeep: ["kopi", "rapporten"],
  },
  {
    name: "kjent telefon skrevet sammen",
    input: "Ring 12345678 før befaring, nøkkel i postkassen.",
    knownValues: K,
    mustRemove: ["12345678"],
    mustKeep: ["befaring", "nøkkel"],
  },
  {
    name: "kjent telefon med landskode",
    input: "Kontakt på +47 987 65 432 ved spørsmål om loftet.",
    knownValues: K,
    mustRemove: ["987 65 432"],
    mustKeep: ["loftet"],
  },
  {
    name: "kjent organisasjonsnummer",
    input: "Faktura til org.nr. 999 888 777, merk med oppdraget.",
    knownValues: K,
    mustRemove: ["999 888 777"],
    mustKeep: ["Faktura"],
  },
  // Kjente verdier: adresse
  {
    name: "hel adresse",
    input: "Befaring på Prøvegata 7B, 9999 Testby kl. 10.",
    knownValues: K,
    mustRemove: ["Prøvegata", "9999 Testby", "7B"],
    mustKeep: ["Befaring"],
  },
  {
    name: "gatenavn alene",
    input: "Det er mye trafikk i Prøvegata, støy fra vei.",
    knownValues: K,
    mustRemove: ["Prøvegata"],
    mustKeep: ["trafikk", "støy"],
  },
  {
    name: "gatenavn og nummer med mellomrom foran bokstaven",
    input: "Naboen i Prøvegata 7 b har samme takløsning.",
    knownValues: K,
    mustRemove: ["Prøvegata 7 b"],
    mustKeep: ["Naboen", "takløsning"],
  },
  {
    name: "poststed og kommune alene",
    input: "Testby har hardt klima. Diktekommune krever ferdigattest for tilbygget.",
    knownValues: K,
    mustRemove: ["Testby", "Diktekommune"],
    mustKeep: ["klima", "ferdigattest", "tilbygget"],
  },
  {
    name: "postnummer alene står",
    input: "Avstand til sjø 9999 meter er ikke relevant, se tegning 2.",
    knownValues: K,
    mustRemove: [],
    mustKeep: ["9999 meter", "tegning 2"],
  },
  // Kjente verdier: matrikkel
  {
    name: "matrikkel som brøk",
    input: "Eiendommen 999/88 har ett bolighus og en garasje.",
    knownValues: K,
    mustRemove: ["999/88"],
    mustKeep: ["bolighus", "garasje"],
  },
  {
    name: "matrikkel med kommunenummer og seksjon",
    input: "Gjelder 9999-999/88/0/3 i borettslaget.",
    knownValues: K,
    mustRemove: ["999/88"],
    mustKeep: ["borettslaget"],
  },
  {
    name: "matrikkelord og andelsnummer",
    input: "Gnr 999 i kommunen, andelsnummer 42. Takvinkel 42 grader.",
    knownValues: K,
    mustRemove: ["Gnr 999", "andelsnummer 42"],
    mustKeep: ["Takvinkel 42 grader"],
  },
  {
    name: "enkelttall som er lik gnr står",
    input: "Bjelkelaget er 999 mm over grunnen og 88 mm tykk isolasjon.",
    knownValues: K,
    mustRemove: [],
    mustKeep: ["999 mm", "88 mm"],
  },
  // Mønstrene (uten kjente verdier)
  {
    name: "ukjent telefon gruppert",
    input: "Rørlegger nås på 12 34 56 78 eller 900-11-222.",
    mustRemove: ["12 34 56 78", "900-11-222"],
    mustKeep: ["Rørlegger"],
  },
  {
    name: "ukjent e-post",
    input: "Tegninger kom fra Ukjent.Person+bygg@eksempel.com i går.",
    mustRemove: ["Ukjent.Person+bygg@eksempel.com"],
    mustKeep: ["Tegninger"],
  },
  {
    name: "fødselsnummer",
    input: "Eier oppga 010199 12345 på skjemaet, ikke nødvendig for rapporten.",
    mustRemove: ["010199 12345"],
    mustKeep: ["skjemaet", "rapporten"],
  },
  {
    name: "kontonummer",
    input: "Depositum til 1234.56.78901 ble nevnt, ikke relevant.",
    mustRemove: ["1234.56.78901"],
    mustKeep: ["Depositum"],
  },
  {
    name: "organisasjonsnummer med MVA",
    input: "Entreprenør NO 987654321 MVA leverte drenering i 2018.",
    mustRemove: ["987654321"],
    mustKeep: ["drenering", "2018"],
  },
  {
    name: "ukjent matrikkel med matrikkelord",
    input: "Garasjen står på gnr. 998 bnr. 12, egen eiendom.",
    mustRemove: ["998", "bnr. 12"],
    mustKeep: ["Garasjen", "egen eiendom"],
  },
  {
    name: "ukjent adresse med husnummer og postnummer",
    input: "Tidligere eier flyttet til Diktveien 14A, 9998 Prøvestad.",
    mustRemove: ["Diktveien 14A", "9998 Prøvestad"],
    mustKeep: ["Tidligere eier"],
  },
  // Fagtekst som skal stå urørt
  {
    name: "avvikstekst med mål og årstall",
    input:
      "TG 2: Fall mot sluk er 0,25 cm per meter, for lite. Membran fra 1985. Bjelker 48x98, c/c 600 mm.",
    mustRemove: [],
    mustKeep: ["TG 2", "0,25", "1985", "48x98", "600 mm"],
  },
  {
    name: "datoer, beløp og 12/34 uten matrikkelord",
    input:
      "Befart 11.11.2026, forrige rapport 2026-11-11. Takst kr 4 500 000. Vindu 12/34 i tegning.",
    mustRemove: [],
    mustKeep: ["11.11.2026", "2026-11-11", "kr 4 500 000", "12/34"],
  },
  {
    name: "gatenavnendelse uten nummer står",
    input: "Avrenning ved bakken og langs stien mot huset, TG 1.",
    mustRemove: [],
    mustKeep: ["ved bakken", "langs stien", "TG 1"],
  },
  {
    name: "alt i én tekst",
    input:
      "Åse Testesen (ase.testesen@eksempel.no, 123 45 678) eier Prøvegata 7B, gnr 999 bnr 88. Prøvebygg og Tak AS (org 999888777) skiftet tak i 2010. Råte i svill, TG 3.",
    knownValues: K,
    mustRemove: [
      "Åse",
      "Testesen",
      "ase.testesen@eksempel.no",
      "123 45 678",
      "Prøvegata",
      "gnr 999",
      "bnr 88",
      "Prøvebygg og Tak AS",
      "999888777",
    ],
    mustKeep: ["skiftet tak", "2010", "Råte i svill", "TG 3"],
  },
];
