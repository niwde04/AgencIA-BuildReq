import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
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
import OrdenesCompra from "./pages/OrdenesCompra";
import Proyectos from "./pages/Proyectos";
import Usuarios from "./pages/Usuarios";
import Notificaciones from "./pages/Notificaciones";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/solicitudes" component={Solicitudes} />
        <Route path="/solicitudes/nueva" component={NuevaSolicitud} />
        <Route path="/solicitudes/:id" component={SolicitudDetalle} />
        <Route path="/flujos" component={Flujos} />
        <Route path="/devoluciones" component={Devoluciones} />
        <Route path="/devoluciones/nueva" component={NuevaDevolucion} />
        <Route path="/inventario" component={Inventario} />
        <Route path="/ordenes-compra" component={OrdenesCompra} />
        <Route path="/proyectos" component={Proyectos} />
        <Route path="/usuarios" component={Usuarios} />
        <Route path="/notificaciones" component={Notificaciones} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
