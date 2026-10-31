export { createCompany, listCompanies, updateCompany } from "./companies";
export { createOffice, listOffices, updateOffice } from "./offices";
export { findAdminOrganizationId, listEmployees } from "./employees";
export {
  createEmployee,
  deactivateEmployee,
  getEmployeeForAdmin,
  listEmployeesForAdmin,
  reactivateEmployee,
  setEmployeeRoles,
  updateEmployee,
  type AdminEmployee,
} from "./employees-admin";
export { grantEmployeePermission, revokeEmployeePermission } from "./employee-permissions";
export {
  DuplicateEmployeeEmailError,
  DuplicateOfficeNameError,
  DuplicateOrgNumberError,
  LastAdminError,
} from "./errors";
export {
  companyInputSchema,
  employeeCreateSchema,
  employeeRolesSchema,
  employeeUpdateSchema,
  officeInputSchema,
  type CompanyInput,
  type EmployeeCreateInput,
  type EmployeeUpdateInput,
  type OfficeInput,
} from "./schemas";

// Sertifisering: datoregelen (fase0b-sertifisering, bit 1)
export {
  CERTIFICATION_AREA_KEYS,
  CERTIFICATION_AREAS,
  EXPIRING_SOON_DAYS,
  certificationStatus,
  expiresWithin,
  isCertificationValid,
  type CertificationArea,
  type CertificationStatus,
} from "./certification-rules";
