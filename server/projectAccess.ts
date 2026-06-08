import type { BuildReqRole } from "./db";

export type ProjectScopedUser = {
  role: string;
  buildreqRole?: BuildReqRole | string | null;
  assignedProjectId?: number | null;
  assignedProjectIds?: number[] | null;
};

const PROJECT_ASSIGNABLE_ROLES = new Set([
  "ingeniero_residente",
  "administrador_proyecto",
  "bodeguero_proyecto",
  "superintendente",
]);

export function isProjectAssignableRole(role?: string | null) {
  return Boolean(role && PROJECT_ASSIGNABLE_ROLES.has(role));
}

export function getAssignedProjectIds(user?: ProjectScopedUser | null) {
  if (!user) return [];
  const ids =
    Array.isArray(user.assignedProjectIds) && user.assignedProjectIds.length > 0
      ? user.assignedProjectIds
      : user.assignedProjectId
        ? [user.assignedProjectId]
        : [];

  return Array.from(
    new Set(
      ids
        .map(id => Number(id))
        .filter((id): id is number => Number.isInteger(id) && id > 0)
    )
  );
}

export function hasAllProjectAccess(user?: ProjectScopedUser | null) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.buildreqRole === "administrador_proyecto") return false;
  return !isProjectAssignableRole(user.buildreqRole);
}

export function canAccessProject(
  user: ProjectScopedUser | null | undefined,
  projectId?: number | null
) {
  if (!projectId) return false;
  if (hasAllProjectAccess(user)) return true;
  return getAssignedProjectIds(user).includes(projectId);
}

export function getProjectScopeIds(user: ProjectScopedUser) {
  return hasAllProjectAccess(user) ? undefined : getAssignedProjectIds(user);
}

export function applyProjectScope<
  T extends { projectId?: number | null; projectIds?: number[] | null },
>(filters: T | undefined, user: ProjectScopedUser): T {
  const scopedIds = getProjectScopeIds(user);
  const next = { ...(filters ?? {}) } as T;

  if (scopedIds === undefined) {
    return next;
  }

  if (typeof next.projectId === "number") {
    next.projectIds = scopedIds.includes(next.projectId) ? [next.projectId] : [];
    return next;
  }

  if (Array.isArray(next.projectIds)) {
    next.projectIds = next.projectIds.filter(projectId =>
      scopedIds.includes(projectId)
    );
    return next;
  }

  next.projectIds = scopedIds;
  return next;
}
