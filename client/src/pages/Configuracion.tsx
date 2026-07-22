import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { useProcurementApprovalSettings } from "@/hooks/useProcurementApprovalSettings";
import { Settings2, ShieldCheck, WalletCards, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

function parseApprovalMinimum(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export default function Configuracion() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const {
    data: settings,
    isLoading,
    purchaseRequestApprovalsEnabled,
  } = useProcurementApprovalSettings();
  const [orderApprovalsEnabled, setOrderApprovalsEnabled] = useState(false);
  const [minimumHnl, setMinimumHnl] = useState("");
  const [minimumUsd, setMinimumUsd] = useState("");
  const [purchaseOrderSettingsDirty, setPurchaseOrderSettingsDirty] =
    useState(false);

  useEffect(() => {
    if (!settings || purchaseOrderSettingsDirty) return;
    setOrderApprovalsEnabled(settings.purchaseOrderApprovalsEnabled);
    setMinimumHnl(settings.purchaseOrderApprovalMinimumHnl.toFixed(2));
    setMinimumUsd(settings.purchaseOrderApprovalMinimumUsd.toFixed(2));
  }, [settings, purchaseOrderSettingsDirty]);

  const invalidateApprovalQueries = async () => {
    await Promise.all([
      utils.systemSettings.procurementApprovals.invalidate(),
      utils.purchaseRequests.list.invalidate(),
      utils.purchaseRequests.listPage.invalidate(),
      utils.purchaseOrders.list.invalidate(),
      utils.purchaseOrders.listPage.invalidate(),
      utils.purchaseOrders.getById.invalidate(),
      utils.dashboard.sidebarCounts.invalidate(),
      utils.dashboard.stats.invalidate(),
    ]);
  };

  const updatePurchaseRequestMutation =
    trpc.systemSettings.updatePurchaseRequestApprovals.useMutation({
      onSuccess: async () => {
        toast.success("Configuración de solicitudes actualizada");
        await invalidateApprovalQueries();
      },
      onError: error => toast.error(error.message),
    });

  const updatePurchaseOrderMutation =
    trpc.systemSettings.updatePurchaseOrderApprovals.useMutation({
      onSuccess: async updatedSettings => {
        setOrderApprovalsEnabled(updatedSettings.purchaseOrderApprovalsEnabled);
        setMinimumHnl(
          updatedSettings.purchaseOrderApprovalMinimumHnl.toFixed(2)
        );
        setMinimumUsd(
          updatedSettings.purchaseOrderApprovalMinimumUsd.toFixed(2)
        );
        setPurchaseOrderSettingsDirty(false);
        toast.success("Configuración de órdenes de compra actualizada");
        await invalidateApprovalQueries();
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

  if (user?.role !== "admin") {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <p className="text-muted-foreground">
          No tiene permisos para acceder a esta configuración.
        </p>
      </div>
    );
  }

  const minimumHnlValue = parseApprovalMinimum(minimumHnl);
  const minimumUsdValue = parseApprovalMinimum(minimumUsd);
  const purchaseOrderSettingsValid =
    minimumHnlValue !== null && minimumUsdValue !== null;

  const savePurchaseOrderSettings = () => {
    if (
      !settings ||
      updatePurchaseOrderMutation.isPending ||
      minimumHnlValue === null ||
      minimumUsdValue === null
    ) {
      return;
    }
    updatePurchaseOrderMutation.mutate({
      purchaseOrderApprovalsEnabled: orderApprovalsEnabled,
      purchaseOrderApprovalMinimumHnl: minimumHnlValue,
      purchaseOrderApprovalMinimumUsd: minimumUsdValue,
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
                updatePurchaseRequestMutation.mutate({
                  purchaseRequestApprovalsEnabled: enabled,
                })
              }
              disabled={isLoading || updatePurchaseRequestMutation.isPending}
              aria-label="Activar aprobaciones de solicitudes de compra"
            />
          </div>

          <div className="space-y-5 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-6">
              <div className="space-y-1">
                <p className="font-medium">Aprobar Órdenes de Compra</p>
                <p className="text-sm text-muted-foreground">
                  Exige aprobación cuando una OC alcanza el monto mínimo
                  configurado para su moneda.
                </p>
              </div>
              <Switch
                checked={orderApprovalsEnabled}
                onCheckedChange={enabled => {
                  setOrderApprovalsEnabled(enabled);
                  setPurchaseOrderSettingsDirty(true);
                }}
                disabled={isLoading || updatePurchaseOrderMutation.isPending}
                aria-label="Activar aprobaciones de órdenes de compra"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="purchase-order-minimum-hnl">
                  Monto mínimo en lempiras
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-muted-foreground">
                    L
                  </span>
                  <Input
                    id="purchase-order-minimum-hnl"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    className="pl-8"
                    value={minimumHnl}
                    onChange={event => {
                      setMinimumHnl(event.target.value);
                      setPurchaseOrderSettingsDirty(true);
                    }}
                    disabled={
                      isLoading || updatePurchaseOrderMutation.isPending
                    }
                    aria-invalid={
                      purchaseOrderSettingsDirty && minimumHnlValue === null
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="purchase-order-minimum-usd">
                  Monto mínimo en dólares
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-muted-foreground">
                    USD
                  </span>
                  <Input
                    id="purchase-order-minimum-usd"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    className="pl-14"
                    value={minimumUsd}
                    onChange={event => {
                      setMinimumUsd(event.target.value);
                      setPurchaseOrderSettingsDirty(true);
                    }}
                    disabled={
                      isLoading || updatePurchaseOrderMutation.isPending
                    }
                    aria-invalid={
                      purchaseOrderSettingsDirty && minimumUsdValue === null
                    }
                  />
                </div>
              </div>
            </div>

            {purchaseOrderSettingsDirty && !purchaseOrderSettingsValid ? (
              <p className="text-sm text-destructive">
                Ingrese montos válidos, mayores o iguales a cero y con máximo
                dos decimales.
              </p>
            ) : null}

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={savePurchaseOrderSettings}
                disabled={
                  isLoading ||
                  updatePurchaseOrderMutation.isPending ||
                  !purchaseOrderSettingsDirty ||
                  !purchaseOrderSettingsValid
                }
              >
                {updatePurchaseOrderMutation.isPending
                  ? "Guardando..."
                  : "Guardar configuración"}
              </Button>
            </div>
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
              Todos los usuarios con rol Financiero pueden aprobar lotes de
              Tesorería. El rol se asigna desde la administración de usuarios.
            </p>
            {approversQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Cargando usuarios financieros...
              </p>
            ) : approversQuery.data?.length ? (
              <div className="divide-y rounded-md border">
                {approversQuery.data.map(approver => (
                  <div
                    key={approver.id}
                    className="flex items-center gap-3 p-3"
                  >
                    <UserCheck className="h-4 w-4 text-primary" />
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {approver.name || `Usuario ${approver.id}`}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {approver.email || "Sin correo"}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No hay usuarios con rol Financiero. Asigne el rol antes de
                enviar lotes a aprobación.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
