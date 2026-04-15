import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Users as UsersIcon,
  UserPlus,
  Mail,
  Copy,
  X,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Send,
} from "lucide-react";
import { toast } from "sonner";

const ROLE_LABELS: Record<string, string> = {
  ingeniero_residente: "Ing. Residente",
  jefe_bodega_central: "Jefe de Bodega Central",
  administracion_central: "Administración Central",
  administrador_proyecto: "Administrador del Proyecto",
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: any }> = {
  pendiente: { label: "Pendiente", variant: "secondary", icon: Clock },
  aceptada: { label: "Aceptada", variant: "default", icon: CheckCircle2 },
  expirada: { label: "Expirada", variant: "outline", icon: XCircle },
  cancelada: { label: "Cancelada", variant: "destructive", icon: XCircle },
};

export default function Usuarios() {
  const utils = trpc.useUtils();
  const { data: users, isLoading: usersLoading } = trpc.userManagement.list.useQuery();
  const { data: invitationsList, isLoading: invLoading } = trpc.invitations.list.useQuery();
  const { data: projects } = trpc.projects.list.useQuery({ status: "activo" });

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailData, setEmailData] = useState<{ to: string; subject: string; content: string } | null>(null);

  // Form state
  const [invName, setInvName] = useState("");
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState<string>("");
  const [invProject, setInvProject] = useState<string>("");

  const updateRoleMutation = trpc.userManagement.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Rol actualizado");
      utils.userManagement.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const createInvitationMutation = trpc.invitations.create.useMutation({
    onSuccess: (data) => {
      toast.success("Invitación creada exitosamente");
      utils.invitations.list.invalidate();
      setShowInviteDialog(false);
      resetForm();
      // Show email data dialog
      if (data.emailData) {
        setEmailData(data.emailData);
        setShowEmailDialog(true);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const cancelInvitationMutation = trpc.invitations.cancel.useMutation({
    onSuccess: () => {
      toast.success("Invitación cancelada");
      utils.invitations.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const resendInvitationMutation = trpc.invitations.resend.useMutation({
    onSuccess: (data) => {
      if (data.emailData) {
        setEmailData(data.emailData);
        setShowEmailDialog(true);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  function resetForm() {
    setInvName("");
    setInvEmail("");
    setInvRole("");
    setInvProject("");
  }

  function handleCreateInvitation() {
    if (!invName || !invEmail || !invRole) {
      toast.error("Nombre, email y rol son obligatorios");
      return;
    }
    if (
      (invRole === "ingeniero_residente" || invRole === "administrador_proyecto") &&
      !invProject
    ) {
      toast.error("Debe asignar un proyecto a este rol");
      return;
    }
    createInvitationMutation.mutate({
      email: invEmail,
      name: invName,
      buildreqRole: invRole as any,
      assignedProjectId: invProject ? parseInt(invProject) : undefined,
      origin: window.location.origin,
    });
  }

  function copyEmailContent() {
    if (emailData) {
      navigator.clipboard.writeText(emailData.content);
      toast.success("Contenido del email copiado al portapapeles");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Gestión de Usuarios</h1>
        <Button onClick={() => setShowInviteDialog(true)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Invitar Usuario
        </Button>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" className="gap-2">
            <UsersIcon className="h-4 w-4" />
            Usuarios Activos
          </TabsTrigger>
          <TabsTrigger value="invitations" className="gap-2">
            <Mail className="h-4 w-4" />
            Invitaciones
            {(invitationsList || []).filter((i: any) => i.invitation.status === "pendiente").length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                {(invitationsList || []).filter((i: any) => i.invitation.status === "pendiente").length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* USERS TAB */}
        <TabsContent value="users">
          <Card>
            <CardContent className="p-0">
              {usersLoading ? (
                <div className="p-8 text-center text-muted-foreground">Cargando usuarios...</div>
              ) : (users || []).length === 0 ? (
                <div className="p-8 text-center">
                  <UsersIcon className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">No hay usuarios registrados</p>
                  <p className="text-xs text-muted-foreground mt-1">Invite usuarios con el botón superior</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Nombre</th>
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Email</th>
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Rol Sistema</th>
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Rol BuildReq</th>
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Proyecto Asignado</th>
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Último acceso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(users || []).map((u: any) => (
                        <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="p-3 font-medium">{u.name || "—"}</td>
                          <td className="p-3 text-xs text-muted-foreground">{u.email || "—"}</td>
                          <td className="p-3">
                            <Badge variant="outline" className={`text-xs ${u.role === "admin" ? "border-primary text-primary" : ""}`}>
                              {u.role === "admin" ? "Administrador" : "Usuario"}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <Select
                              value={u.buildreqRole || "sin_rol"}
                              onValueChange={(val) => {
                                if (val === "sin_rol") return;
                                updateRoleMutation.mutate({
                                  userId: u.id,
                                  buildreqRole: val as any,
                                  assignedProjectId:
                                    val === "ingeniero_residente" || val === "administrador_proyecto"
                                      ? u.assignedProjectId ?? undefined
                                      : undefined,
                                });
                              }}
                            >
                              <SelectTrigger className="h-8 w-48 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="sin_rol" disabled>Sin rol asignado</SelectItem>
                                <SelectItem value="ingeniero_residente">Ing. Residente</SelectItem>
                                <SelectItem value="jefe_bodega_central">Jefe de Bodega Central</SelectItem>
                                <SelectItem value="administracion_central">Administración Central</SelectItem>
                                <SelectItem value="administrador_proyecto">Administrador del Proyecto</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="p-3">
                            {u.buildreqRole === "ingeniero_residente" ||
                            u.buildreqRole === "administrador_proyecto" ? (
                              <Select
                                value={u.assignedProjectId ? String(u.assignedProjectId) : "none"}
                                onValueChange={(val) => {
                                  if (val === "none") return;
                                  updateRoleMutation.mutate({
                                    userId: u.id,
                                    buildreqRole: (u.buildreqRole || "ingeniero_residente") as any,
                                    assignedProjectId: parseInt(val),
                                  });
                                }}
                              >
                                <SelectTrigger className="h-8 w-44 text-xs">
                                  <SelectValue placeholder="Sin proyecto" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none" disabled>Sin proyecto</SelectItem>
                                  {(projects || []).map((p: any) => (
                                    <SelectItem key={p.id} value={String(p.id)}>{p.code} - {p.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-xs text-muted-foreground">N/A</span>
                            )}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString("es") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* INVITATIONS TAB */}
        <TabsContent value="invitations">
          <Card>
            <CardContent className="p-0">
              {invLoading ? (
                <div className="p-8 text-center text-muted-foreground">Cargando invitaciones...</div>
              ) : (invitationsList || []).length === 0 ? (
                <div className="p-8 text-center">
                  <Mail className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">No hay invitaciones</p>
                  <p className="text-xs text-muted-foreground mt-1">Use el botón "Invitar Usuario" para enviar invitaciones</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Nombre</th>
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Email</th>
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Rol Asignado</th>
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Proyecto</th>
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Estado</th>
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Fecha</th>
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(invitationsList || []).map((item: any) => {
                        const inv = item.invitation;
                        const proj = item.project;
                        const statusCfg = STATUS_CONFIG[inv.status] || STATUS_CONFIG.pendiente;
                        const StatusIcon = statusCfg.icon;
                        return (
                          <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="p-3 font-medium">{inv.name}</td>
                            <td className="p-3 text-xs text-muted-foreground">{inv.email}</td>
                            <td className="p-3">
                              <Badge variant="outline" className="text-xs">
                                {ROLE_LABELS[inv.buildreqRole] || inv.buildreqRole}
                              </Badge>
                            </td>
                            <td className="p-3 text-xs">
                              {proj ? `${proj.code} - ${proj.name}` : <span className="text-muted-foreground">N/A</span>}
                            </td>
                            <td className="p-3">
                              <Badge variant={statusCfg.variant} className="gap-1 text-xs">
                                <StatusIcon className="h-3 w-3" />
                                {statusCfg.label}
                              </Badge>
                            </td>
                            <td className="p-3 text-xs text-muted-foreground">
                              {new Date(inv.createdAt).toLocaleDateString("es")}
                            </td>
                            <td className="p-3">
                              {inv.status === "pendiente" && (
                                <div className="flex gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1"
                                    onClick={() => {
                                      resendInvitationMutation.mutate({
                                        invitationId: inv.id,
                                        origin: window.location.origin,
                                      });
                                    }}
                                  >
                                    <RefreshCw className="h-3 w-3" />
                                    Reenviar
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                                    onClick={() => cancelInvitationMutation.mutate({ invitationId: inv.id })}
                                  >
                                    <X className="h-3 w-3" />
                                    Cancelar
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* INVITE DIALOG */}
      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Invitar Nuevo Usuario
            </DialogTitle>
            <DialogDescription>
              Complete los datos del usuario a invitar. Se generará un enlace de acceso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="inv-name">Nombre completo</Label>
              <Input
                id="inv-name"
                placeholder="Ej: Juan Pérez"
                value={invName}
                onChange={(e) => setInvName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-email">Correo electrónico</Label>
              <Input
                id="inv-email"
                type="email"
                placeholder="Ej: juan@empresa.com"
                value={invEmail}
                onChange={(e) => setInvEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Rol en BuildReq</Label>
              <Select value={invRole} onValueChange={setInvRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar rol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ingeniero_residente">Ing. Residente</SelectItem>
                  <SelectItem value="jefe_bodega_central">Jefe de Bodega Central</SelectItem>
                  <SelectItem value="administracion_central">Administración Central</SelectItem>
                  <SelectItem value="administrador_proyecto">Administrador del Proyecto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(invRole === "ingeniero_residente" || invRole === "administrador_proyecto") && (
              <div className="space-y-2">
                <Label>Proyecto asignado</Label>
                <Select value={invProject} onValueChange={setInvProject}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar proyecto" />
                  </SelectTrigger>
                  <SelectContent>
                    {(projects || []).map((p: any) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.code} - {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowInviteDialog(false); resetForm(); }}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateInvitation}
              disabled={createInvitationMutation.isPending}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {createInvitationMutation.isPending ? "Creando..." : "Crear Invitación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EMAIL DATA DIALOG */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Invitación Creada
            </DialogTitle>
            <DialogDescription>
              Envíe este contenido por correo al usuario invitado.
            </DialogDescription>
          </DialogHeader>
          {emailData && (
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-xs text-muted-foreground">Para:</Label>
                <p className="text-sm font-medium">{emailData.to}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Asunto:</Label>
                <p className="text-sm font-medium">{emailData.subject}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Contenido:</Label>
                <div className="mt-1 p-3 bg-muted rounded-md text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {emailData.content}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={copyEmailContent} className="gap-2">
              <Copy className="h-4 w-4" />
              Copiar Contenido
            </Button>
            <Button onClick={() => setShowEmailDialog(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
