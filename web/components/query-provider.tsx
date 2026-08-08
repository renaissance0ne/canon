"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Mounted at the ONE leaf that polls, not at the root layout.
 *
 * AGENTS.md scopes TanStack Query to client-side polling of run status and
 * nothing else: every other screen in the console is a Server Component that
 * reads Postgres directly. A provider at the root would be an invitation to
 * start fetching on the client everywhere, which is the thing being avoided.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The run screen is often the only tab open and a run takes
            // minutes; refetching on focus would add nothing the interval is
            // not already doing.
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 0,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
