import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } from "jose";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { ForbiddenError } from "@shared/_core/errors";
import { COOKIE_NAME } from "@shared/const";

export type SupabaseJwtPayload = {
  sub: string;
  email?: string;
  user_metadata?: { name?: string; full_name?: string; email?: string };
  aud: string;
  role: string;
};

function isExpiredJwtError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (
    message.includes("JWTExpired") ||
    message.includes('"exp" claim timestamp check failed')
  );
}

// Fetches Supabase's public keys once and caches them (ECC P-256 / ES256)
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(
      new URL(`${ENV.supabaseUrl}/auth/v1/.well-known/jwks.json`)
    );
  }
  return _jwks;
}

/**
 * Verify a Supabase JWT.
 * - ES256 (new ECC P-256 keys): verified via JWKS endpoint.
 * - HS256 (legacy shared secret): verified with SUPABASE_JWT_SECRET.
 */
export async function verifySupabaseToken(
  token: string
): Promise<SupabaseJwtPayload | null> {
  try {
    const header = decodeProtectedHeader(token);

    if (header.alg === "HS256") {
      if (!ENV.supabaseJwtSecret) {
        console.warn("[Auth] SUPABASE_JWT_SECRET not configured for legacy HS256 token");
        return null;
      }
      const secret = new TextEncoder().encode(ENV.supabaseJwtSecret);
      const { payload } = await jwtVerify(token, secret, { audience: "authenticated" });
      return payload as unknown as SupabaseJwtPayload;
    }

    // ES256 and any future asymmetric alg — use JWKS
    if (!ENV.supabaseUrl) {
      console.warn("[Auth] SUPABASE_URL not configured");
      return null;
    }
    const { payload } = await jwtVerify(token, getJWKS(), { audience: "authenticated" });
    return payload as unknown as SupabaseJwtPayload;
  } catch (error) {
    if (isExpiredJwtError(error)) {
      return null;
    }
    console.warn("[Auth] Supabase JWT verification failed:", String(error));
    return null;
  }
}

/**
 * Extract Bearer token from Authorization header, or session cookie.
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  return cookies[COOKIE_NAME] ?? null;
}

/**
 * Authenticate an Express request.
 * Returns the DB User or throws ForbiddenError.
 */
export async function authenticateRequest(req: Request): Promise<User> {
  const token = extractToken(req);
  if (!token) {
    throw ForbiddenError("Missing auth token");
  }

  const payload = await verifySupabaseToken(token);
  if (!payload?.sub) {
    throw ForbiddenError("Invalid or expired token");
  }

  const openId = payload.sub;
  const email = payload.email ?? payload.user_metadata?.email ?? null;
  const name =
    payload.user_metadata?.full_name ??
    payload.user_metadata?.name ??
    null;

  await db.upsertUser({
    openId,
    email,
    name,
    loginMethod: "email",
    lastSignedIn: new Date(),
  });

  let user = await db.getUserByOpenId(openId);
  if (!user) {
    throw ForbiddenError("User not found after upsert");
  }

  // When the app uses Supabase email auth, apply any pending invitation by email
  // the first time the invited user signs in.
  if (!user.buildreqRole && email) {
    const pendingInvitation = await db.getInvitationByEmail(email);
    if (pendingInvitation) {
      await db.applyInvitationToUser(user.id, {
        buildreqRole: pendingInvitation.buildreqRole,
        assignedProjectId: pendingInvitation.assignedProjectId,
      });
      await db.acceptInvitation(pendingInvitation.id, user.id);
      user = await db.getUserByOpenId(openId);
      if (!user) {
        throw ForbiddenError("User not found after applying invitation");
      }
    }
  }

  // Bootstrap the very first account as the platform owner so setup
  // does not require a pre-existing administrator.
  if (user.role !== "admin" && !user.buildreqRole) {
    const bootstrapped = await db.bootstrapInitialAdmin(user.id);
    if (bootstrapped) {
      user = await db.getUserByOpenId(openId);
      if (!user) {
        throw ForbiddenError("User not found after bootstrap");
      }
    }
  }

  return user;
}
