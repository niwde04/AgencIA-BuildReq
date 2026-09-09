export const CONFIRMED_TRANSFER_CANCELLATION_ADMIN_EMAIL =
  "ed_barah@hotmail.com";

export const CONFIRMED_TRANSFER_CANCELLATION_CENTRAL_ADMIN_EMAIL =
  "cramon@hehhonduras.com";

export function canCancelConfirmedTransfer(user: {
  role?: string | null;
  buildreqRole?: string | null;
  email?: string | null;
}) {
  const email = user.email?.trim().toLowerCase();

  return (
    (user.role === "admin" &&
      email === CONFIRMED_TRANSFER_CANCELLATION_ADMIN_EMAIL) ||
    (user.buildreqRole === "administracion_central" &&
      email === CONFIRMED_TRANSFER_CANCELLATION_CENTRAL_ADMIN_EMAIL)
  );
}
