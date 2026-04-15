import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, RefreshCw, LogOut } from "lucide-react";

type UnassignedRoleScreenProps = {
  userName?: string | null;
  userEmail?: string | null;
  onRefresh: () => void;
  onLogout: () => Promise<void>;
  isRefreshing?: boolean;
  isLoggingOut?: boolean;
};

export default function UnassignedRoleScreen({
  userName,
  userEmail,
  onRefresh,
  onLogout,
  isRefreshing = false,
  isLoggingOut = false,
}: UnassignedRoleScreenProps) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-xl border border-border bg-card p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 border border-primary/20 flex items-center justify-center">
            <ShieldAlert className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Cuenta pendiente de asignacion
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tu acceso ya funciona, pero aun no tienes un rol de trabajo dentro de BuildReq.
            </p>
          </div>
        </div>

        <div className="border border-border p-4 space-y-2">
          <p className="text-sm">
            <span className="font-semibold">Usuario:</span>{" "}
            {userName || "Sin nombre"}
          </p>
          <p className="text-sm">
            <span className="font-semibold">Correo:</span>{" "}
            {userEmail || "Sin correo"}
          </p>
          <div className="pt-1">
            <Badge variant="outline">Sin rol asignado</Badge>
          </div>
        </div>

        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            Un administrador debe asignarte uno de estos roles para continuar:
            Ingeniero Residente, Jefe de Bodega Central, Administracion Central o
            Administrador del Proyecto.
          </p>
          <p>
            Si entraste por invitacion, usa el boton de actualizar para reintentar cargar tu rol.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={onRefresh}
            disabled={isRefreshing || isLoggingOut}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Actualizar acceso
          </Button>
          <Button
            variant="outline"
            onClick={() => void onLogout()}
            disabled={isRefreshing || isLoggingOut}
            className="gap-2"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesion
          </Button>
        </div>
      </div>
    </div>
  );
}
