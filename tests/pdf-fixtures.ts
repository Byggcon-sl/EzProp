import { crc32, deflateSync } from "node:zlib";
import { BYGGCON_STANDARD_PROFILE } from "@/core/pdf/profiles";
import type {
  PdfCheckpoint,
  PdfDeviation,
  PdfImage,
  PdfProfile,
  ReportPdfData,
} from "@/core/pdf/types";

/*
 * Oppdiktede rapportdata for PDF-en av badet (testplanen avsnitt 4). Ingen ekte adresser, navn
 * eller selskaper. Tekstene er skrevet for testene og er ikke fagtekst.
 */

export const IDS = {
  report: "0193a000-0000-7000-8000-000000000001",
  assignment: "0193a000-0000-7000-8000-000000000002",
  room: "0193a000-0000-7000-8000-000000000003",
  cpMembrane: "0193a000-0000-7000-8000-000000000010",
  cpDrain: "0193a000-0000-7000-8000-000000000011",
  cpAdjacent: "0193a000-0000-7000-8000-000000000012",
  cpVentilation: "0193a000-0000-7000-8000-000000000013",
  cpEmpty: "0193a000-0000-7000-8000-000000000014",
  devMembrane: "0193a000-0000-7000-8000-000000000020",
  devMembraneHms: "0193a000-0000-7000-8000-000000000021",
  devDrain: "0193a000-0000-7000-8000-000000000022",
} as const;

const roomPath = `/oppdrag/${IDS.assignment}/rom/${IDS.room}`;

/** Liggende testprofil med andre farger. Finnes bare i testene (testplanen 3.6.4). */
export const TEST_LANDSCAPE_PROFILE: PdfProfile = {
  ...BYGGCON_STANDARD_PROFILE,
  code: "test_landscape",
  version: 1,
  name: "Testprofil liggende",
  orientation: "landscape",
  colors: {
    ...BYGGCON_STANDARD_PROFILE.colors,
    accent: "#1f5f4a",
    panel: "#e6efe9",
    rule: "#9fb8ad",
  },
};

/** En liten PNG uten metadata. `extraChunks` legges inn før `IDAT` (for å prøve avvisning). */
export function pngBytes(
  width: number,
  height: number,
  extraChunks: { type: string; data: Uint8Array }[] = [],
): Uint8Array {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * row + 1 + x * 3;
      raw[at] = Math.floor((x * 255) / width);
      raw[at + 1] = Math.floor((y * 255) / height);
      raw[at + 2] = 120;
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      ...extraChunks.map((extra) => chunk(extra.type, extra.data)),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", new Uint8Array(0)),
    ]),
  );
}

export function testImage(id: string, caption: string | null, overrides: Partial<PdfImage> = {}) {
  const image: PdfImage = {
    id,
    format: "png",
    bytes: pngBytes(160, 120),
    widthPx: 160,
    heightPx: 120,
    caption,
    markings: [
      { type: "circle", center: { x: 0.4, y: 0.5 }, radius: 0.15 },
      { type: "arrow", from: { x: 0.9, y: 0.1 }, to: { x: 0.55, y: 0.4 } },
    ],
    ...overrides,
  };
  return image;
}

function deviation(overrides: Partial<PdfDeviation> & Pick<PdfDeviation, "deviationId">) {
  const base: PdfDeviation = {
    deviationId: overrides.deviationId,
    kind: "tg",
    tg: "2",
    tgNotSet: false,
    text: null,
    causeLabel: null,
    causeText: null,
    consequenceText: null,
    measures: [],
    cost: { type: "none", bandKey: null, amount: null, displayText: null, text: null },
    images: [],
    notes: [],
    editPath: null,
  };
  return { ...base, ...overrides };
}

function checkpoint(overrides: Partial<PdfCheckpoint> & Pick<PdfCheckpoint, "checkpointId">) {
  const base: PdfCheckpoint = {
    checkpointId: overrides.checkpointId,
    checkpointKey: "wet_room.test",
    label: "Kontrollpunkt",
    tg: null,
    tgNotSet: false,
    descriptionText: null,
    answers: [],
    deviations: [],
    tgiu: null,
    notes: [],
    editPath: null,
  };
  return { ...base, ...overrides };
}

/** Badet med alle delene: avvik med bilder, HMS, TGIU, svar, merknader og et tomt punkt. */
export function bathroomPdfData(kind: "draft" | "release" = "draft"): ReportPdfData {
  const draft = kind === "draft";
  const edit = (hash: string) => (draft ? `${roomPath}#${hash}` : null);
  return {
    reportId: IDS.report,
    kind,
    versionNumber: draft ? null : 1,
    cover: {
      assignmentNumber: "26-1042",
      addressLines: ["Prøvevegen 1", "8000 Prøvestad"],
      cadastralText: "Gnr. 999, bnr. 9",
      inspectionDate: "2026-11-03",
    },
    company: { legalName: "Testselskap takst AS", orgNumber: "999 999 999" },
    tgExplanation: {
      title: "Slik leser du TG",
      items: [
        { tg: "0", label: "TG0", text: "Prøvetekst for TG0 i testene." },
        { tg: "1", label: "TG1", text: "Prøvetekst for TG1 i testene." },
        { tg: "2", label: "TG2", text: "Prøvetekst for TG2 i testene." },
        { tg: "3", label: "TG3", text: "Prøvetekst for TG3 i testene." },
        { tg: "IU", label: "TGIU", text: "Prøvetekst for TGIU i testene." },
      ],
      hmsText: "Prøvetekst om HMS i testene.",
      textStatus: "draft",
    },
    rooms: [
      {
        roomId: IDS.room,
        roomType: "bathroom",
        title: "Bad",
        buildingName: null,
        floorName: "1. etasje",
        answers: [],
        checkpoints: [
          checkpoint({
            checkpointId: IDS.cpMembrane,
            checkpointKey: "wet_room.membrane",
            label: "Membran og tettesjikt",
            tg: "3",
            descriptionText: "Prøvebeskrivelse av membranen i testbadet.",
            answers: [
              { elementKey: "wet_room.hole_taken", label: "Hull tatt", valueText: "Ja" },
              { elementKey: "wet_room.moisture", label: "Fuktmåling", valueText: "12,4 vekt-%" },
            ],
            deviations: [
              deviation({
                deviationId: IDS.devMembrane,
                tg: "3",
                text: "Prøvetekst for avviket ved sluket i testbadet.",
                causeLabel: "Fukt",
                causeText: "Prøvetekst for årsaken.",
                consequenceText: "Prøvetekst for konsekvensen.",
                measures: ["Første prøvetiltak.", "Andre prøvetiltak."],
                cost: {
                  type: "band",
                  bandKey: "from_20000_to_100000",
                  amount: null,
                  displayText: "20 000–100 000 kr",
                  text: null,
                },
                images: [
                  testImage("0193a000-0000-7000-8000-000000000031", "Bildetekst en"),
                  testImage("0193a000-0000-7000-8000-000000000032", "Bildetekst to", {
                    markings: [],
                  }),
                ],
                notes: draft
                  ? [{ kind: "check", checkCode: "x", text: "Prøvetekst fra sjekken." }]
                  : [],
                editPath: edit(`avvik-${IDS.devMembrane}`),
              }),
              deviation({
                deviationId: IDS.devMembraneHms,
                kind: "hms",
                tg: null,
                consequenceText: "Prøvetekst for HMS-konsekvens.",
                measures: ["Prøvetiltak for HMS."],
                editPath: edit(`avvik-${IDS.devMembraneHms}`),
              }),
            ],
            editPath: edit(`punkt-${IDS.cpMembrane}`),
          }),
          checkpoint({
            checkpointId: IDS.cpDrain,
            checkpointKey: "wet_room.drain",
            label: "Sluk",
            tg: "2",
            deviations: [
              deviation({
                deviationId: IDS.devDrain,
                tg: "2",
                text: "Prøvetekst for avviket ved sluket.",
                consequenceText: "Prøvetekst for konsekvensen ved sluket.",
                cost: {
                  type: "approx",
                  bandKey: null,
                  amount: 40000,
                  displayText: "ca. 40 000 kr",
                  text: null,
                },
                images: [testImage("0193a000-0000-7000-8000-000000000033", null)],
                editPath: edit(`avvik-${IDS.devDrain}`),
              }),
            ],
            editPath: edit(`punkt-${IDS.cpDrain}`),
          }),
          checkpoint({
            checkpointId: IDS.cpAdjacent,
            checkpointKey: "wet_room.adjacent",
            label: "Tilliggende konstruksjoner",
            tg: "IU",
            tgiu: {
              details: [
                {
                  field: "what_and_why",
                  label: "Hva og hvorfor",
                  text: "Prøvetekst hva og hvorfor.",
                },
                { field: "risk", label: "Risiko", text: "Prøvetekst for risiko." },
              ],
              ownerInformedText: null,
            },
            editPath: edit(`punkt-${IDS.cpAdjacent}`),
          }),
          checkpoint({
            checkpointId: IDS.cpVentilation,
            checkpointKey: "wet_room.ventilation",
            label: "Ventilasjon",
            tg: null,
            tgNotSet: draft,
            descriptionText: "Prøvebeskrivelse av ventilasjonen.",
            notes: draft
              ? [{ kind: "missing", checkCode: "y", text: "Prøvetekst for det som mangler." }]
              : [],
            editPath: edit(`punkt-${IDS.cpVentilation}`),
          }),
        ],
      },
    ],
    missing: draft
      ? {
          reportNotes: [
            { kind: "missing", checkCode: "z", text: "Prøvetekst for hele rapporten." },
          ],
          emptyCheckpoints: [
            {
              roomTitle: "Bad",
              checkpointId: IDS.cpEmpty,
              label: "Overflater",
              editPath: `${roomPath}#punkt-${IDS.cpEmpty}`,
            },
          ],
        }
      : null,
  };
}
