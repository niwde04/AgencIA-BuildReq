import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthSessionProvider } from "./contexts/AuthSessionContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";

// Pages
import Dashboard from "./pages/Dashboard";
import Solicitudes from "./pages/Solicitudes";
import SolicitudDetalle from "./pages/SolicitudDetalle";
import NuevaSolicitud from "./pages/NuevaSolicitud";
import Flujos from "./pages/Flujos";
import Devoluciones from "./pages/Devoluciones";
import NuevaDevolucion from "./pages/NuevaDevolucion";
import Inventario from "./pages/Inventario";
import Articulos from "./pages/Articulos";
import Proveedores from "./pages/Proveedores";
import OrdenesCompra from "./pages/OrdenesCompra";
import Proyectos from "./pages/Proyectos";
import Usuarios from "./pages/Usuarios";
import Notificaciones from "./pages/Notificaciones";
import DatosDemo from "./pages/DatosDemo";
import Almacenes from "./pages/Almacenes";
import PurchaseRequests from "./pages/PurchaseRequests";
import TransferRequests from "./pages/TransferRequests";
import Transfers from "./pages/Transfers";
import Recepciones from "./pages/Recepciones";
import Facturas from "./pages/Facturas";
import Retenciones from "./pages/Retenciones";
import SaldosIniciales from "./pages/SaldosIniciales";
import SalidasBodega from "./pages/SalidasBodega";
import ActualizarContrasena from "./pages/ActualizarContrasena";

function DashboardRoutes() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/solicitudes" component={Solicitudes} />
      <Route path="/solicitudes/nueva" component={NuevaSolicitud} />
      <Route path="/solicitudes/:id/editar" component={NuevaSolicitud} />
      <Route path="/solicitudes/:id" component={SolicitudDetalle} />
      <Route path="/flujos" component={Flujos} />
      <Route path="/devoluciones" component={Devoluciones} />
      <Route path="/devoluciones/nueva" component={NuevaDevolucion} />
      <Route path="/inventario" component={Inventario} />
      <Route path="/articulos" component={Articulos} />
      <Route path="/proveedores" component={Proveedores} />
      <Route path="/almacenes" component={Almacenes} />
      <Route path="/solicitudes-compra" component={PurchaseRequests} />
      <Route path="/ordenes-compra" component={OrdenesCompra} />
      <Route path="/solicitudes-traslado" component={TransferRequests} />
      <Route path="/traslados" component={Transfers} />
      <Route path="/recepciones" component={Recepciones} />
      <Route path="/facturas" component={Facturas} />
      <Route path="/retenciones" component={Retenciones} />
      <Route path="/salidas-inventario" component={SalidasBodega} />
      <Route path="/salidas-bodega" component={SalidasBodega} />
      <Route path="/saldos-iniciales" component={SaldosIniciales} />
      <Route path="/proyectos" component={Proyectos} />
      <Route path="/usuarios" component={Usuarios} />
      <Route path="/datos-demo" component={DatosDemo} />
      <Route path="/notificaciones" component={Notificaciones} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function DashboardShell() {
  return (
    <DashboardLayout>
      <DashboardRoutes />
    </DashboardLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/actualizar-contrasena" component={ActualizarContrasena} />
      <Route component={DashboardShell} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <AuthSessionProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </AuthSessionProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
