import type { KnownError } from "../action-result";
import {
  DuplicateEmployeeEmailError,
  DuplicateOfficeNameError,
  DuplicateOrgNumberError,
  LastAdminError,
} from "@/core/organization";

/** Feilene fra kjernen som adminområdet viser med egen tekst (sendes til `errorResult`). */
export const ADMIN_ERRORS: readonly KnownError[] = [
  {
    error: DuplicateOrgNumberError,
    field: "orgNumber",
    message: "Det finnes alt et selskap med dette org.nr.",
  },
  {
    error: DuplicateOfficeNameError,
    field: "name",
    message: "Det finnes alt et kontor med dette navnet.",
  },
  {
    error: DuplicateEmployeeEmailError,
    field: "email",
    message: "Det finnes alt en ansatt med denne e-posten.",
  },
  { error: LastAdminError, message: "Organisasjonen må ha minst én admin." },
];
