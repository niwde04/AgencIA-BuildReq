import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { useAuthSession } from "@/contexts/AuthSessionContext";
import { useCallback, useEffect, useMemo, useState } from "react";

export function useAuth(options?: { redirectOnUnauthenticated?: boolean }) {
  const { redirectOnUnauthenticated = false } = options ?? {};
  const utils = trpc.useUtils();
  const { ready: authSessionReady } = useAuthSession();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    await logoutMutation.mutateAsync();
    utils.auth.me.setData(undefined, null);
    await utils.auth.me.invalidate();
  }, [logoutMutation, utils]);

  const isResolvingUser =
    !meQuery.data && (meQuery.isLoading || meQuery.isFetching);

  const state = useMemo(
    () => ({
      user: meQuery.data ?? null,
      loading:
        !authSessionReady || isResolvingUser || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    }),
    [
      authSessionReady,
      isResolvingUser,
      meQuery.data,
      meQuery.error,
      logoutMutation.error,
      logoutMutation.isPending,
    ]
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
