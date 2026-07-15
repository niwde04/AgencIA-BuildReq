import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  LogOut,
  PanelLeft,
  ClipboardList,
  Package,
  PackageMinus,
  Building2,
  ArrowLeftRight,
  RotateCcw,
  Warehouse,
  ShoppingCart,
  FolderKanban,
  Users,
  Bell,
  Database,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Percent,
  Tags,
  Landmark,
  Truck,
  UserRound,
} from "lucide-react";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Badge } from "./ui/badge";
import { trpc } from "@/lib/trpc";
import Home from "@/pages/Home";
import UnassignedRoleScreen from "./UnassignedRoleScreen";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { UserProfileDialog } from "./UserProfileDialog";
import {
  BUILDREQ_ROLE_LABELS,
  isProcurementApproverRole,
} from "@shared/buildreq-roles";

type MenuItem = {
  icon: any;
  label: string;
  path: string;
  roles?: string[];
};

type SidebarCountKey =
  | "materialRequestsPendingApproval"
  | "supplyFlowsPending"
  | "purchaseRequestsPending"
  | "purchaseOrdersEmitted"
  | "transferRequestsPending"
  | "fixedAssetsPending"
  | "invoicesPendingAttention"
  | "invoicesReviewed";

const MENU_COUNT_KEYS: Partial<Record<string, SidebarCountKey>> = {
  "/solicitudes": "materialRequestsPendingApproval",
  "/flujos": "supplyFlowsPending",
  "/solicitudes-compra": "purchaseRequestsPending",
  "/ordenes-compra": "purchaseOrdersEmitted",
  "/solicitudes-traslado": "transferRequestsPending",
  "/activos-fijos-pendientes": "fixedAssetsPending",
};
const MENU_ALWAYS_SHOW_COUNT_PATHS = new Set(["/solicitudes"]);
const PROCUREMENT_APPROVER_MENU_PATHS = new Set([
  "/",
  "/solicitudes",
  "/articulos",
  "/solicitudes-compra",
  "/ordenes-compra",
]);

const allMenuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: ClipboardList, label: "Requisiciones", path: "/solicitudes" },
  { icon: Package, label: "Flujos de Abastecimiento", path: "/flujos" },
  {
    icon: RotateCcw,
    label: "Logística Inversa",
    path: "/devoluciones",
    roles: ["jefe_bodega_central", "administracion_central"],
  },
  {
    icon: Warehouse,
    label: "Inventario",
    path: "/inventario",
    roles: [
      "jefe_bodega_central",
      "administracion_central",
      "administrador_proyecto",
      "bodeguero_proyecto",
    ],
  },
  {
    icon: Database,
    label: "Saldos Iniciales",
    path: "/saldos-iniciales",
    roles: ["jefe_bodega_central", "administracion_central", "admin"],
  },
  {
    icon: Tags,
    label: "Artículos",
    path: "/articulos",
    roles: [
      "jefe_bodega_central",
      "administracion_central",
      "administrador_proyecto",
      "bodeguero_proyecto",
      "ingeniero_residente",
      "superintendente",
      "superintendente_aprobador",
      "gerente",
      "contable",
      "admin",
    ],
  },
  {
    icon: Landmark,
    label: "Grupos financieros",
    path: "/grupos-financieros",
    roles: ["admin", "administracion_central"],
  },
  {
    icon: KeyRound,
    label: "Activos fijos pendientes",
    path: "/activos-fijos-pendientes",
    roles: ["contable", "admin"],
  },
  {
    icon: Building2,
    label: "Proveedores",
    path: "/proveedores",
    roles: [
      "jefe_bodega_central",
      "administracion_central",
      "administrador_proyecto",
      "bodeguero_proyecto",
      "contable",
      "admin",
    ],
  },
  {
    icon: PackageMinus,
    label: "Salidas de Inventario",
    path: "/salidas-inventario",
    roles: [
      "jefe_bodega_central",
      "administracion_central",
      "bodeguero_proyecto",
      "admin",
    ],
  },
  {
    icon: Building2,
    label: "Almacenes",
    path: "/almacenes",
    roles: [
      "jefe_bodega_central",
      "administracion_central",
      "administrador_proyecto",
      "bodeguero_proyecto",
      "admin",
    ],
  },
  {
    icon: FileText,
    label: "Solicitudes de Compra",
    path: "/solicitudes-compra",
    roles: [
      "jefe_bodega_central",
      "administracion_central",
      "administrador_proyecto",
      "bodeguero_proyecto",
      "superintendente_aprobador",
      "gerente",
      "admin",
    ],
  },
  {
    icon: ShoppingCart,
    label: "Órdenes de Compra",
    path: "/ordenes-compra",
    roles: [
      "jefe_bodega_central",
      "administracion_central",
      "administrador_proyecto",
      "bodeguero_proyecto",
      "superintendente_aprobador",
      "gerente",
      "contable",
      "admin",
    ],
  },
  {
    icon: ArrowLeftRight,
    label: "Solicitudes de Traslado",
    path: "/solicitudes-traslado",
    roles: [
      "jefe_bodega_central",
      "administracion_central",
      "administrador_proyecto",
      "bodeguero_proyecto",
      "admin",
    ],
  },
  {
    icon: Truck,
    label: "Traslados",
    path: "/traslados",
    roles: [
      "jefe_bodega_central",
      "administracion_central",
      "administrador_proyecto",
      "admin",
    ],
  },
  {
    icon: FileText,
    label: "Recepciones",
    path: "/recepciones",
    roles: [
      "jefe_bodega_central",
      "administracion_central",
      "administrador_proyecto",
      "bodeguero_proyecto",
      "contable",
      "admin",
    ],
  },
  {
    icon: FileText,
    label: "Facturas",
    path: "/facturas",
    roles: [
      "jefe_bodega_central",
      "administracion_central",
      "administrador_proyecto",
      "bodeguero_proyecto",
      "contable",
      "admin",
    ],
  },
  {
    icon: FileSpreadsheet,
    label: "Reportes",
    path: "/reportes",
    roles: [
      "administracion_central",
      "administrador_proyecto",
      "contable",
    ],
  },
  {
    icon: Percent,
    label: "Impuestos",
    path: "/impuestos",
    roles: [
      "jefe_bodega_central",
      "administracion_central",
      "administrador_proyecto",
      "bodeguero_proyecto",
      "contable",
      "admin",
    ],
  },
  {
    icon: Percent,
    label: "Retenciones",
    path: "/retenciones",
    roles: [
      "administracion_central",
      "administrador_proyecto",
      "contable",
      "admin",
    ],
  },
  { icon: FolderKanban, label: "Proyectos", path: "/proyectos" },
  {
    icon: Users,
    label: "Usuarios",
    path: "/usuarios",
    roles: ["admin", "administracion_central"],
  },
  {
    icon: Database,
    label: "Datos Demo",
    path: "/datos-demo",
    roles: ["admin"],
  },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user, logout, refresh } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return <Home />;
  }

  if (user.mustChangePassword) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <ChangePasswordDialog
          open
          onOpenChange={() => undefined}
          userEmail={user.email}
          requireChange
          onPasswordChanged={() => {
            void refresh();
          }}
        />
        <div className="w-full max-w-xl border border-border bg-card p-8 space-y-6">
          <div className="space-y-2">
            <div className="w-5 h-5 bg-primary" />
            <h1 className="text-2xl font-bold tracking-tight">
              Contraseña temporal
            </h1>
            <p className="text-sm text-muted-foreground">
              Tu cuenta fue creada por un administrador. Actualiza tu contraseña
              para continuar.
            </p>
          </div>
          <Button variant="outline" onClick={() => void logout()}>
            Cerrar sesión
          </Button>
        </div>
      </div>
    );
  }

  if (!user.buildreqRole && user.role !== "admin") {
    return (
      <UnassignedRoleScreen
        userName={user.name}
        userEmail={user.email}
        onRefresh={() => {
          void refresh();
        }}
        onLogout={logout}
      />
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  const { data: unreadCount } = trpc.notifications.unreadCount.useQuery(
    undefined,
    { refetchInterval: 30000 }
  );
  const { data: sidebarCounts } = trpc.dashboard.sidebarCounts.useQuery(
    undefined,
    { refetchInterval: 30000 }
  );

  const userRole = (user as any)?.buildreqRole || "";
  const isAdmin = user?.role === "admin";

  const menuItems = useMemo(() => {
    return allMenuItems.filter((item) => {
      if (userRole === "superintendente") {
        return (
          item.path === "/" ||
          item.path === "/solicitudes" ||
          item.path === "/articulos"
        );
      }
      if (isProcurementApproverRole(userRole)) {
        return PROCUREMENT_APPROVER_MENU_PATHS.has(item.path);
      }
      if (userRole === "contable") {
        return (
          item.path === "/articulos" ||
          item.path === "/activos-fijos-pendientes" ||
          item.path === "/proveedores" ||
          item.path === "/ordenes-compra" ||
          item.path === "/recepciones" ||
          item.path === "/facturas" ||
          item.path === "/proyectos" ||
          item.path === "/reportes" ||
          item.path === "/impuestos" ||
          item.path === "/retenciones"
        );
      }
      if (!item.roles) return true;
      if (item.roles.includes("admin") && isAdmin) return true;
      return item.roles.includes(userRole);
    });
  }, [userRole, isAdmin]);

  const activeMenuItem = menuItems.find((item) => {
    if (item.path === "/") return location === "/";
    return location.startsWith(item.path);
  });
  const shouldRedirectContable =
    userRole === "contable" &&
    location !== "/articulos" &&
    location !== "/activos-fijos-pendientes" &&
    location !== "/proveedores" &&
    location !== "/ordenes-compra" &&
    location !== "/recepciones" &&
    location !== "/facturas" &&
    location !== "/proyectos" &&
    location !== "/reportes" &&
    location !== "/impuestos" &&
    location !== "/retenciones";
  const isSuperintendentAllowedPath =
    location === "/" ||
    location === "/articulos" ||
    location === "/solicitudes" ||
    /^\/solicitudes\/\d+$/.test(location);
  const shouldRedirectSuperintendent =
    userRole === "superintendente" && !isSuperintendentAllowedPath;
  const isProcurementApproverAllowedPath =
    location === "/" ||
    location === "/articulos" ||
    location === "/solicitudes" ||
    /^\/solicitudes\/\d+$/.test(location) ||
    location === "/solicitudes-compra" ||
    location === "/ordenes-compra" ||
    location === "/notificaciones";
  const shouldRedirectProcurementApprover =
    isProcurementApproverRole(userRole) &&
    !isProcurementApproverAllowedPath;
  const shouldRedirectUserManagement =
    location.startsWith("/usuarios") &&
    !isAdmin &&
    userRole !== "administracion_central";

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    if (shouldRedirectContable) {
      setLocation("/facturas");
    }
  }, [setLocation, shouldRedirectContable]);

  useEffect(() => {
    if (shouldRedirectSuperintendent) {
      setLocation(location.startsWith("/solicitudes") ? "/solicitudes" : "/");
    }
  }, [location, setLocation, shouldRedirectSuperintendent]);

  useEffect(() => {
    if (shouldRedirectProcurementApprover) {
      setLocation(location.startsWith("/solicitudes") ? "/solicitudes" : "/");
    }
  }, [location, setLocation, shouldRedirectProcurementApprover]);

  useEffect(() => {
    if (shouldRedirectUserManagement) {
      setLocation("/");
    }
  }, [setLocation, shouldRedirectUserManagement]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft =
        sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  if (
    shouldRedirectContable ||
    shouldRedirectSuperintendent ||
    shouldRedirectProcurementApprover ||
    shouldRedirectUserManagement
  ) {
    return null;
  }

  return (
    <>
      <ChangePasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
        userEmail={user?.email}
      />
      <UserProfileDialog
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        user={user}
        onOpenPassword={() => setPasswordDialogOpen(true)}
      />
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r border-border"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center border-b border-border">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded transition-colors focus:outline-none shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-5 h-5 bg-primary shrink-0" />
                  <span className="font-bold tracking-tight text-foreground truncate">
                    BuildReq
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 overflow-hidden">
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <SidebarMenu className="px-2 py-2">
                {menuItems.map((item) => {
                  const isActive =
                    item.path === "/"
                      ? location === "/"
                      : location.startsWith(item.path);
                  const countKey = MENU_COUNT_KEYS[item.path];
                  const badgeCount = countKey ? sidebarCounts?.[countKey] ?? 0 : 0;
                  const invoicePendingCount =
                    item.path === "/facturas"
                      ? sidebarCounts?.invoicesPendingAttention ?? 0
                      : 0;
                  const invoiceReviewedCount =
                    item.path === "/facturas"
                      ? sidebarCounts?.invoicesReviewed ?? 0
                      : 0;
                  const showBadge =
                    badgeCount > 0 || MENU_ALWAYS_SHOW_COUNT_PATHS.has(item.path);
                  const showInvoiceBadges =
                    item.path === "/facturas" &&
                    (invoicePendingCount > 0 || invoiceReviewedCount > 0);
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => setLocation(item.path)}
                        tooltip={item.label}
                        className="h-9 transition-all font-normal text-sm"
                      >
                        <item.icon
                          className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                        />
                        <span
                          className={`flex min-w-0 flex-1 items-center justify-between gap-2 ${
                            isActive ? "font-medium" : "font-normal"
                          }`}
                        >
                          <span className="truncate">{item.label}</span>
                          {showInvoiceBadges ? (
                            <span className="flex shrink-0 items-center gap-1">
                              {invoicePendingCount > 0 ? (
                                <Badge
                                  variant="destructive"
                                  title="Borrador, borrador con alerta y rechazadas"
                                  className="h-5 min-w-5 shrink-0 rounded-sm px-1 text-xs"
                                >
                                  {invoicePendingCount}
                                </Badge>
                              ) : null}
                              {invoiceReviewedCount > 0 ? (
                                <Badge
                                  variant="outline"
                                  title="Revisadas para contabilidad"
                                  className="h-5 min-w-5 shrink-0 rounded-sm border-blue-300 bg-blue-50 px-1 text-xs text-blue-700"
                                >
                                  {invoiceReviewedCount}
                                </Badge>
                              ) : null}
                            </span>
                          ) : showBadge ? (
                            <Badge
                              variant={badgeCount > 0 ? "destructive" : "outline"}
                              className="h-5 min-w-5 shrink-0 rounded-sm px-1 text-xs"
                            >
                              {badgeCount}
                            </Badge>
                          ) : null}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </div>

            <div className="shrink-0 bg-sidebar">
              <SidebarSeparator className="my-2" />

              {userRole !== "contable" && userRole !== "superintendente" ? (
                <SidebarMenu className="px-2 pb-2">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={location === "/notificaciones"}
                      onClick={() => setLocation("/notificaciones")}
                      tooltip="Notificaciones"
                      className="h-9 transition-all font-normal text-sm"
                    >
                      <Bell
                        className={`h-4 w-4 ${location === "/notificaciones" ? "text-primary" : "text-muted-foreground"}`}
                      />
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span className="truncate">Notificaciones</span>
                        {(unreadCount ?? 0) > 0 && (
                          <Badge
                            variant="destructive"
                            className="h-5 min-w-5 shrink-0 text-xs px-1 rounded-sm"
                          >
                            {unreadCount}
                          </Badge>
                        )}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              ) : null}
            </div>
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none">
                  <Avatar className="h-8 w-8 border shrink-0">
                    <AvatarFallback className="text-xs font-semibold bg-primary text-primary-foreground">
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-foreground">
                      {user?.name || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {BUILDREQ_ROLE_LABELS[userRole] || (user?.role === "admin" ? "Administrador" : "Sin rol asignado")}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{user?.name}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setProfileDialogOpen(true)}
                  className="cursor-pointer"
                >
                  <UserRound className="mr-2 h-4 w-4" />
                  <span>Mi perfil</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPasswordDialogOpen(true)}
                  className="cursor-pointer"
                >
                  <KeyRound className="mr-2 h-4 w-4" />
                  <span>Cambiar contraseña</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Cerrar sesión</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background px-2 sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded bg-background" />
              <span className="font-medium tracking-tight text-foreground text-sm">
                {activeMenuItem?.label ?? "BuildReq"}
              </span>
            </div>
          </div>
        )}
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
          <span className="font-semibold">Versión beta</span>
          <span className="mx-2 text-amber-700">-</span>
          <span>Queremos que pruebes BuildReq y nos compartas tus comentarios.</span>
        </div>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </>
  );
}
