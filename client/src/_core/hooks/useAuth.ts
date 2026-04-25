import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { useAuthSession } from "@/contexts/AuthSessionContext";
import { useCallback, useEffect, useMemo } from "react";

export function useAuth(options?: { redirectOnUnauthenticated?: boolean }) {
  const { redirectOnUnauthenticated = false } = options ?? {};
  const utils = trpc.useUtils();
  const { clearBackendSession, ready: authSessionReady } = useAuthSession();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logout = useCallback(async () => {
    utils.auth.me.setData(undefined, null);
    const [signOutResult] = await Promise.all([
      supabase.auth.signOut().catch(error => ({ error })),
      clearBackendSession(),
    ]);

    if (signOutResult.error) {
      console.error("[Auth] Supabase sign out failed", signOutResult.error);
    }
  }, [clearBackendSession, utils]);

  const hasResolvedUser = meQuery.data !== undefined || meQuery.isError;
  const isResolvingUser =
    !hasResolvedUser && (meQuery.isLoading || meQuery.isFetching);

  const state = useMemo(
    () => ({
      user: meQuery.data ?? null,
      loading: !authSessionReady || isResolvingUser,
      error: meQuery.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    }),
    [authSessionReady, isResolvingUser, meQuery.data, meQuery.error]
  );

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (!authSessionReady || isResolvingUser) return;
    if (state.user) return;
    // Redirect to home (login page)
    window.location.href = "/";
  }, [
    authSessionReady,
    isResolvingUser,
    redirectOnUnauthenticated,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
