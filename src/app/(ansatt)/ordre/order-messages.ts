/*
 * Faste meldinger ved «Endre ordren» som både handlingen og skjemaet kjenner. Egen fil fordi en
 * fil med "use server" bare kan eksportere funksjoner, og en fil med "use client" ikke gir
 * verdiene til serveren.
 */

/** En annen har lagret ordren etter at skjemaet ble åpnet (`OrderChangedError`). */
export const ORDER_CHANGED = "Ordren er endret av en annen. Last siden på nytt.";

/** Lagring uten nett. Skjemaet beholder det som er skrevet. */
export const OFFLINE_NOT_SAVED = "Du er uten nett. Endringen er ikke lagret.";

/** Kvitteringen på ordresiden etter lagring (`?lagret=endret`). */
export const ORDER_SAVED = "Endringene er lagret.";
