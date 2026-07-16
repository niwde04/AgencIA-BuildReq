export const BUILDREQ_ROLE_CODES = [
  "ingeniero_residente",
  "jefe_bodega_central",
  "administracion_central",
  "administrador_proyecto",
  "bodeguero_proyecto",
  "superintendente",
  "superintendente_aprobador",
  "gerente",
  "contable",
] as const;

export type BuildReqRole = (typeof BUILDREQ_ROLE_CODES)[number];

const buildreqRoleLabels = {
  ingeniero_residente: "Requiriente",
  jefe_bodega_central: "Bodega Central",
  administracion_central: "Administración Central",
  administrador_proyecto: "Administración Proyecto",
  bodeguero_proyecto: "Bodega Proyecto",
  superintendente: "Superintendente",
  superintendente_aprobador: "Superintendente Aprobador",
  gerente: "Gerente",
  contable: "Contable",
} as const satisfies Record<BuildReqRole, string>;

export const BUILDREQ_ROLE_LABELS: Readonly<Record<string, string>> =
  buildreqRoleLabels;

export const BUILDREQ_ROLE_OPTIONS = BUILDREQ_ROLE_CODES.map(value => ({
  value,
  label: buildreqRoleLabels[value],
}));

export const SUPERINTENDENT_FAMILY_ROLES: ReadonlySet<string> = new Set([
  "superintendente",
  "superintendente_aprobador",
  "gerente",
]);

export const PROCUREMENT_APPROVER_ROLES: ReadonlySet<string> = new Set([
  "superintendente_aprobador",
  "gerente",
]);

export const PROJECT_SCOPED_ROLES: ReadonlySet<string> = new Set([
  "ingeniero_residente",
  "administrador_proyecto",
  "bodeguero_proyecto",
  "superintendente",
  "superintendente_aprobador",
  "gerente",
]);

export const PROJECT_REQUIRED_ROLES: ReadonlySet<string> = new Set(
  PROJECT_SCOPED_ROLES
);

export const PROJECT_MANAGER_ASSIGNABLE_ROLES: ReadonlySet<string> = new Set([
  "ingeniero_residente",
  "bodeguero_proyecto",
  "superintendente",
]);

export function isBuildReqRole(value?: string | null): value is BuildReqRole {
  return Boolean(
    value && (BUILDREQ_ROLE_CODES as readonly string[]).includes(value)
  );
}

export function getBuildReqRoleLabel(value?: string | null) {
  if (!value) return "Sin rol asignado";
  return BUILDREQ_ROLE_LABELS[value] ?? value;
}

export function isSuperintendentFamilyRole(value?: string | null) {
  return Boolean(value && SUPERINTENDENT_FAMILY_ROLES.has(value));
}

export function isProcurementApproverRole(value?: string | null) {
  return Boolean(value && PROCUREMENT_APPROVER_ROLES.has(value));
}

export function isProjectScopedRole(value?: string | null) {
  return Boolean(value && PROJECT_SCOPED_ROLES.has(value));
}

export function canCreateProjectSubprojects(
  user?: {
    role?: string | null;
    buildreqRole?: string | null;
  } | null
) {
  return Boolean(
    user?.role === "admin" || user?.buildreqRole === "administracion_central"
  );
}

export function requiresAssignedProject(value?: string | null) {
  return Boolean(value && PROJECT_REQUIRED_ROLES.has(value));
}

export const requiresProjectAssignment = requiresAssignedProject;
