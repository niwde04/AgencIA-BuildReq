import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, Check, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function Notificaciones() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data: notifications, isLoading } = trpc.notifications.list.useQuery();

  const markReadMutation = trpc.notifications.markAsRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
    },
  });

  const markAllReadMutation = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: () => {
      toast.success("Todas las notificaciones marcadas como leídas");
      utils.notifications.list.invalidate();
    },
  });

  const unreadCount = (notifications || []).filter(
    (n: any) => !n.isRead
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1>Notificaciones</h1>
          {unreadCount > 0 && (
            <Badge className="bg-primary text-primary-foreground">
              {unreadCount}
            </Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
          >
            <CheckCheck className="h-4 w-4 mr-2" />
            Marcar todas como leídas
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-12 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (notifications || []).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Bell className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No hay notificaciones</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {(notifications || []).map((n: any) => (
            <Card
              key={n.id}
              className={`transition-colors ${n.relatedEntityType === "treasury_payment_batch" ? "cursor-pointer hover:bg-muted/40" : ""} ${!n.isRead ? "border-primary/30 bg-primary/5" : ""}`}
              onClick={() => {
                if (n.relatedEntityType !== "treasury_payment_batch") return;
                if (!n.isRead) markReadMutation.mutate({ id: n.id });
                setLocation("/tesoreria");
              }}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm ${!n.isRead ? "font-semibold" : "font-medium"}`}
                    >
                      {n.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {n.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(n.createdAt).toLocaleString("es")}
                    </p>
                  </div>
                  {!n.isRead && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={event => {
                        event.stopPropagation();
                        markReadMutation.mutate({ id: n.id });
                      }}
                      className="shrink-0"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
