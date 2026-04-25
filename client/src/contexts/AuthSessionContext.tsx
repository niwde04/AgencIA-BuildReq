import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type AuthSessionContextValue = {
  ready: boolean;
  clearBackendSession: () => Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | undefined>(
  undefined
);

type AuthSessionProviderProps = {
  children: React.ReactNode;
};

export function AuthSessionProvider({ children }: AuthSessionProviderProps) {
  const utils = trpc.useUtils();
  const [ready, setReady] = useState(false);
  const lastSyncedTokenRef = useRef<string | null>(null);
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const clearPromiseRef = useRef<Promise<void> | null>(null);
  const utilsRef = useRef(utils);

  const syncSessionMutation = trpc.auth.syncSupabaseSession.useMutation({
    onSuccess: () => {
      void utils.auth.me.invalidate();
    },
  });
  const clearSessionMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });
  const syncSessionMutationRef = useRef(syncSessionMutation.mutateAsync);
  const clearSessionMutationRef = useRef(clearSessionMutation.mutateAsync);

  useEffect(() => {
    utilsRef.current = utils;
  }, [utils]);

  useEffect(() => {
    syncSessionMutationRef.current = syncSessionMutation.mutateAsync;
  }, [syncSessionMutation.mutateAsync]);

  useEffect(() => {
    clearSessionMutationRef.current = clearSessionMutation.mutateAsync;
  }, [clearSessionMutation.mutateAsync]);

  const syncBackendSession = useCallback(async (token: string) => {
    if (lastSyncedTokenRef.current === token) {
      return;
    }

    if (syncPromiseRef.current) {
      await syncPromiseRef.current;
      if (lastSyncedTokenRef.current === token) {
        return;
      }
    }

    const syncPromise = (async () => {
      await syncSessionMutationRef.current({ token });
      lastSyncedTokenRef.current = token;
    })();

    syncPromiseRef.current = syncPromise;

    try {
      await syncPromise;
    } finally {
      if (syncPromiseRef.current === syncPromise) {
        syncPromiseRef.current = null;
      }
    }
  }, []);

  const clearBackendSession = useCallback(async () => {
    lastSyncedTokenRef.current = null;
    utilsRef.current.auth.me.setData(undefined, null);

    if (clearPromiseRef.current) {
      await clearPromiseRef.current;
      return;
    }

    const clearPromise = (async () => {
      try {
        await clearSessionMutationRef.current();
      } catch (error) {
        console.error("[Auth] Failed to clear backend session", error);
      }
    })();

    clearPromiseRef.current = clearPromise;

    try {
      await clearPromise;
    } finally {
      if (clearPromiseRef.current === clearPromise) {
        clearPromiseRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!active) return;

        if (session?.access_token) {
          await syncBackendSession(session.access_token);
        } else {
          void clearBackendSession();
        }
      } catch (error) {
        console.error("[Auth] Failed to bootstrap session bridge", error);
      } finally {
        if (active) {
          setReady(true);
        }
      }
    };

    void bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      if (
        (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
        session?.access_token
      ) {
        void syncBackendSession(session.access_token).catch(error => {
          console.error("[Auth] Failed to sync backend session", error);
        });
        return;
      }

      if (event === "SIGNED_OUT" && !session) {
        void clearBackendSession();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [clearBackendSession, syncBackendSession]);

  const value = useMemo(
    () => ({ ready, clearBackendSession }),
    [clearBackendSession, ready]
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }
  return context;
}
