import type { AssignmentStatus, PartyInput, PartyRole } from "@/core/assignments";
import type { AreaType, MeasuringMethod, RoomType } from "@/core/buildings";
import type { ClaimOutcome, ClaimType } from "@/core/claims";
import type { FirmType } from "@/core/contacts";
import type { OrderInput } from "@/core/orders";
import type { CertificationArea } from "@/core/organization/certification-rules";
import type {
  CommonAreasInput,
  HousingType,
  OwnershipForm,
  PropertyInput,
} from "@/core/properties";
import type { WorkPhase } from "@/core/work-sessions/phase";
import type { EmployeeRole } from "@/db/schema";
import type { SEED_COMPANIES, SEED_OFFICES } from "./run";

/*
 * Kontrakten for testdataplanen (docs/funksjoner/fase2a-testdata-arbeidshverdag.md). Planen lages
 * av den rene `buildTestdataPlan` (`testdata-plan.ts`) og skrives av `seedTestdata` (`testdata.ts`).
 * Hvert element har en stabil `key` som seed-steget kjenner raden igjen på. Alle tidspunkter er
 * regnet fra ankeret; rene datoer er `YYYY-MM-DD`.
 *
 * Feltene har samme form som tjenestenes Zod-skjemaer tar (ordre, eiendom, fellesdeler, bygning,
 * etasje, areal, rom, part, kontakt, firma og reklamasjon). Id-er finnes ikke i planen: seed-steget
 * slår dem opp fra nøklene (`contactKey`, `firmKey`, `responsibleKey` osv.).
 */

/** Rollene en oppdiktet ansatt kan ha. Aldri admin (A304). */
export type TestdataRole = Exclude<EmployeeRole, "admin">;
export type TestdataCompanyName = (typeof SEED_COMPANIES)[number];
export type TestdataOfficeName = (typeof SEED_OFFICES)[number];

/** Sertifisering med oppdiktet utsteder og nummer (A307). Datoene er `YYYY-MM-DD`. */
export type TestdataCertification = {
  area: CertificationArea;
  issuer: string;
  certificateNumber: string;
  validFrom: string | null;
  /** Siste gyldige dag. */
  validTo: string;
};

export type TestdataEmployee = {
  /** Lik e-posten. */
  key: string;
  name: string;
  email: string;
  phone: string;
  companyLegalName: TestdataCompanyName;
  officeName: TestdataOfficeName;
  roles: readonly TestdataRole[];
  certification: TestdataCertification | null;
};

export type TestdataFirm = {
  /** `navn|firmType`. */
  key: string;
  name: string;
  firmType: FirmType;
  /** Alltid tomt (A301). */
  orgNumber: null;
};

export type TestdataContact = {
  /** Lik e-posten. */
  key: string;
  firstName: string;
  lastName: string;
  /** Fullt navn, slik det står på partene. */
  name: string;
  email: string;
  phone: string;
  firmKey: string | null;
  /** Hva kontakten er. Bare meglere i dag. */
  roleHint: "broker";
};

/** Ordrefeltene til `createOrder`. `externalRef`, `receivedAt` og bestilleren står på ordren. */
export type TestdataOrderFields = {
  addressText: string;
  orderedByText: string;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
  housingAssociationName: string | null;
  sellerDeclarationReceived: boolean;
};

/** En part på oppdraget. `contactKey` peker på en kontakt i planen (megleren), ellers `null`. */
export type TestdataParty = {
  role: PartyRole;
  name: string;
  firmName: string | null;
  email: string;
  phone: string;
  receivesReport: boolean;
  receivesInvoice: boolean;
  receivesMessages: boolean;
  contactKey: string | null;
};

/** Eiendommen med én matrikkelrad. `buildYear` har ingen kolonne ennå (A300). */
export type TestdataProperty = PropertyInput & {
  /** `kommunenummer-gnr-bnr-fnr-snr` (tomme deler er tomme). */
  key: string;
  address: string;
  postalCode: string;
  city: string;
  municipalityNumber: string;
  municipalityName: string;
  housingType: HousingType;
  ownershipForm: OwnershipForm;
  gnr: string;
  bnr: string;
  fnr: string | null;
  snr: string | null;
  associationName: string | null;
  associationOrgNumber: null;
  shareNumber: string | null;
  /** Bare i planen (A300). */
  buildYear: number;
};

export type TestdataRoom = {
  roomType: RoomType;
  name: string;
  /** Alltid `suggestAreaType(roomType)`. */
  areaType: AreaType;
  /** Alltid `suggestBelowGround` fra romtypen og etasjen. */
  belowGround: boolean;
  /** Året rommet sist ble bygget om. Bare i planen (A300). */
  yearRenovated: number | null;
};

/** Arealet i etasjen. «Målt av» settes av seed-steget til ansvarlig takstmann. */
export type TestdataFloorArea = {
  braI: number | null;
  braE: number | null;
  braB: number | null;
  alh: number | null;
  method: MeasuringMethod;
};

export type TestdataFloor = {
  name: string;
  level: number;
  belowGround: boolean;
  /** `null` når etasjen ikke er målt (kryperom). */
  area: TestdataFloorArea | null;
  rooms: readonly TestdataRoom[];
};

export type TestdataBuilding = {
  name: string;
  floors: readonly TestdataFloor[];
};

/** En arbeidsøkt. Bare befaring og kontorarbeid (rapportskriving). */
export type TestdataWorkSession = {
  employeeKey: string;
  phase: Extract<WorkPhase, "inspection" | "office">;
  startedAt: Date;
  endedAt: Date;
};

/** Ett statusbytte, i rekkefølge fra bestilt. */
export type TestdataStatusChange = {
  toStatus: Exclude<AssignmentStatus, "ordered">;
  at: Date;
};

export type TestdataClaim = {
  /** Leder som registrerer saken. */
  createdByKey: string;
  claimType: ClaimType;
  /** Datoen kravet kom (`YYYY-MM-DD`), etter at oppdraget ble ferdig. */
  receivedAt: string;
  /** Når saken ble registrert (hendelsen og `created_at` i domenet). */
  registeredAt: Date;
  /** Klageren er parten med denne rollen på oppdraget. */
  claimantPartyRole: Extract<PartyRole, "buyer">;
  description: string;
  buildingPartText: string;
  outcome: ClaimOutcome;
  /** Bare ved medhold og forlik, og da over 0. */
  amount: number | null;
  /** Når saken ble lukket; `null` for åpen sak. */
  closedAt: Date | null;
};

export type TestdataAssignment = {
  /** Statusen oppdraget skal ende i, nådd gjennom gyldige bytter. */
  status: AssignmentStatus;
  /** Når ordren ble gjort om til oppdrag (status bestilt). */
  convertedAt: Date;
  /** Byttene etter bestilt, i økende tid. */
  statusTimes: readonly TestdataStatusChange[];
  inspectionAt: Date | null;
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
  /** Kort internt notat i arbeidskøen. */
  internalNote: string | null;
  officeName: TestdataOfficeName;
  responsibleKey: string;
  /** Sidemann (`peer_reviewer`). Aldri lik ansvarlig. */
  secondKey: string;
  parties: readonly TestdataParty[];
  property: TestdataProperty;
  /** Bare for sameie og borettslag. */
  commonAreas: CommonAreasInput | null;
  /** Bare på befarte oppdrag (befaring før ankeret). */
  buildings: readonly TestdataBuilding[];
  /** Bare på ferdige og fakturerte oppdrag. */
  workSessions: readonly TestdataWorkSession[];
  claim: TestdataClaim | null;
};

export type TestdataOrder = {
  /** Lik `externalRef`. */
  key: string;
  /** `TD-0001` osv. */
  externalRef: string;
  receivedAt: Date;
  /** Kontoransatt som lager ordren (og gjør den om). */
  createdByKey: string;
  /** Bestilleren i kontaktregisteret, eller `null` ved privat bestilling. */
  orderedByContactKey: string | null;
  fields: TestdataOrderFields;
  converted: false | { assignment: TestdataAssignment };
};

export type TestdataPlan = {
  anchor: Date;
  employees: TestdataEmployee[];
  firms: TestdataFirm[];
  contacts: TestdataContact[];
  orders: TestdataOrder[];
};

// Kontrollerer at planen kan sendes rett til tjenestene (feiler ved kompilering ellers).
type Assignable<T extends U, U> = T;
export type _OrderFieldsFit = Assignable<TestdataOrderFields, OrderInput>;
export type _PartyFits = Assignable<Omit<TestdataParty, "contactKey">, PartyInput>;
