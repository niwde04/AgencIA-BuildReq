import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { useProcurementApprovalSettings } from "@/hooks/useProcurementApprovalSettings";
import { Settings2, ShieldCheck, WalletCards, UserCheck } from "lucide-react";
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

  const treasurySettingsQuery = trpc.treasury.settings.useQuery(undefined, {
    enabled: user?.role === "admin",
  });
  const approversQuery = trpc.treasury.approvers.useQuery(undefined, {
    enabled: user?.role === "admin",
  });
  const updateTreasuryMutation = trpc.treasury.updateSettings.useMutation({
    onSuccess: async () => {
      toast.success("Configuración de Tesorería actualizada");
      await Promise.all([
        utils.treasury.settings.invalidate(),
        utils.treasury.list.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  const setApproverMutation = trpc.treasury.setApprover.useMutation({
    onSuccess: async () => {
      toast.success("Aprobador de Tesorería actualizado");
      await Promise.all([
        utils.treasury.approvers.invalidate(),
        utils.treasury.settings.invalidate(),
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <WalletCards className="h-5 w-5" />
            Tesorería y abonos a proveedores
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-6 rounded-lg border p-4">
            <div className="space-y-1">
              <p className="font-medium">Habilitar módulo de Tesorería</p>
              <p className="text-sm text-muted-foreground">
                Activa lotes, abonos parciales, aprobación, conciliación
                bancaria y contabilización de pagos.
              </p>
            </div>
            <Switch
              checked={treasurySettingsQuery.data?.treasuryEnabled === true}
              onCheckedChange={treasuryEnabled =>
                updateTreasuryMutation.mutate({ treasuryEnabled })
              }
              disabled={
                treasurySettingsQuery.isLoading ||
                updateTreasuryMutation.isPending
              }
              aria-label="Habilitar módulo de Tesorería"
            />
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4" />
              <p className="font-medium">Aprobadores autorizados</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Solo los Superintendentes marcados aquí podrán aprobar lotes. Una
              aprobación será suficiente.
            </p>
            {approversQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Cargando superintendentes...
              </p>
            ) : approversQuery.data?.length ? (
              <div className="divide-y rounded-md border">
                {approversQuery.data.map(approver => (
                  <label
                    key={approver.id}
                    className="flex cursor-pointer items-center gap-3 p-3"
                  >
                    <Checkbox
                      checked={approver.isTreasuryApprover}
                      onCheckedChange={checked =>
                        setApproverMutation.mutate({
                          userId: approver.id,
                          isActive: checked === true,
                        })
                      }
                      disabled={setApproverMutation.isPending}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {approver.name || `Usuario ${approver.id}`}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {approver.email || "Sin correo"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No hay usuarios con rol Superintendente.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
