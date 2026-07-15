import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { useProcurementApprovalSettings } from "@/hooks/useProcurementApprovalSettings";
import { Settings2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export default function Configuracion() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const {
    data: settings,
    isLoading,
    purchaseRequestApprovalsEnabled,
    purchaseOrderApprovalsEnabled,
  } = useProcurementApprovalSettings();

  const updateMutation =
    trpc.systemSettings.updateProcurementApprovals.useMutation({
      onSuccess: async () => {
        toast.success("Configuración de aprobaciones actualizada");
        await Promise.all([
          utils.systemSettings.procurementApprovals.invalidate(),
          utils.purchaseRequests.list.invalidate(),
          utils.purchaseOrders.list.invalidate(),
          utils.dashboard.sidebarCounts.invalidate(),
          utils.dashboard.stats.invalidate(),
        ]);
      },
      onError: error => toast.error(error.message),
    });

  if (user?.role !== "admin") {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <p className="text-muted-foreground">
          No tiene permisos para acceder a esta configuración.
        </p>
      </div>
    );
  }

  const updateApprovalSetting = (
    setting:
      | "purchaseRequestApprovalsEnabled"
      | "purchaseOrderApprovalsEnabled",
    enabled: boolean
  ) => {
    if (!settings || updateMutation.isPending) return;
    updateMutation.mutate({
      purchaseRequestApprovalsEnabled:
        setting === "purchaseRequestApprovalsEnabled"
          ? enabled
          : purchaseRequestApprovalsEnabled,
      purchaseOrderApprovalsEnabled:
        setting === "purchaseOrderApprovalsEnabled"
          ? enabled
          : purchaseOrderApprovalsEnabled,
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2">
          <Settings2 className="h-6 w-6" />
          Configuración
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Controles globales disponibles únicamente para el administrador del
          sistema.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5" />
            Aprobaciones de compras
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-6 rounded-lg border p-4">
            <div className="space-y-1">
              <p className="font-medium">Aprobar Solicitudes de Compra</p>
              <p className="text-sm text-muted-foreground">
                Exige aprobación antes de convertir una SC en OC.
              </p>
            </div>
            <Switch
              checked={purchaseRequestApprovalsEnabled}
              onCheckedChange={enabled =>
                updateApprovalSetting(
                  "purchaseRequestApprovalsEnabled",
                  enabled
                )
              }
              disabled={isLoading || updateMutation.isPending}
              aria-label="Activar aprobaciones de solicitudes de compra"
            />
          </div>

          <div className="flex items-center justify-between gap-6 rounded-lg border p-4">
            <div className="space-y-1">
              <p className="font-medium">Aprobar Órdenes de Compra</p>
              <p className="text-sm text-muted-foreground">
                Exige aprobación para OC que superen el límite configurado.
              </p>
            </div>
            <Switch
              checked={purchaseOrderApprovalsEnabled}
              onCheckedChange={enabled =>
                updateApprovalSetting("purchaseOrderApprovalsEnabled", enabled)
              }
              disabled={isLoading || updateMutation.isPending}
              aria-label="Activar aprobaciones de órdenes de compra"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
