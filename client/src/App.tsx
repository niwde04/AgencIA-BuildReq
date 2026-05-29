import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { useEffect } from "react";
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
import Impuestos from "./pages/Impuestos";
import Retenciones from "./pages/Retenciones";
import SaldosIniciales from "./pages/SaldosIniciales";
import SalidasBodega from "./pages/SalidasBodega";
import ActualizarContrasena from "./pages/ActualizarContrasena";

const UPPERCASE_TEXT_INPUT_TYPES = new Set([
  "",
  "email",
  "search",
  "tel",
  "text",
  "url",
]);

function shouldUppercaseInput(
  element: EventTarget | null
): element is HTMLInputElement | HTMLTextAreaElement {
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement)
  ) {
    return false;
  }

  if (
    element.disabled ||
    element.readOnly ||
    element.dataset.preserveCase === "true"
  ) {
    return false;
  }

  if (element instanceof HTMLTextAreaElement) {
    return true;
  }

  return UPPERCASE_TEXT_INPUT_TYPES.has(element.type.toLowerCase());
}

function uppercaseInputValue(
  element: HTMLInputElement | HTMLTextAreaElement
) {
  const originalValue = element.value;
  const upperValue = originalValue.toLocaleUpperCase("es-HN");

  if (originalValue === upperValue) return;

  const selectionStart = element.selectionStart;
  const selectionEnd = element.selectionEnd;
  const selectionDirection = element.selectionDirection;

  element.value = upperValue;

  if (
    document.activeElement === element &&
    selectionStart !== null &&
    selectionEnd !== null
  ) {
    try {
      element.setSelectionRange(
        selectionStart,
        selectionEnd,
        selectionDirection ?? "none"
      );
    } catch {
      // Some input types do not support manual cursor restoration.
    }
  }
}

function useUppercaseTextEntry() {
  useEffect(() => {
    const handleInput = (event: Event) => {
      if (!shouldUppercaseInput(event.target)) return;
      uppercaseInputValue(event.target);
    };

    document.addEventListener("input", handleInput, true);

    return () => {
      document.removeEventListener("input", handleInput, true);
    };
  }, []);
}

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
      <Route path="/impuestos" component={Impuestos} />
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
  useUppercaseTextEntry();

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
