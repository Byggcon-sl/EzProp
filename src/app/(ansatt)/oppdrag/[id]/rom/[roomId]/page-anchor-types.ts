import type { PdfPageAnchor } from "@/core/pdf";
import type { AiTargetRef } from "@/db/schema";

/*
 * Fra et anker i forhåndsvisningen til feltet i skjemaet, og fra et KI-mål til et anker
 * (docs/funksjoner/fase2a-levende-forhandsvisning.md Omfang 3 og «KI i bunnen», A604, A607).
 * Bare typer. Funksjonene bygges i `page-anchor-target.ts` ved siden av `pdf-anchors.ts`, rene og
 * testet, uten DOM.
 *
 * Støtter hovedmål: de ansatte (ett klikk fra siden til feltet) og KI i bunnen (sidekartet er en
 * stabil kobling fra avsnitt til felt som senere KI kan bygge på).
 */

/** Feltet et anker peker på i rommet som vises. */
export type PageAnchorTarget = {
  /** Punktet som skal åpnes. */
  checkpointKey: string;
  /** Avviket som skal åpnes, eller `null`. */
  deviationId: string | null;
  /**
   * Nøkkelen feltet har i lagringskøen (`FieldEntry.key` i `field-save-store.ts`). `null` når
   * ankeret er hele punktet eller hele avviket; da får overskriften fokus, som lenkene fra
   * PDF-utkastet (F4).
   */
  saveKey: string | null;
};

/** Det funksjonen trenger å vite om rommet. Bygges av skjemadataene i klienten. */
export type PageAnchorRoomIndex = {
  /** Punktene i rapportens låste malversjon. Arkiverte punkter står ikke her. */
  checkpointKeyById: ReadonlyMap<string, string>;
  checkpoints: readonly {
    checkpointKey: string;
    /** `field_key` for feltene som vises under punktet. */
    fieldKeys: readonly string[];
    deviations: readonly { id: string }[];
    hasTgiu: boolean;
  }[];
};

/**
 * Sjekker ankeret mot formkravene (`isPdfPageAnchor`) og finner feltet ved oppslag blant rommets
 * kjente punkter, avvik og felt. Ankeret settes aldri inn i en selector eller adresse. Ukjent,
 * arkivert, slettet eller ondsinnet anker, og anker for et annet rom, gir `null`.
 */
export type PageAnchorTargetOf = (
  anchor: unknown,
  room: PageAnchorRoomIndex,
) => PageAnchorTarget | null;

/**
 * Ankeret for et KI-mål (A607). Hver feltkode i `REPORT_AI_TARGET_FIELDS` som kan stå i et rom,
 * har et anker (test). Finnes ikke et eget avsnitt for feltet, gis punktets anker
 * (`kind: "checkpoint"`). `null` bare når målet ikke hører til et punkt i rapporten (for eksempel
 * sammendraget for hele rapporten).
 *
 * | Måltype | Feltkode | `kind` |
 * |---|---|---|
 * | `deviation` | `deviation_text` | `deviation.text` |
 * | `deviation` | `cause_text` | `deviation.cause` |
 * | `deviation` | `consequence_text` | `deviation.consequence` |
 * | `deviation` | `new_measure` | `deviation.measures` |
 * | `deviation_measure` | `text` | `deviation.measures` |
 * | `checkpoint_result` | `description_text` | `checkpoint.description` |
 * | `tgiu_detail` | alle | `tgiu` |
 * | `field_answer` | feltets `field_key` | `checkpoint.answer` |
 */
export type AiTargetPageAnchor = (
  target: AiTargetRef,
  owner: { checkpointId: string; deviationId: string | null },
) => PdfPageAnchor | null;
