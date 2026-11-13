export {
  CONTACT_SOURCES,
  FIRM_TYPES,
  contactSourceLabel,
  firmTypeLabel,
  type ContactSource,
  type FirmType,
} from "./codes";
export { createContact, getContact, listContacts, updateContact } from "./contacts";
export {
  ContactNotFoundError,
  FirmDuplicateError,
  FirmNotFoundError,
  MergeSameRecordError,
} from "./errors";
export { createFirm, getFirm, listFirms, updateFirm } from "./firms";
export { findContactForLink } from "./link";
export {
  getContactUsage,
  getFirmUsage,
  getRemovedContactName,
  getRemovedFirmName,
  type ContactUsage,
  type FirmUsage,
} from "./merge-view";
export {
  mergeContacts,
  mergeFirms,
  removeContact,
  removeFirm,
  type MergeInput,
} from "./remove-merge";
export { isValidOrgNumber, normalizeOrgNumber } from "./org-number";
export {
  contactInputSchema,
  firmInputSchema,
  type ContactInput,
  type ContactValues,
  type FirmInput,
  type FirmValues,
} from "./schemas";
export { type ListOptions } from "./search";
