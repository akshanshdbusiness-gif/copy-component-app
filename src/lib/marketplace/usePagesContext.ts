"use client";

import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import { useEffect, useState } from "react";

export interface PageContextValue {
  pageId: string;
  pagePath: string;
  pageName: string;
  language: string;
  siteName?: string;
  presentationDetails?: string;
  canWrite: boolean;
}

/**
 * Pages pushes a new context every time the author navigates the canvas or
 * switches language, so this subscribes rather than reading once — otherwise
 * the panel would keep offering components from the page the author has left.
 */
export function usePagesContext(client: ClientSDK | null) {
  const [context, setContext] = useState<PageContextValue | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!client) return;
    let unsubscribe: (() => void) | undefined;
    let active = true;

    client
      .query("pages.context", {
        subscribe: true,
        onSuccess: (value) => {
          if (active) {
            setContext(toContextValue(value));
            setIsLoading(false);
          }
        },
        onError: (err) => {
          if (active) {
            setError(err);
            setIsLoading(false);
          }
        },
      })
      .then((result) => {
        if (!active) {
          result.unsubscribe?.();
          return;
        }
        unsubscribe = result.unsubscribe;
        if (result.data) setContext(toContextValue(result.data));
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [client]);

  return { context, error, isLoading };
}

function toContextValue(raw: unknown): PageContextValue | null {
  const context = raw as {
    pageInfo?: Record<string, unknown>;
    siteInfo?: Record<string, unknown>;
  } | null;
  const page = context?.pageInfo;
  if (!page) return null;

  const permissions = page.permissions as { canWrite?: boolean } | undefined;

  return {
    pageId: String(page.id ?? ""),
    pagePath: String(page.path ?? ""),
    pageName: String(page.displayName || page.name || ""),
    language: String(page.language ?? ""),
    siteName: context?.siteInfo?.name ? String(context.siteInfo.name) : undefined,
    presentationDetails:
      typeof page.presentationDetails === "string" ? page.presentationDetails : undefined,
    canWrite: permissions?.canWrite !== false,
  };
}
