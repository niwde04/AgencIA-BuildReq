import { trpc } from "@/lib/trpc";
import { setRuntimeProcurementApprovalSettings } from "@shared/procurement-approvals";

export function useProcurementApprovalSettings() {
  const query = trpc.systemSettings.procurementApprovals.useQuery();
  if (query.data) setRuntimeProcurementApprovalSettings(query.data);

  return {
    ...query,
    purchaseRequestApprovalsEnabled:
      query.data?.purchaseRequestApprovalsEnabled ?? false,
    purchaseOrderApprovalsEnabled:
      query.data?.purchaseOrderApprovalsEnabled ?? false,
  };
}
