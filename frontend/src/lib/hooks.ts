"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { PublicConfig, User } from "./types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User | null }>("/auth/me").then((r) => r.user),
    staleTime: 60_000,
  });
}

export function useRefreshMe() {
  const qc = useQueryClient();
  return (user?: User | null) => {
    if (user !== undefined) qc.setQueryData(["me"], user);
    return qc.invalidateQueries({ queryKey: ["me"] });
  };
}

export function usePublicConfig() {
  return useQuery({
    queryKey: ["public-config"],
    queryFn: () => api<PublicConfig>("/public/config"),
    staleTime: 5 * 60_000,
  });
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export const isStaffRole = (role?: string | null) => role === "ADMIN" || role === "OPERATOR";
