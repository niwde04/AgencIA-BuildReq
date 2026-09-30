import { z } from "zod";
import { isProcurementApproverRole } from "./buildreq-roles";

export function canManageCostMatrix(
  user?: { role?: string | null; buildreqRole?: string | null } | null
) {
  return (
    !!user &&
    !isProcurementApproverRole(user.buildreqRole) &&
    (user.role === "admin" || user.buildreqRole === "administracion_central")
  );
}
const code = z.string().trim().min(1, "Ingrese el código").max(20);
const description = z.string().trim().min(1, "Ingrese la descripción").max(500);
export const costMatrixFields = z.object({
  jobCode: code,
  jobName: description,
  n1: code,
  nivel1: description,
  n2: code,
  nivel2: description,
  n3: code,
  nivel3: description,
  n4: code,
  nivel4: description,
  majorGroup: description,
  flowId: code,
  flowActivity: description,
});
export type CostMatrixFields = z.infer<typeof costMatrixFields>;
export function deriveCostMatrix<T extends CostMatrixFields>(entry: T) {
  return {
    ...entry,
    matrixCode: [entry.jobCode, entry.n1, entry.n2, entry.n3, entry.n4].join(
      "-"
    ),
    flow1: `${entry.jobCode} ${entry.jobName}`,
    flow2: `${entry.n1} ${entry.nivel1}`,
    flow3: `${entry.n2} ${entry.nivel2}`,
    flow4: `${entry.n3} ${entry.nivel3}`,
    flow5: `${entry.n4} ${entry.nivel4}`,
  };
}
export const costMatrixListInput = z.object({
  search: z.string().trim().max(200).optional(),
  jobCode: code.optional(),
  n1: code.optional(),
  flowActivity: description.optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
});
export type CostMatrixListInput = z.infer<typeof costMatrixListInput>;
