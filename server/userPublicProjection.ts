import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { User } from "../drizzle/schema";

type UserProfileField = "phone" | "jobTitle" | "identityNumber";
export type PublicUser = Omit<User, UserProfileField>;

/** Operational documents show account references, not personal profile data. */
export function selectPublicUserColumns<T extends PgTable>(table: T) {
  const {
    phone: _phone,
    jobTitle: _jobTitle,
    identityNumber: _identityNumber,
    ...columns
  } = getTableColumns(table);
  return columns;
}

export function omitUserProfileFields<
  T extends { phone?: unknown; jobTitle?: unknown; identityNumber?: unknown },
>(user: T) {
  const {
    phone: _phone,
    jobTitle: _jobTitle,
    identityNumber: _identityNumber,
    ...publicUser
  } = user;
  return publicUser;
}
