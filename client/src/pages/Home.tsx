import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Package,
  Truck,
  ArrowLeftRight,
  ShoppingCart,
  RotateCcw,
  BarChart3,
  ArrowRight,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";

export default function Home() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  // Auth state
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const user = meQuery.data ?? null;
  const isAuthenticated = Boolean(user);
  const authLoading = meQuery.isLoading;

  // Login form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");

  // After Supabase login, send the token to our backend to create/sync the session cookie
  const syncSessionMutation = trpc.auth.syncSupabaseSession.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
    },
  });

  // Listen for Supabase auth state changes (handles token refresh)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.access_token) {
          await syncSessionMutation.mutateAsync({ token: session.access_token });
        }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoginLoading(true);

    try {
      let result;
      if (mode === "login") {
        result = await supabase.auth.signInWithPassword({ email, password });
      } else {
        result = await supabase.auth.signUp({ email, password });
      }

      if (result.error) {
        setError(result.error.message);
        return;
      }

      if (mode === "register" && !result.data.session) {
        setError("✅ Cuenta creada. Revisa tu email para confirmar tu cuenta.");
        setMode("login");
        return;
      }

      if (result.data.session?.access_token) {
        await syncSessionMutation.mutateAsync({
          token: result.data.session.access_token,
        });
        setLocation("/");
      }
    } catch (err: any) {
      setError(err.message ?? "Error desconocido");
    } finally {
      setLoginLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-6 py-24 text-center">
          <div className="w-3 h-3 bg-primary mx-auto mb-8" />
          <h1 className="text-3xl font-bold tracking-tight mb-4">
            Bienvenido, {user?.name || "Usuario"}
          </h1>
          <p className="text-muted-foreground mb-8">
            Accede al panel de control para gestionar solicitudes de materiales,
            flujos de abastecimiento y logística inversa.
          </p>
          <Button onClick={() => setLocation("/")} size="lg">
            Ir al Dashboard
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-primary" />
            <span className="font-bold text-lg tracking-tight">BuildReq</span>
          </div>
        </div>
      </header>

      {/* Main: Hero + Login side by side */}
      <section className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-24 grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left: Hero */}
          <div className="lg:col-span-7 space-y-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-[2px] bg-primary" />
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Gestión de Materiales
              </span>
            </div>
            <h1 className="text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1]">
              Control total de
              <br />
              requerimientos
              <br />
              <span className="text-primary">de construcción</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
              Plataforma centralizada para gestionar solicitudes de materiales,
              flujos de abastecimiento y logística inversa. Preparada para
              integración con SAP Business One.
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-xs">
              <div className="bg-primary/5 border border-primary/10 p-4 space-y-1">
                <p className="text-3xl font-bold">20</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  Proyectos simultáneos
                </p>
              </div>
              <div className="bg-primary/5 border border-primary/10 p-4 space-y-1">
                <p className="text-3xl font-bold">4</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  Flujos de abastecimiento
                </p>
              </div>
            </div>
          </div>

          {/* Right: Login form */}
          <div className="lg:col-span-5 flex items-center">
            <div className="w-full border border-border p-8 space-y-6">
              <div>
                <h2 className="text-xl font-bold tracking-tight">
                  {mode === "login" ? "Iniciar Sesión" : "Crear Cuenta"}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {mode === "login"
                    ? "Accede con tu cuenta BuildReq"
                    : "Registra una nueva cuenta"}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Correo electrónico
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="usuario@empresa.com"
                    autoComplete="email"
                  />
                </div>

                {/* Password */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Contraseña
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full border border-border bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="••••••••"
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Error message */}
                {error && (
                  <p className={`text-sm ${error.startsWith("✅") ? "text-green-600" : "text-destructive"}`}>
                    {error}
                  </p>
                )}

                {/* Submit */}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loginLoading || syncSessionMutation.isPending}
                >
                  {loginLoading || syncSessionMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  {mode === "login" ? "Ingresar" : "Crear Cuenta"}
                </Button>
              </form>

              {/* Toggle mode */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode((m) => (m === "login" ? "register" : "login"));
                    setError(null);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                >
                  {mode === "login"
                    ? "¿No tienes cuenta? Regístrate"
                    : "¿Ya tienes cuenta? Inicia sesión"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="flex items-center gap-2 mb-12">
            <div className="w-8 h-[2px] bg-primary" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Flujos de Abastecimiento
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Package,
                title: "Compra Directa",
                desc: "Registro automático de entrada de inventario para compras con línea de crédito o caja chica",
              },
              {
                icon: Truck,
                title: "Despacho Bodega",
                desc: "Salida de inventario cuando Bodega Central tiene el material disponible",
              },
              {
                icon: ArrowLeftRight,
                title: "Traslado Proyecto",
                desc: "Solicitud de traslado entre proyectos gestionada por el Jefe de Bodega",
              },
              {
                icon: ShoppingCart,
                title: "Solicitud Compra",
                desc: "Generación de solicitud convertible a Orden de Compra para compra local o extranjera",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="border border-border p-6 space-y-3 hover:border-primary/30 transition-colors"
              >
                <feature.icon className="h-6 w-6 text-primary" />
                <h3 className="font-semibold text-sm">{feature.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Additional Features */}
      <section className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-3">
              <RotateCcw className="h-6 w-6 text-primary" />
              <h3 className="font-semibold">Logística Inversa</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Devoluciones a Bodega Central, entre proyectos y a proveedores
                con justificación obligatoria y manejo de defectos.
              </p>
            </div>
            <div className="space-y-3">
              <BarChart3 className="h-6 w-6 text-primary" />
              <h3 className="font-semibold">Dashboard Analítico</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Métricas de solicitudes por proyecto, tiempos de atención,
                consumo y estatus en tiempo real.
              </p>
            </div>
            <div className="space-y-3">
              <div className="w-6 h-6 bg-primary/10 border border-primary/20 flex items-center justify-center">
                <span className="text-[10px] font-bold text-primary">SAP</span>
              </div>
              <h3 className="font-semibold">Preparado para SAP B1</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Estructura de datos compatible con documentos SAP: entradas de
                mercancía, salidas, traslados y órdenes de compra.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-primary" />
          <span>BuildReq</span>
        </div>
        <span>Sector Construcción — Gestión de Materiales</span>
      </footer>
    </div>
  );
}
