"use client";

import { ClientSDK } from "@sitecore-marketplace-sdk/client";
import { XMC } from "@sitecore-marketplace-sdk/xmc";
import { useEffect, useState } from "react";
import { withTimeout } from "./with-timeout";

export interface MarketplaceClientState {
  client: ClientSDK | null;
  error: Error | null;
  isLoading: boolean;
}

/**
 * The SDK gives up after five handshake attempts but leaves its promise
 * pending rather than rejecting, so without a deadline of our own the panel
 * spins forever for anyone who opens the deployment URL outside Pages.
 */
const HANDSHAKE_TIMEOUT_MS = 15_000;

/**
 * One SDK instance per browsing context — the handshake targets window.parent
 * and re-running it would leave a second listener attached to the same frame.
 */
let shared: Promise<ClientSDK> | null = null;

function getClient(): Promise<ClientSDK> {
  shared ??= ClientSDK.init({ target: window.parent, modules: [XMC] });
  return shared;
}

export function useMarketplaceClient(): MarketplaceClientState {
  const [state, setState] = useState<MarketplaceClientState>({
    client: null,
    error: null,
    isLoading: true,
  });

  useEffect(() => {
    let active = true;

    withTimeout(getClient(), HANDSHAKE_TIMEOUT_MS, "Timed out connecting to Pages")
      .then((client) => {
        if (active) setState({ client, error: null, isLoading: false });
      })
      .catch((error: unknown) => {
        if (!active) return;
        // A failed handshake almost always means the app is open outside the
        // Pages iframe; the panel says so rather than spinning forever.
        shared = null;
        setState({
          client: null,
          error: error instanceof Error ? error : new Error(String(error)),
          isLoading: false,
        });
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
}
