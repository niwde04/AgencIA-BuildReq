import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { formatPurchaseOrderCurrency } from "@shared/purchase-orders";
import {
  CheckCircle2,
  FileCheck2,
  Loader2,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { useParams } from "wouter";

type FileCheckResult = {
  fileName: string;
  matches: boolean;
  hash: string;
  error?: string;
};

async function sha256File(file: File) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("El navegador no permite calcular SHA-256 en este sitio");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer()
  );
  return Array.from(new Uint8Array(digest))
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
}

function formatDateTime(value: Date | string) {
  return new Date(value).toLocaleString("es-HN", {
    timeZone: "America/Tegucigalpa",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function VerificarOrdenCompra() {
  const { token = "" } = useParams<{ token: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileResult, setFileResult] = useState<FileCheckResult | null>(null);
  const [checkingFile, setCheckingFile] = useState(false);
  const { data, isLoading, error } = trpc.purchaseOrders.verifySeal.useQuery(
    { token },
    { retry: false, enabled: Boolean(token) }
  );

  const verifyFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !data) return;

    setCheckingFile(true);
    try {
      const hash = await sha256File(file);
      setFileResult({
        fileName: file.name,
        matches: hash === data.officialPdfHash,
        hash,
      });
    } catch (error) {
      setFileResult({
        fileName: file.name,
        matches: false,
        hash: "",
        error:
          error instanceof Error
            ? error.message
            : "No se pudo calcular la huella del archivo",
      });
    } finally {
      setCheckingFile(false);
    }
  };

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="flex items-center gap-3 text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          Verificando sello electrónico...
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <Card className="w-full max-w-xl border-rose-200 shadow-lg">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <XCircle className="h-14 w-14 text-rose-600" />
            <h1 className="text-2xl font-semibold">Sello no encontrado</h1>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              El código no corresponde a una orden de compra sellada por
              BuildReq. Verifica que el enlace o QR esté completo.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const isAnnulled = data.status === "annulled";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <Card
          className={
            isAnnulled
              ? "border-rose-200 shadow-lg"
              : "border-emerald-200 shadow-lg"
          }
        >
          <CardHeader className="items-center text-center">
            {isAnnulled ? (
              <XCircle className="h-14 w-14 text-rose-600" />
            ) : (
              <ShieldCheck className="h-14 w-14 text-emerald-600" />
            )}
            <CardTitle className="text-2xl">
              {isAnnulled ? "Orden de compra anulada" : "Sello válido"}
            </CardTitle>
            <Badge variant={isAnnulled ? "destructive" : "secondary"}>
              {data.verificationCode}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            {isAnnulled ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                El documento fue auténtico al emitirse, pero la orden fue
                anulada posteriormente y ya no debe utilizarse.
              </p>
            ) : (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                El sello coincide con el registro oficial de BuildReq.
              </p>
            )}

            <dl className="grid gap-4 rounded-xl border bg-white p-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Orden de compra
                </dt>
                <dd className="mt-1 font-semibold">{data.orderNumber}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Total
                </dt>
                <dd className="mt-1 font-semibold">
                  {formatPurchaseOrderCurrency(data.totalAmount, data.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Firmante
                </dt>
                <dd className="mt-1 font-semibold">{data.signerName}</dd>
                <dd className="text-sm text-muted-foreground">
                  {data.signerRole}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Tipo de sello
                </dt>
                <dd className="mt-1 font-semibold">
                  {data.sealType === "approval"
                    ? "Aprobación registrada"
                    : "Aprobación no requerida"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Firmado (hora de Honduras)
                </dt>
                <dd className="mt-1 text-sm">
                  {formatDateTime(data.signedAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  PDF oficial generado (hora de Honduras)
                </dt>
                <dd className="mt-1 text-sm">
                  {formatDateTime(data.sealedAt)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileCheck2 className="h-5 w-5" />
              Comprobar archivo PDF
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Selecciona el PDF recibido. La huella SHA-256 se calcula en este
              dispositivo; el archivo no se sube a BuildReq.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={verifyFile}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={checkingFile}
            >
              {checkingFile ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Seleccionar PDF
            </Button>

            {fileResult ? (
              <div
                className={`rounded-xl border px-4 py-3 text-sm ${
                  fileResult.matches
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-rose-200 bg-rose-50 text-rose-800"
                }`}
              >
                <p className="flex items-center gap-2 font-semibold">
                  {fileResult.matches ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  {fileResult.error
                    ? fileResult.error
                    : fileResult.matches
                      ? "El archivo coincide exactamente con el PDF oficial."
                      : "El archivo no coincide con el PDF oficial."}
                </p>
                {fileResult.hash ? (
                  <p className="mt-2 break-all font-mono text-[11px]">
                    {fileResult.fileName}: {fileResult.hash}
                  </p>
                ) : null}
              </div>
            ) : null}

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium">
                Ver huella oficial
              </summary>
              <p className="mt-2 break-all rounded-lg bg-muted p-3 font-mono">
                {data.officialPdfHash}
              </p>
            </details>
          </CardContent>
        </Card>

        <p className="text-center text-xs leading-5 text-muted-foreground">
          Este es un sello electrónico auditable de BuildReq. No constituye una
          firma criptográfica PAdES certificada.
        </p>
      </div>
    </main>
  );
}
