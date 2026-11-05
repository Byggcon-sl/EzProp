export {
  HOUSING_TYPES,
  OWNERSHIP_FORMS,
  YES_NO_UNKNOWN,
  hasCommonAreas,
  housingTypeLabel,
  ownershipFormLabel,
  yesNoUnknownLabel,
  type HousingType,
  type OwnershipForm,
  type YesNoUnknown,
} from "./codes";
export { CommonAreasNotApplicableError } from "./errors";
export {
  commonAreasInputSchema,
  propertyInputSchema,
  type CommonAreasInput,
  type CommonAreasValues,
  type PropertyInput,
  type PropertyValues,
} from "./schemas";
export {
  getAssignmentProperty,
  saveAssignmentProperty,
  saveCommonAreas,
  type AssignmentProperty,
  type CadastralUnitDetail,
  type CommonAreasDetail,
  type PropertyDetail,
  type PropertyPrefill,
} from "./properties";
