import type { AssignmentStatus, PartyInput, PartyRole } from "@/core/assignments";
import type {
  AreaType,
  FloorAreaInput,
  MeasuringMethod,
  RoomInput,
  RoomType,
} from "@/core/buildings";
import type { OrderInput } from "@/core/orders";
import type {
  CommonAreasInput,
  HousingType,
  OwnershipForm,
  PropertyInput,
} from "@/core/properties";
import { brand } from "@/shared/config/brand";

/*
 * Fire testoppdrag som grunndata (A130–A134, innspill P11). Alt er oppdiktet: gatene finnes ikke,
 * kommunenummeret er 9999, navnene er tydelig oppdiktet og all e-post går til
 * `@example.invalid`. Ingen telefonnummer, fødselsnummer, org.nr. eller fagtekster.
 *
 * Verdiene har samme form som tjenestenes Zod-skjemaer tar (ordre, eiendom, fellesdeler,
 * bygning, etasje, areal, rom og part), så seed-steget sender dem rett inn i `src/core`. Feltene
 * `yearBuilt` og `yearRenovated` har ingen kolonne ennå. De står her for regeltestene som kommer,
 * og tas bort av skjemaene. «Målt av» på arealet settes av seed-steget til prøvetakstmannen.
 *
 * Brukes av `pnpm db:seed:testoppdrag`, «Prøv malen», regeltestene og demoene.
 */

/** Prøveorganisasjonen (A130). Navnet bygges fra `brand.companyName`. */
export const SAMPLE_ORGANIZATION_NAME = `${brand.companyName} prøve`;

/** Det oppdiktede selskapet i prøveorganisasjonen, uten org.nr. */
export const SAMPLE_COMPANY_NAME = "Prøveselskap AS";

/** Det oppdiktede kontoret i prøveorganisasjonen. */
export const SAMPLE_OFFICE_NAME = "Prøvekontor";

/** Prøvetakstmannen: ansvarlig på alle fire testoppdragene, og den e2e logger inn som. */
export const SAMPLE_INSPECTOR = {
  name: "Tor Prøvemann",
  email: "tor.provemann@example.invalid",
} as const;

export type SampleRoom = RoomInput & {
  roomType: RoomType;
  name: string;
  areaType?: AreaType;
  belowGround: boolean;
  /** Året rommet sist ble bygget om. Ingen kolonne ennå (se over). */
  yearRenovated?: number;
};

export type SampleFloorArea = Omit<FloorAreaInput, "measuredBy" | "method"> & {
  method: MeasuringMethod;
};

export type SampleFloor = {
  name: string;
  level: number;
  belowGround: boolean;
  area: SampleFloorArea;
  rooms: readonly SampleRoom[];
};

export type SampleBuilding = {
  name: string;
  /** Byggeåret. Ingen kolonne ennå (se over). */
  yearBuilt: number;
  floors: readonly SampleFloor[];
};

export type SampleParty = PartyInput & { role: PartyRole; name: string };

export type SampleAssignment = {
  /** Fast kjennetegn på testoppdraget (`orders.external_ref`, A131). Endres aldri. */
  externalRef: `sample:${string}`;
  /** Statusen seed-steget setter (A133). */
  status: Extract<AssignmentStatus, "ordered" | "in_progress">;
  /** Ordren. `externalRef` settes av seed-steget fra feltet over. */
  order: Omit<OrderInput, "externalRef" | "receivedAt" | "orderedByContactId">;
  property: PropertyInput & { housingType: HousingType; ownershipForm: OwnershipForm };
  /** Fellesdelene, bare for leilighet i sameie og borettslag. */
  commonAreas: CommonAreasInput | null;
  buildings: readonly SampleBuilding[];
  parties: readonly SampleParty[];
};

const MUNICIPALITY = { municipalityNumber: "9999", municipalityName: "Prøvekommune" } as const;
const BROKER_FIRM = "Prøvemegleren AS";

export const SAMPLE_ASSIGNMENTS: readonly SampleAssignment[] = [
  {
    externalRef: "sample:detached-garage",
    status: "ordered",
    order: {
      addressText: "Prøvevegen 1, Prøvestad",
      orderedByText: BROKER_FIRM,
      gnr: "101",
      bnr: "1",
      sellerDeclarationReceived: true,
    },
    property: {
      address: "Prøvevegen 1",
      city: "Prøvestad",
      ...MUNICIPALITY,
      housingType: "detached",
      ownershipForm: "freehold",
      gnr: "101",
      bnr: "1",
    },
    commonAreas: null,
    buildings: [
      {
        name: "Bolig",
        yearBuilt: 1978,
        floors: [
          {
            name: "Kjeller",
            level: -1,
            belowGround: true,
            area: { braI: 46.5, braE: 12, method: "laser" },
            rooms: [
              { roomType: "basement_living_room", name: "Kjellerstue", belowGround: true },
              {
                roomType: "laundry",
                name: "Vaskerom",
                belowGround: true,
                yearRenovated: 1994,
              },
              { roomType: "technical_room", name: "Teknisk rom", belowGround: true },
              {
                roomType: "storage",
                name: "Kjellerbod",
                areaType: "bra_e",
                belowGround: true,
              },
            ],
          },
          {
            name: "1. etasje",
            level: 1,
            belowGround: false,
            area: { braI: 72.5, method: "laser" },
            rooms: [
              { roomType: "entrance", name: "Vindfang", belowGround: false },
              { roomType: "living_room", name: "Stue", belowGround: false },
              { roomType: "kitchen", name: "Kjøkken", belowGround: false },
              { roomType: "bathroom", name: "Bad", belowGround: false, yearRenovated: 1998 },
              { roomType: "bedroom", name: "Soverom 1", belowGround: false },
            ],
          },
          {
            name: "2. etasje",
            level: 2,
            belowGround: false,
            area: { braI: 54, method: "laser" },
            rooms: [
              { roomType: "hallway", name: "Gang", belowGround: false },
              { roomType: "bedroom", name: "Soverom 2", belowGround: false },
              { roomType: "bedroom", name: "Soverom 3", belowGround: false },
              { roomType: "toilet", name: "Toalett", belowGround: false },
            ],
          },
        ],
      },
      {
        name: "Garasje",
        yearBuilt: 1985,
        floors: [
          {
            name: "1. etasje",
            level: 1,
            belowGround: false,
            area: { braB: 28, method: "laser" },
            rooms: [{ roomType: "garage", name: "Garasje", areaType: "bra_b", belowGround: false }],
          },
        ],
      },
    ],
    parties: [
      {
        role: "seller",
        name: "Kari Prøve",
        email: "kari.prove@example.invalid",
        receivesReport: true,
        receivesInvoice: false,
        receivesMessages: true,
      },
      {
        role: "broker",
        name: "Ola Testesen",
        firmName: BROKER_FIRM,
        email: "ola.testesen@example.invalid",
        receivesReport: true,
        receivesInvoice: true,
        receivesMessages: true,
      },
    ],
  },
  {
    externalRef: "sample:apartment-section",
    status: "in_progress",
    order: {
      addressText: "Prøvegata 12 B, Prøvestad",
      orderedByText: BROKER_FIRM,
      gnr: "102",
      bnr: "7",
      snr: "3",
      sellerDeclarationReceived: true,
    },
    property: {
      address: "Prøvegata 12 B",
      city: "Prøvestad",
      ...MUNICIPALITY,
      housingType: "apartment",
      ownershipForm: "section",
      gnr: "102",
      bnr: "7",
      snr: "3",
    },
    commonAreas: {
      managingAgent: "Prøveforvaltning AS",
      conditionReportStatus: "yes",
      maintenancePlanStatus: "unknown",
    },
    buildings: [
      {
        name: "Leilighet",
        yearBuilt: 2004,
        floors: [
          {
            name: "Kjeller",
            level: -1,
            belowGround: true,
            area: { braE: 4.5, method: "drawing" },
            rooms: [
              {
                roomType: "external_storage",
                name: "Kjellerbod",
                areaType: "bra_e",
                belowGround: true,
              },
            ],
          },
          {
            name: "3. etasje",
            level: 3,
            belowGround: false,
            area: { braI: 68.4, braB: 7.5, method: "laser" },
            rooms: [
              { roomType: "entrance", name: "Entré", belowGround: false },
              { roomType: "living_kitchen", name: "Stue og kjøkken", belowGround: false },
              { roomType: "bedroom", name: "Soverom 1", belowGround: false },
              { roomType: "bedroom", name: "Soverom 2", belowGround: false },
              { roomType: "bathroom", name: "Bad", belowGround: false },
              {
                roomType: "glazed_balcony",
                name: "Innglasset balkong",
                areaType: "bra_b",
                belowGround: false,
              },
            ],
          },
        ],
      },
    ],
    parties: [
      {
        role: "seller",
        name: "Per Prøvesen",
        email: "per.provesen@example.invalid",
        receivesReport: true,
        receivesInvoice: false,
        receivesMessages: true,
      },
      {
        role: "broker",
        name: "Lise Eksempel",
        firmName: BROKER_FIRM,
        email: "lise.eksempel@example.invalid",
        receivesReport: true,
        receivesInvoice: true,
        receivesMessages: true,
      },
    ],
  },
  {
    externalRef: "sample:apartment-cooperative",
    status: "in_progress",
    order: {
      addressText: "Prøvetunet 4, Prøvestad",
      orderedByText: BROKER_FIRM,
      gnr: "103",
      bnr: "12",
      housingAssociationName: "Borettslaget Prøvetunet",
      sellerDeclarationReceived: false,
    },
    property: {
      address: "Prøvetunet 4",
      city: "Prøvestad",
      ...MUNICIPALITY,
      housingType: "apartment",
      ownershipForm: "cooperative",
      gnr: "103",
      bnr: "12",
      associationName: "Borettslaget Prøvetunet",
      shareNumber: "24",
    },
    commonAreas: {
      managingAgent: "Prøveforvaltning AS",
      conditionReportStatus: "unknown",
      maintenancePlanStatus: "yes",
    },
    buildings: [
      {
        name: "Leilighet",
        yearBuilt: 1968,
        floors: [
          {
            name: "Kjeller",
            level: -1,
            belowGround: true,
            area: { braE: 3.5, method: "drawing" },
            rooms: [
              {
                roomType: "external_storage",
                name: "Kjellerbod",
                areaType: "bra_e",
                belowGround: true,
              },
            ],
          },
          {
            name: "2. etasje",
            level: 2,
            belowGround: false,
            area: { braI: 61, method: "laser" },
            rooms: [
              { roomType: "entrance", name: "Entré", belowGround: false },
              { roomType: "living_room", name: "Stue", belowGround: false },
              { roomType: "kitchen", name: "Kjøkken", belowGround: false },
              { roomType: "bedroom", name: "Soverom", belowGround: false },
              { roomType: "bathroom", name: "Bad", belowGround: false, yearRenovated: 1992 },
            ],
          },
        ],
      },
    ],
    parties: [
      {
        role: "seller",
        name: "Nina Prøvdal",
        email: "nina.provdal@example.invalid",
        receivesReport: true,
        receivesInvoice: false,
        receivesMessages: true,
      },
      {
        role: "broker",
        name: "Ola Testesen",
        firmName: BROKER_FIRM,
        email: "ola.testesen@example.invalid",
        receivesReport: true,
        receivesInvoice: true,
        receivesMessages: true,
      },
      {
        role: "buyer",
        name: "Jon Eksempelsen",
        email: "jon.eksempelsen@example.invalid",
        receivesReport: false,
        receivesInvoice: false,
        receivesMessages: false,
      },
    ],
  },
  {
    externalRef: "sample:holiday-home",
    status: "in_progress",
    order: {
      addressText: "Prøvestien 7, Prøvefjellet",
      orderedByText: BROKER_FIRM,
      gnr: "104",
      bnr: "3",
      sellerDeclarationReceived: true,
    },
    property: {
      address: "Prøvestien 7",
      city: "Prøvefjellet",
      ...MUNICIPALITY,
      housingType: "holiday_home",
      ownershipForm: "freehold",
      gnr: "104",
      bnr: "3",
    },
    commonAreas: null,
    buildings: [
      {
        name: "Hytte",
        yearBuilt: 1992,
        floors: [
          {
            name: "1. etasje",
            level: 1,
            belowGround: false,
            area: { braI: 48, method: "laser" },
            rooms: [
              { roomType: "entrance", name: "Gang", belowGround: false },
              { roomType: "living_kitchen", name: "Stue og kjøkken", belowGround: false },
              { roomType: "bedroom", name: "Soverom", belowGround: false },
              { roomType: "bathroom", name: "Bad", belowGround: false },
            ],
          },
          {
            name: "Hems",
            level: 2,
            belowGround: false,
            area: { braI: 12, alh: 8, method: "laser" },
            rooms: [{ roomType: "attic_living_room", name: "Hems", belowGround: false }],
          },
        ],
      },
      {
        name: "Bod",
        yearBuilt: 1995,
        floors: [
          {
            name: "1. etasje",
            level: 1,
            belowGround: false,
            area: { braE: 6, method: "laser" },
            rooms: [
              {
                roomType: "external_storage",
                name: "Bod",
                areaType: "bra_e",
                belowGround: false,
              },
            ],
          },
        ],
      },
    ],
    parties: [
      {
        role: "seller",
        name: "Eva Testmo",
        email: "eva.testmo@example.invalid",
        receivesReport: true,
        receivesInvoice: false,
        receivesMessages: true,
      },
      {
        role: "broker",
        name: "Lise Eksempel",
        firmName: BROKER_FIRM,
        email: "lise.eksempel@example.invalid",
        receivesReport: true,
        receivesInvoice: true,
        receivesMessages: true,
      },
    ],
  },
];
