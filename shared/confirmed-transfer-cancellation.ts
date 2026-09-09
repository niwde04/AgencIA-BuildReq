export const CONFIRMED_TRANSFER_CANCELLATION_ADMIN_EMAIL =
  "ed_barah@hotmail.com";

export function canCancelConfirmedTransfer(user: {
  role?: string | null;
  email?: string | null;
}) {
  return (
    user.role === "admin" &&
    user.email?.trim().toLowerCase() ===
      CONFIRMED_TRANSFER_CANCELLATION_ADMIN_EMAIL
  );
}
