import { describe, expect, it } from "vitest";
import { anchorTarget } from "./pdf-anchors";

/*
 * Ankrene fra PDF-utkastet (F4). Oppdiktede id-er.
 */

const CP_ID = "0190a3b4-0000-7000-8000-000000000001";
const OTHER_CP_ID = "0190a3b4-0000-7000-8000-000000000002";
const DEV_ID = "0190a3b4-0000-7000-8000-0000000000d1";
const keys = new Map([
  [CP_ID, "wet_room.floor"],
  [OTHER_CP_ID, "wet_room.ventilation"],
]);
const checkpoints = [
  { checkpointKey: "wet_room.general", deviations: [] },
  { checkpointKey: "wet_room.floor", deviations: [{ id: DEV_ID }] },
];

describe("anchorTarget", () => {
  it.each([
    ["punkt", `#punkt-${CP_ID}`, { checkpointKey: "wet_room.floor", deviationId: null }],
    ["avvik", `#avvik-${DEV_ID}`, { checkpointKey: "wet_room.floor", deviationId: DEV_ID }],
    [
      "store bokstaver",
      `#AVVIK-${DEV_ID.toUpperCase()}`,
      {
        checkpointKey: "wet_room.floor",
        deviationId: DEV_ID,
      },
    ],
  ])("%s", (_name, hash, expected) => {
    expect(anchorTarget(hash, keys, checkpoints)).toEqual(expected);
  });

  it.each([
    ["tomt", ""],
    ["bare #", "#"],
    ["ukjent punkt", "#punkt-0190a3b4-0000-7000-8000-00000000ffff"],
    ["punkt som ikke er i rommet", `#punkt-${OTHER_CP_ID}`],
    ["ukjent avvik", "#avvik-0190a3b4-0000-7000-8000-00000000ffff"],
    ["annen form", `#punkt=${CP_ID}`],
    ["tekst i stedet for id", "#punkt-<script>"],
    ["kode i stedet for id", "#punkt-wet_room.floor"],
  ])("%s gir null", (_name, hash) => {
    expect(anchorTarget(hash, keys, checkpoints)).toBeNull();
  });
});
