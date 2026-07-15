import { useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getAppSiteUrl } from "@/lib/supabase";
import { buildDatedExcelFileName, downloadExcel } from "@/lib/excel-export";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  KeyRound,
  Pencil,
  Eye,
  EyeOff,
  ChevronDown,
  Download,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import {
  BUILDREQ_ROLE_LABELS,
  BUILDREQ_ROLE_OPTIONS,
  PROJECT_MANAGER_ASSIGNABLE_ROLES,
  PROJECT_REQUIRED_ROLES,
  isProjectScopedRole,
} from "@shared/buildreq-roles";

const ROLE_LABELS = BUILDREQ_ROLE_LABELS;
const ROLE_OPTIONS = [...BUILDREQ_ROLE_OPTIONS];

const nameCollator = new Intl.Collator("es-HN", {
  numeric: true,
  sensitivity: "base",
});

function compareUsersByName(a: any, b: any) {
  const nameCompare = nameCollator.compare(a.name ?? "", b.name ?? "");
  if (nameCompare !== 0) return nameCompare;
  return nameCollator.compare(a.email ?? "", b.email ?? "");
}

function compareProjectsByCode(a: any, b: any) {
  const codeCompare = nameCollator.compare(a.code ?? "", b.code ?? "");
  if (codeCompare !== 0) return codeCompare;
  return nameCollator.compare(a.name ?? "", b.name ?? "");
}

function canAssignAllProjects(role?: string | null) {
  return false;
}

function isProjectAssignableRole(role?: string | null) {
  return isProjectScopedRole(role);
}

function normalizeProjectIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((projectId) => Number(projectId))
        .filter((projectId) => Number.isInteger(projectId) && projectId > 0)
    )
  );
}

function getAssignedProjectIds(entity: any) {
  const assignedProjectIds = normalizeProjectIds(entity?.assignedProjectIds);
  if (assignedProjectIds.length > 0) return assignedProjectIds;
  return entity?.assignedProjectId ? [Number(entity.assignedProjectId)] : [];
}

function getAssignedProjectIdsPayload(role: string, projectIds: number[]) {
  return isProjectAssignableRole(role) ? normalizeProjectIds(projectIds) : undefined;
}

function formatAssignedProjects(entity: any) {
  const assignedProjects = Array.isArray(entity?.assignedProjects)
    ? entity.assignedProjects
    : [];
  if (assignedProjects.length > 0) {
    return assignedProjects.map((project: any) => `${project.code} - ${project.name}`).join(", ");
  }
  const ids = getAssignedProjectIds(entity);
  if (ids.length > 0) return ids.map((projectId) => `Proyecto #${projectId}`).join(", ");
  if (isProjectAssignableRole(entity?.buildreqRole)) {
    return "Sin proyectos asignados";
  }
  return "N/A";
}

function normalizeSearchValue(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getUserSearchText(user: any) {
  const assignedProjects = Array.isArray(user?.assignedProjects)
    ? user.assignedProjects
    : [];

  return [
    user?.name,
    user?.email,
    user?.role === "admin" ? "Administrador" : "Usuario",
    ROLE_LABELS[user?.buildreqRole],
    user?.buildreqRole,
    formatAssignedProjects(user),
    user?.mustChangePassword ? "Cambio pendiente" : null,
    user?.lastSignedIn ? new Date(user.lastSignedIn).toLocaleDateString("es") : null,
    ...assignedProjects.flatMap((project: any) => [project?.code, project?.name]),
  ].join(" ");
}

function canManageUserAccounts(user: any) {
  return (
    user?.role === "admin" ||
    user?.buildreqRole === "administracion_central"
  );
}

function canManageListedUser(manager: any, target: any) {
  if (!canManageUserAccounts(manager)) return false;
  if (manager?.role === "admin") return true;
  return target?.role !== "admin";
}

function getAssignableRoleOptions(user: any) {
  if (user?.role === "admin" || user?.buildreqRole === "administracion_central") {
    return ROLE_OPTIONS;
  }
  if (user?.buildreqRole === "administrador_proyecto") {
    return ROLE_OPTIONS.filter(option =>
      PROJECT_MANAGER_ASSIGNABLE_ROLES.has(option.value)
    );
  }
  return [];
}

function ProjectMultiSelect({
  role,
  projects,
  selectedProjectIds,
  onChange,
  placeholder = "Seleccionar proyectos",
  compact = false,
}: {
  role?: string | null;
  projects: any[];
  selectedProjectIds: number[];
  onChange: (projectIds: number[]) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const sortedProjects = useMemo(
    () => [...(projects || [])].sort(compareProjectsByCode),
    [projects]
  );
  const selectedSet = new Set(selectedProjectIds);
  const canUseAll = canAssignAllProjects(role);
  const required = Boolean(role && PROJECT_REQUIRED_ROLES.has(role));
  const allProjectIds = sortedProjects.map((project) => Number(project.id));
  const allExplicitlySelected =
    allProjectIds.length > 0 &&
    allProjectIds.every((projectId) => selectedSet.has(projectId));
  const hasAnySelected = selectedProjectIds.length > 0;
  const bulkActionLabel = allExplicitlySelected
    ? "Quitar todos"
    : "Seleccionar todos";
  const label =
    canUseAll && selectedProjectIds.length === 0
      ? "Todos los proyectos"
      : selectedProjectIds.length === 0
        ? placeholder
        : selectedProjectIds.length === 1
          ? formatAssignedProjects({
              assignedProjectIds: selectedProjectIds,
              assignedProjects: sortedProjects.filter((project) =>
                selectedSet.has(project.id)
              ),
            })
          : `${selectedProjectIds.length} proyectos`;

  function toggleProject(projectId: number) {
    if (selectedSet.has(projectId)) {
      if (required && selectedProjectIds.length === 1) {
        toast.error("Este rol requiere al menos un proyecto");
        return;
      }
      onChange(selectedProjectIds.filter((id) => id !== projectId));
      return;
    }
    onChange([...selectedProjectIds, projectId]);
  }

  function toggleAllProjects() {
    if (allExplicitlySelected) {
      if (required) {
        toast.error("Este rol requiere al menos un proyecto");
        return;
      }
      onChange([]);
      return;
    }
    onChange(allProjectIds);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={`justify-between ${compact ? "h-8 w-56 text-xs" : "w-full"}`}
        >
          <span className="truncate text-left">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="space-y-1">
          {sortedProjects.length > 0 ? (
            <div
              role="button"
              tabIndex={0}
              className="flex w-full cursor-pointer items-center gap-2 border-b border-border px-2 py-2 text-left text-sm font-medium hover:bg-muted"
              onClick={toggleAllProjects}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  toggleAllProjects();
                }
              }}
            >
              <Checkbox
                checked={
                  allExplicitlySelected
                    ? true
                    : hasAnySelected
                      ? "indeterminate"
                      : false
                }
              />
              <span>{bulkActionLabel}</span>
            </div>
          ) : null}
          {canUseAll ? (
            <div
              role="button"
              tabIndex={0}
              className="flex w-full cursor-pointer items-center gap-2 px-2 py-2 text-left text-sm hover:bg-muted"
              onClick={() => onChange([])}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onChange([]);
              }}
            >
              <Checkbox checked={selectedProjectIds.length === 0} />
              <span>Todos los proyectos</span>
            </div>
          ) : null}
          {sortedProjects.map((project: any) => (
            <div
              key={project.id}
              role="button"
              tabIndex={0}
              className="flex w-full cursor-pointer items-center gap-2 px-2 py-2 text-left text-sm hover:bg-muted"
              onClick={() => toggleProject(project.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  toggleProject(project.id);
                }
              }}
            >
              <Checkbox checked={selectedSet.has(project.id)} />
              <span className="min-w-0 flex-1 truncate">
                {project.code} - {project.name}
              </span>
            </div>
          ))}
          {sortedProjects.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              No hay proyectos activos.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: any }> = {
  pendiente: { label: "Pendiente", variant: "secondary", icon: Clock },
  aceptada: { label: "Aceptada", variant: "default", icon: CheckCircle2 },
  expirada: { label: "Expirada", variant: "outline", icon: XCircle },
  cancelada: { label: "Cancelada", variant: "destructive", icon: XCircle },
};

export default function Usuarios() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isSystemAdmin = user?.role === "admin";
  const canManageAccounts = canManageUserAccounts(user);
  const canUseInvitations = isSystemAdmin;
  const canResetUserPasswords = canManageAccounts;
  const { data: users, isLoading: usersLoading } =
    trpc.userManagement.list.useQuery(undefined, { enabled: canManageAccounts });
  const { data: invitationsList, isLoading: invLoading } =
    trpc.invitations.list.useQuery(undefined, { enabled: canUseInvitations });
  const { data: projects } = trpc.projects.list.useQuery(
    { status: "activo" },
    { enabled: canManageAccounts }
  );
  const sortedUsers = useMemo(
    () => [...(users || [])].sort(compareUsersByName),
    [users]
  );
  const sortedProjects = useMemo(
    () => [...(projects || [])].sort(compareProjectsByCode),
    [projects]
  );
  const assignableRoleOptions = useMemo(
    () => getAssignableRoleOptions(user),
    [user?.role, (user as any)?.buildreqRole]
  );
  const appSiteUrl = getAppSiteUrl();

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [showDirectUserDialog, setShowDirectUserDialog] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailData, setEmailData] = useState<{ to: string; subject: string; content: string } | null>(null);
  const [userSearchTerm, setUserSearchTerm] = useState("");
  const [isExportingUsers, setIsExportingUsers] = useState(false);

  // Form state
  const [invName, setInvName] = useState("");
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState<string>("");
  const [invProjectIds, setInvProjectIds] = useState<number[]>([]);
  const [directName, setDirectName] = useState("");
  const [directEmail, setDirectEmail] = useState("");
  const [directPassword, setDirectPassword] = useState("");
  const [directRole, setDirectRole] = useState<string>("");
  const [directProjectIds, setDirectProjectIds] = useState<number[]>([]);
  const [showDirectPassword, setShowDirectPassword] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<string>("");
  const [editProjectIds, setEditProjectIds] = useState<number[]>([]);
  const [passwordUser, setPasswordUser] = useState<any | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirmation, setResetPasswordConfirmation] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  const filteredUsers = useMemo(() => {
    const searchTerms = normalizeSearchValue(userSearchTerm)
      .split(/\s+/)
      .filter(Boolean);

    if (searchTerms.length === 0) return sortedUsers;

    return sortedUsers.filter((row: any) => {
      const searchText = normalizeSearchValue(getUserSearchText(row));
      return searchTerms.every((term) => searchText.includes(term));
    });
  }, [sortedUsers, userSearchTerm]);
  const hasUserSearch = userSearchTerm.trim().length > 0;

  async function exportUsersExcel() {
    if (isExportingUsers || filteredUsers.length === 0) return;

    setIsExportingUsers(true);
    try {
      await downloadExcel(
        buildDatedExcelFileName("usuarios-buildreq"),
        "Usuarios",
        [
          { header: "Nombre", value: (entry: any) => entry.name || "—" },
          {
            header: "Correo electrónico",
            value: (entry: any) => entry.email || "—",
          },
          {
            header: "Rol del sistema",
            value: (entry: any) =>
              entry.role === "admin" ? "Administrador" : "Usuario",
          },
          {
            header: "Rol BuildReq",
            value: (entry: any) =>
              ROLE_LABELS[entry.buildreqRole] ||
              entry.buildreqRole ||
              "Sin rol asignado",
          },
          {
            header: "Proyectos asignados",
            value: (entry: any) => formatAssignedProjects(entry),
            width: 48,
          },
          {
            header: "Cambio de contraseña",
            value: (entry: any) =>
              entry.mustChangePassword ? "Pendiente" : "No",
          },
          {
            header: "Último acceso",
            value: (entry: any) =>
              entry.lastSignedIn
                ? new Date(entry.lastSignedIn).toLocaleDateString("es-HN")
                : "—",
          },
        ],
        filteredUsers
      );
      toast.success(`Se exportaron ${filteredUsers.length} usuarios`);
    } catch (error) {
      console.error("No se pudo exportar el listado de usuarios", error);
      toast.error("No se pudo exportar el listado de usuarios");
    } finally {
      setIsExportingUsers(false);
    }
  }

  const updateRoleMutation = trpc.userManagement.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Rol actualizado");
      void Promise.all([
        utils.userManagement.list.invalidate(),
        utils.auth.me.invalidate(),
        utils.supplyFlows.availableFlows.invalidate(),
        utils.dashboard.sidebarCounts.invalidate(),
        utils.dashboard.stats.invalidate(),
      ]);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateUserAdminMutation = trpc.userManagement.updateUserAdmin.useMutation({
    onSuccess: () => {
      toast.success("Usuario actualizado");
      void Promise.all([
        utils.userManagement.list.invalidate(),
        utils.auth.me.invalidate(),
        utils.supplyFlows.availableFlows.invalidate(),
        utils.dashboard.sidebarCounts.invalidate(),
        utils.dashboard.stats.invalidate(),
      ]);
      closeEditUserDialog();
    },
    onError: (e) => toast.error(e.message),
  });

  const resetPasswordAdminMutation =
    trpc.userManagement.resetPasswordAdmin.useMutation({
      onSuccess: () => {
        toast.success("Contraseña actualizada");
        void Promise.all([
          utils.userManagement.list.invalidate(),
          utils.auth.me.invalidate(),
        ]);
        closePasswordDialog();
      },
      onError: (e) => toast.error(e.message),
    });

  const createDirectUserMutation = trpc.userManagement.createDirect.useMutation({
    onSuccess: () => {
      toast.success("Usuario creado. Debe cambiar la contraseña al ingresar.");
      void utils.userManagement.list.invalidate();
      setShowDirectUserDialog(false);
      resetDirectForm();
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
    setInvProjectIds([]);
  }

  function resetDirectForm() {
    setDirectName("");
    setDirectEmail("");
    setDirectPassword("");
    setDirectRole("");
    setDirectProjectIds([]);
    setShowDirectPassword(false);
  }

  function openEditUserDialog(user: any) {
    const role = user.buildreqRole || "";
    setEditingUser(user);
    setEditName(user.name || "");
    setEditEmail(user.email || "");
    setEditRole(role);
    setEditProjectIds(isProjectAssignableRole(role) ? getAssignedProjectIds(user) : []);
  }

  function closeEditUserDialog() {
    setEditingUser(null);
    setEditName("");
    setEditEmail("");
    setEditRole("");
    setEditProjectIds([]);
  }

  function openPasswordDialog(user: any) {
    setPasswordUser(user);
    setResetPassword("");
    setResetPasswordConfirmation("");
    setShowResetPassword(false);
  }

  function closePasswordDialog() {
    setPasswordUser(null);
    setResetPassword("");
    setResetPasswordConfirmation("");
    setShowResetPassword(false);
  }

  function handleUpdateUserAdmin() {
    if (!editingUser) return;
    if (!editName.trim() || !editEmail.trim() || !editRole) {
      toast.error("Nombre, email y rol son obligatorios");
      return;
    }
    if (PROJECT_REQUIRED_ROLES.has(editRole) && editProjectIds.length === 0) {
      toast.error("Debe asignar al menos un proyecto a este rol");
      return;
    }

    updateUserAdminMutation.mutate({
      userId: editingUser.id,
      name: editName,
      email: editEmail,
      buildreqRole: editRole as any,
      assignedProjectIds: getAssignedProjectIdsPayload(editRole, editProjectIds),
    });
  }

  function handleResetPasswordAdmin() {
    if (!passwordUser) return;
    if (resetPassword.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (resetPassword !== resetPasswordConfirmation) {
      toast.error("Las contraseñas no coinciden");
      return;
    }

    resetPasswordAdminMutation.mutate({
      userId: passwordUser.id,
      password: resetPassword,
    });
  }

  function handleCreateDirectUser() {
    if (!directName || !directEmail || !directPassword || !directRole) {
      toast.error("Nombre, email, contraseña y rol son obligatorios");
      return;
    }
    if (directPassword.length < 8) {
      toast.error("La contraseña temporal debe tener al menos 8 caracteres");
      return;
    }
    if (
      PROJECT_REQUIRED_ROLES.has(directRole) &&
      directProjectIds.length === 0
    ) {
      toast.error("Debe asignar al menos un proyecto a este rol");
      return;
    }
    createDirectUserMutation.mutate({
      name: directName,
      email: directEmail,
      password: directPassword,
      buildreqRole: directRole as any,
      assignedProjectIds: getAssignedProjectIdsPayload(directRole, directProjectIds),
    });
  }

  function handleCreateInvitation() {
    if (!invName || !invEmail || !invRole) {
      toast.error("Nombre, email y rol son obligatorios");
      return;
    }
    if (
      PROJECT_REQUIRED_ROLES.has(invRole) &&
      invProjectIds.length === 0
    ) {
      toast.error("Debe asignar al menos un proyecto a este rol");
      return;
    }
    createInvitationMutation.mutate({
      email: invEmail,
      name: invName,
      buildreqRole: invRole as any,
      assignedProjectIds: getAssignedProjectIdsPayload(invRole, invProjectIds),
      origin: appSiteUrl,
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
        {canManageAccounts ? (
          <div className="flex gap-2">
            {canUseInvitations ? (
              <Button
                variant="outline"
                onClick={() => setShowInviteDialog(true)}
                className="gap-2"
              >
                <Mail className="h-4 w-4" />
                Invitar Usuario
              </Button>
            ) : null}
            <Button onClick={() => setShowDirectUserDialog(true)} className="gap-2">
              <UserPlus className="h-4 w-4" />
              Crear Usuario
            </Button>
          </div>
        ) : null}
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" className="gap-2">
            <UsersIcon className="h-4 w-4" />
            Usuarios Activos
          </TabsTrigger>
          {canUseInvitations ? (
            <TabsTrigger value="invitations" className="gap-2">
              <Mail className="h-4 w-4" />
              Invitaciones
              {(invitationsList || []).filter((i: any) => i.invitation.status === "pendiente").length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                  {(invitationsList || []).filter((i: any) => i.invitation.status === "pendiente").length}
                </Badge>
              )}
            </TabsTrigger>
          ) : null}
        </TabsList>

        {/* USERS TAB */}
        <TabsContent value="users" className="space-y-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-0 flex-1 lg:max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={userSearchTerm}
                onChange={(event) => setUserSearchTerm(event.target.value)}
                placeholder="Buscar usuarios por nombre, email, rol o proyecto..."
                className="h-10 pl-9 pr-10"
              />
              {hasUserSearch ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setUserSearchTerm("")}
                  aria-label="Limpiar búsqueda"
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            {sortedUsers.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  {filteredUsers.length} de {sortedUsers.length} usuarios
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => void exportUsersExcel()}
                  disabled={
                    usersLoading ||
                    filteredUsers.length === 0 ||
                    isExportingUsers
                  }
                >
                  <Download className="h-4 w-4" />
                  {isExportingUsers ? "Exportando..." : "Exportar Excel"}
                </Button>
              </div>
            ) : null}
          </div>
          <Card>
            <CardContent className="p-0">
              {usersLoading ? (
                <div className="p-8 text-center text-muted-foreground">Cargando usuarios...</div>
              ) : sortedUsers.length === 0 ? (
                <div className="p-8 text-center">
                  <UsersIcon className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">No hay usuarios registrados</p>
                  {canManageAccounts ? (
                    <p className="text-xs text-muted-foreground mt-1">Cree usuarios con el botón superior</p>
                  ) : null}
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-8 text-center">
                  <Search className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">No hay usuarios que coincidan con la búsqueda</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 gap-2"
                    onClick={() => setUserSearchTerm("")}
                  >
                    <X className="h-4 w-4" />
                    Limpiar búsqueda
                  </Button>
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
                        <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u: any) => {
                        const canManageThisUser = canManageListedUser(user, u);
                        return (
                        <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="p-3 font-medium">{u.name || "—"}</td>
                          <td className="p-3 text-xs text-muted-foreground">
                            <div className="space-y-1">
                              <p>{u.email || "—"}</p>
                              {u.mustChangePassword ? (
                                <Badge variant="secondary" className="gap-1 text-[10px]">
                                  <KeyRound className="h-3 w-3" />
                                  Cambio pendiente
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="p-3">
                            <Badge variant="outline" className={`text-xs ${u.role === "admin" ? "border-primary text-primary" : ""}`}>
                              {u.role === "admin" ? "Administrador" : "Usuario"}
                            </Badge>
                          </td>
                          <td className="p-3">
                            {canManageThisUser ? (
                              <Select
                                value={u.buildreqRole || "sin_rol"}
                                onValueChange={(val) => {
                                  if (val === "sin_rol") return;
                                  const existingProjectIds = getAssignedProjectIds(u);
                                  const nextProjectIds = isProjectAssignableRole(val)
                                    ? existingProjectIds.length > 0
                                      ? existingProjectIds
                                      : PROJECT_REQUIRED_ROLES.has(val)
                                        ? (sortedProjects[0]?.id ? [sortedProjects[0].id] : [])
                                        : []
                                    : [];
                                  updateRoleMutation.mutate({
                                    userId: u.id,
                                    buildreqRole: val as any,
                                    assignedProjectIds: getAssignedProjectIdsPayload(
                                      val,
                                      nextProjectIds
                                    ),
                                  });
                                }}
                              >
                                <SelectTrigger className="h-8 w-48 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="sin_rol" disabled>Sin rol asignado</SelectItem>
                                  {assignableRoleOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge variant="outline" className="text-xs">
                                {ROLE_LABELS[u.buildreqRole] || u.buildreqRole || "Sin rol asignado"}
                              </Badge>
                            )}
                          </td>
                          <td className="p-3">
                            {canManageThisUser && isProjectAssignableRole(u.buildreqRole) ? (
                              <ProjectMultiSelect
                                role={u.buildreqRole}
                                projects={sortedProjects}
                                selectedProjectIds={getAssignedProjectIds(u)}
                                compact
                                onChange={(projectIds) => {
                                  updateRoleMutation.mutate({
                                    userId: u.id,
                                    buildreqRole:
                                      (u.buildreqRole || "ingeniero_residente") as any,
                                    assignedProjectIds: getAssignedProjectIdsPayload(
                                      u.buildreqRole,
                                      projectIds
                                    ),
                                  });
                                }}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {formatAssignedProjects(u)}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString("es") : "—"}
                          </td>
                          <td className="p-3">
                            <div className="flex gap-1">
                              {canManageThisUser ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-1 text-xs"
                                  onClick={() => openEditUserDialog(u)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  Editar
                                </Button>
                              ) : null}
                              {canResetUserPasswords && canManageThisUser ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-1 text-xs"
                                  onClick={() => openPasswordDialog(u)}
                                >
                                  <KeyRound className="h-3.5 w-3.5" />
                                  Contraseña
                                </Button>
                              ) : null}
                            </div>
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

        {/* INVITATIONS TAB */}
        {canUseInvitations ? (
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
                        const assignedProjectLabel = formatAssignedProjects({
                          ...inv,
                          assignedProjects: item.assignedProjects ?? (proj ? [proj] : []),
                        });
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
                              {assignedProjectLabel === "N/A" ? (
                                <span className="text-muted-foreground">N/A</span>
                              ) : (
                                assignedProjectLabel
                              )}
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
                                        origin: appSiteUrl,
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
        ) : null}
      </Tabs>

      {/* EDIT USER DIALOG */}
      <Dialog
        open={Boolean(editingUser)}
        onOpenChange={(open) => {
          if (!open) closeEditUserDialog();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              Editar Usuario
            </DialogTitle>
            <DialogDescription>
              Actualiza los datos de acceso y permisos del usuario.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nombre completo</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Correo electrónico</Label>
              <Input
                id="edit-email"
                type="email"
                value={editEmail}
                onChange={(event) => setEditEmail(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Rol en BuildReq</Label>
              <Select
                value={editRole}
                onValueChange={(value) => {
                  setEditRole(value);
                  if (!isProjectAssignableRole(value)) {
                    setEditProjectIds([]);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar rol" />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isProjectAssignableRole(editRole) ? (
              <div className="space-y-2">
                <Label>Proyectos asignados</Label>
                <ProjectMultiSelect
                  role={editRole}
                  projects={sortedProjects}
                  selectedProjectIds={editProjectIds}
                  onChange={setEditProjectIds}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeEditUserDialog}
              disabled={updateUserAdminMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleUpdateUserAdmin}
              disabled={updateUserAdminMutation.isPending}
              className="gap-2"
            >
              <Pencil className="h-4 w-4" />
              {updateUserAdminMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RESET PASSWORD DIALOG */}
      <Dialog
        open={Boolean(passwordUser)}
        onOpenChange={(open) => {
          if (!open) closePasswordDialog();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Cambiar contraseña
            </DialogTitle>
            <DialogDescription>
              La contraseña se actualiza en Supabase y quedará pendiente de cambio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{passwordUser?.name || "Usuario"}</p>
              <p className="text-xs text-muted-foreground">
                {passwordUser?.email || "Sin correo"}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-password">Nueva contraseña</Label>
              <div className="relative">
                <Input
                  id="reset-password"
                  type={showResetPassword ? "text" : "password"}
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={
                    showResetPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                >
                  {showResetPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-password-confirmation">
                Confirmar contraseña
              </Label>
              <Input
                id="reset-password-confirmation"
                type={showResetPassword ? "text" : "password"}
                value={resetPasswordConfirmation}
                onChange={(event) =>
                  setResetPasswordConfirmation(event.target.value)
                }
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closePasswordDialog}
              disabled={resetPasswordAdminMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleResetPasswordAdmin}
              disabled={resetPasswordAdminMutation.isPending}
              className="gap-2"
            >
              <KeyRound className="h-4 w-4" />
              {resetPasswordAdminMutation.isPending
                ? "Actualizando..."
                : "Cambiar contraseña"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIRECT USER DIALOG */}
      <Dialog open={showDirectUserDialog} onOpenChange={setShowDirectUserDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Crear Usuario
            </DialogTitle>
            <DialogDescription>
              Crea una cuenta activa en Supabase con contraseña temporal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="direct-name">Nombre completo</Label>
              <Input
                id="direct-name"
                placeholder="Ej: Juan Pérez"
                value={directName}
                onChange={(e) => setDirectName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="direct-email">Correo electrónico</Label>
              <Input
                id="direct-email"
                type="email"
                placeholder="Ej: juan@empresa.com"
                value={directEmail}
                onChange={(e) => setDirectEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="direct-password">Contraseña temporal</Label>
              <div className="relative">
                <Input
                  id="direct-password"
                  type={showDirectPassword ? "text" : "password"}
                  value={directPassword}
                  onChange={(e) => setDirectPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowDirectPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showDirectPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showDirectPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Rol en BuildReq</Label>
              <Select
                value={directRole}
                onValueChange={(value) => {
                  setDirectRole(value);
                  if (!isProjectAssignableRole(value)) {
                    setDirectProjectIds([]);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar rol" />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isProjectAssignableRole(directRole) && (
              <div className="space-y-2">
                <Label>Proyectos asignados</Label>
                <ProjectMultiSelect
                  role={directRole}
                  projects={sortedProjects}
                  selectedProjectIds={directProjectIds}
                  onChange={setDirectProjectIds}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDirectUserDialog(false);
                resetDirectForm();
              }}
              disabled={createDirectUserMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreateDirectUser}
              disabled={createDirectUserMutation.isPending}
              className="gap-2"
            >
              <UserPlus className="h-4 w-4" />
              {createDirectUserMutation.isPending ? "Creando..." : "Crear Usuario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <Select
                value={invRole}
                onValueChange={(value) => {
                  setInvRole(value);
                  if (!isProjectAssignableRole(value)) {
                    setInvProjectIds([]);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar rol" />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isProjectAssignableRole(invRole) && (
              <div className="space-y-2">
                <Label>Proyectos asignados</Label>
                <ProjectMultiSelect
                  role={invRole}
                  projects={sortedProjects}
                  selectedProjectIds={invProjectIds}
                  onChange={setInvProjectIds}
                />
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
