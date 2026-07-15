import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { KeyRound, Loader2, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getBuildReqRoleLabel } from "@shared/buildreq-roles";

type ProfileUser = {
  id: number;
  name?: string | null;
  email?: string | null;
  role: string;
  buildreqRole?: string | null;
  assignedProjectId?: number | null;
  assignedProjectIds?: number[] | null;
  assignedProjects?: Array<{ id: number; code: string; name: string }>;
};

type UserProfileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: ProfileUser | null | undefined;
  onOpenPassword: () => void;
};

export function UserProfileDialog({
  open,
  onOpenChange,
  user,
  onOpenPassword,
}: UserProfileDialogProps) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(user?.name ?? "");
      setError(null);
    }
  }, [open, user?.name]);

  const updateProfileMutation = trpc.userManagement.updateProfileName.useMutation({
    onSuccess: () => {
      toast.success("Perfil actualizado");
      void Promise.all([
        utils.auth.me.invalidate(),
        utils.userManagement.list.invalidate(),
      ]);
      onOpenChange(false);
    },
    onError: (mutationError) => {
      setError(mutationError.message);
    },
  });

  const systemRoleLabel = user?.role === "admin" ? "Administrador" : "Usuario";
  const buildReqRoleLabel = getBuildReqRoleLabel(user?.buildreqRole);
  const projectLabel = useMemo(() => {
    const assignedProjectIds =
      Array.isArray(user?.assignedProjectIds) && user.assignedProjectIds.length > 0
        ? user.assignedProjectIds
        : user?.assignedProjectId
          ? [user.assignedProjectId]
          : [];
    const assignedProjects = user?.assignedProjects ?? [];

    if (assignedProjects.length > 0) {
      return assignedProjects
        .map((project) => `${project.code} - ${project.name}`)
        .join(", ");
    }
    if (assignedProjectIds.length > 0) {
      return assignedProjectIds.map((projectId) => `Proyecto #${projectId}`).join(", ");
    }
    return "N/A";
  }, [
    user?.assignedProjectId,
    user?.assignedProjectIds,
    user?.assignedProjects,
    user?.buildreqRole,
  ]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("El nombre no puede quedar vacio.");
      return;
    }

    updateProfileMutation.mutate({ name: trimmedName });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5" />
            Mi perfil
          </DialogTitle>
          <DialogDescription>
            Consulta tus datos y actualiza tu nombre o contraseña.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Nombre</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-3 text-sm">
            <div className="space-y-1">
              <Label>Correo</Label>
              <div className="border border-border bg-muted/30 px-3 py-2 text-muted-foreground">
                {user?.email || "Sin correo"}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Rol de sistema</Label>
              <div className="border border-border bg-muted/30 px-3 py-2 text-muted-foreground">
                {systemRoleLabel}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Rol BuildReq</Label>
              <div className="border border-border bg-muted/30 px-3 py-2 text-muted-foreground">
                {buildReqRoleLabel}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Proyectos asignados</Label>
              <div className="border border-border bg-muted/30 px-3 py-2 text-muted-foreground">
                {projectLabel}
              </div>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                onOpenPassword();
              }}
              className="gap-2"
            >
              <KeyRound className="h-4 w-4" />
              Cambiar contraseña
            </Button>
            <Button type="submit" disabled={updateProfileMutation.isPending}>
              {updateProfileMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
