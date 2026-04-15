export const STANDARD_PURCHASE_LEAD_DAYS = 5;

export const PURCHASE_URGENCY_VALUES = ["urgente", "no_urgente"] as const;
export type PurchaseUrgency = (typeof PURCHASE_URGENCY_VALUES)[number];

export const PURCHASE_URGENCY_LABELS: Record<PurchaseUrgency, string> = {
  urgente: "Urgente",
  no_urgente: "No urgente",
};

export const PURCHASE_POLICY_COPY = `Definiciones:
- Compra Urgente: Aquella cuya fecha necesaria es menor al tiempo estándar de ${STANDARD_PURCHASE_LEAD_DAYS} días calendario definido en la política.
- Compra No Urgente: Aquella que respeta el tiempo estándar de planificación de compras.`;

export function addCalendarDays(date: Date, days: number) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

export function calculateDefaultNeededBy(baseDate = new Date()) {
  const neededBy = addCalendarDays(baseDate, STANDARD_PURCHASE_LEAD_DAYS);
  neededBy.setHours(12, 0, 0, 0);
  return neededBy;
}

export function parseDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error("Fecha inválida");
  }
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateForDisplay(
  date: Date | string | null | undefined,
  locale = "es-HN"
) {
  if (!date) return "Sin fecha definida";
  const dateValue = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(dateValue);
}

export function getNeededByDate(
  purchaseUrgency: PurchaseUrgency | null | undefined,
  neededBy: Date | string | null | undefined,
  createdAt?: Date | string | null
) {
  if (neededBy) {
    return neededBy instanceof Date ? neededBy : new Date(neededBy);
  }

  const baseDate = createdAt ? new Date(createdAt) : new Date();
  return purchaseUrgency === "urgente" ? null : calculateDefaultNeededBy(baseDate);
}

export function isUrgentDateWithinPolicy(
  neededBy: Date,
  baseDate = new Date()
) {
  const threshold = calculateDefaultNeededBy(baseDate);
  return neededBy.getTime() < threshold.getTime();
}

export function getDueDateStatus(date: Date | string | null | undefined) {
  if (!date) return null;

  const neededBy = date instanceof Date ? new Date(date) : new Date(date);
  const today = new Date();
  const normalizedNeededBy = new Date(
    neededBy.getFullYear(),
    neededBy.getMonth(),
    neededBy.getDate()
  );
  const normalizedToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  const diffDays = Math.round(
    (normalizedNeededBy.getTime() - normalizedToday.getTime()) / 86_400_000
  );

  if (diffDays < 0) {
    return { label: "Vencida", tone: "late" as const };
  }
  if (diffDays === 0) {
    return { label: "Vence hoy", tone: "today" as const };
  }
  if (diffDays <= 2) {
    return { label: "Próxima", tone: "soon" as const };
  }
  return { label: "En fecha", tone: "ok" as const };
}
