import { describe, expect, it } from "vitest";
import {
  BUILDREQ_ROLE_LABELS,
  isProcurementApproverRole,
  isProjectScopedRole,
  isSuperintendentFamilyRole,
  requiresProjectAssignment,
} from "@shared/buildreq-roles";
import {
  applyProjectScope,
  canAccessProject,
  getProjectScopeIds,
  hasAllProjectAccess,
} from "./projectAccess";

describe("BuildReq role definitions", () => {
  it.each(["superintendente_aprobador", "gerente"])(
    "treats %s as a project-scoped procurement approver",
    role => {
      expect(isProcurementApproverRole(role)).toBe(true);
      expect(isSuperintendentFamilyRole(role)).toBe(true);
      expect(isProjectScopedRole(role)).toBe(true);
      expect(requiresProjectAssignment(role)).toBe(true);
      expect(BUILDREQ_ROLE_LABELS[role]).toBeTruthy();
    }
  );

  it("keeps the current superintendent in the family without approval rights", () => {
    expect(isSuperintendentFamilyRole("superintendente")).toBe(true);
    expect(isProcurementApproverRole("superintendente")).toBe(false);
  });
});

describe("project access for procurement approvers", () => {
  it.each(["superintendente_aprobador", "gerente"])(
    "does not let base admin bypass the project scope for %s",
    buildreqRole => {
      const user = {
        role: "admin",
        buildreqRole,
        assignedProjectIds: [7, 9],
      };

      expect(hasAllProjectAccess(user)).toBe(false);
      expect(getProjectScopeIds(user)).toEqual([7, 9]);
      expect(canAccessProject(user, 7)).toBe(true);
      expect(canAccessProject(user, 8)).toBe(false);
      expect(applyProjectScope({ projectIds: [7, 8, 9] }, user)).toEqual({
        projectIds: [7, 9],
      });
    }
  );

  it("preserves global access for a base admin without a scoped functional role", () => {
    const user = { role: "admin", buildreqRole: null };

    expect(hasAllProjectAccess(user)).toBe(true);
    expect(getProjectScopeIds(user)).toBeUndefined();
    expect(canAccessProject(user, 123)).toBe(true);
  });
});
