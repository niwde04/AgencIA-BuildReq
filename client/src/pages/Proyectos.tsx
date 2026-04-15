import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, FolderKanban } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  activo: "Activo",
  inactivo: "Inactivo",
  completado: "Completado",
};

export default function Proyectos() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [sapProjectCode, setSapProjectCode] = useState("");

  const { data: projects, isLoading } = trpc.projects.list.useQuery();

  const createMutation = trpc.projects.create.useMutation({
    onSuccess: () => {
      toast.success("Proyecto creado con su bodega operativa");
      utils.projects.list.invalidate();
      utils.warehouses.list.invalidate();
      setDialogOpen(false);
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const resetForm = () => {
    setCode("");
    setName("");
    setDescription("");
    setLocation("");
    setSapProjectCode("");
  };

  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Proyectos</h1>
        {isAdmin && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Nuevo Proyecto
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nuevo Proyecto</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Código *</Label>
                    <Input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="PROY-001"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nombre *</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Torre Residencial Norte"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Descripción</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descripción del proyecto..."
                    rows={2}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Ubicación</Label>
                    <Input
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Ciudad, País"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Código SAP</Label>
                    <Input
                      value={sapProjectCode}
                      onChange={(e) => setSapProjectCode(e.target.value)}
                      placeholder="SAP-PROY-001"
                    />
                  </div>
                </div>
                <Button
                  onClick={() => {
                    if (!code || !name) {
                      toast.error("Código y nombre son obligatorios");
                      return;
                    }
                    createMutation.mutate({
                      code,
                      name,
                      description: description || undefined,
                      location: location || undefined,
                      sapProjectCode: sapProjectCode || undefined,
                    });
                  }}
                  disabled={createMutation.isPending}
                  className="w-full"
                >
                  {createMutation.isPending ? "Creando..." : "Crear Proyecto"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Project Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-24 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (projects || []).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FolderKanban className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No hay proyectos registrados</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(projects || []).map((project: any) => (
            <Card
              key={project.id}
              className="hover:border-primary/20 transition-colors"
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-8 bg-primary" />
                    <div>
                      <p className="font-mono text-xs text-muted-foreground">
                        {project.code}
                      </p>
                      <p className="font-medium text-sm">{project.name}</p>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-xs ${project.status === "activo" ? "border-emerald-300 text-emerald-700" : ""}`}
                  >
                    {STATUS_LABELS[project.status]}
                  </Badge>
                </div>
                {project.description && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                    {project.description}
                  </p>
                )}
                {project.location && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {project.location}
                  </p>
                )}
                {project.sapProjectCode && (
                  <p className="text-xs font-mono text-muted-foreground mt-1">
                    SAP: {project.sapProjectCode}
                  </p>
                )}
                {project.warehouse && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Bodega: {project.warehouse.displayName}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Active count indicator */}
      {projects && (
        <p className="text-xs text-muted-foreground text-center">
          {projects.filter((p: any) => p.status === "activo").length}
          {" "}proyectos activos
        </p>
      )}
    </div>
  );
}
