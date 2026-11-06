"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// Cloudflare Turnstile for the chat box. Inert unless the server says it is on
// (GET /api/brain?probe=turnstile) - a deploy without the keys shows nothing.
// Tokens live only in refs (memory): no cookie, no localStorage.

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
};
const api = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

export type TurnstileControl = {
  /** fields to merge into the chat request body */
  fields: () => { turnstileToken?: string; humanToken?: string };
  /** call with every successful chat response */
  accept: (data: { humanToken?: string }) => void;
  /** call when the server answered turnstileRequired */
  reject: () => void;
};

export function useTurnstile(): { control: TurnstileControl; widget: ReactNode } {
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const cfToken = useRef<string | null>(null);
  const humanToken = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/brain?probe=turnstile", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled?: boolean; siteKey?: string | null } | null) => {
        if (alive && d?.enabled && d.siteKey) setSiteKey(d.siteKey);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!siteKey || !container.current) return;
    const el = container.current;
    const mount = () => {
      const t = api();
      if (!t || widgetId.current) return;
      widgetId.current = t.render(el, {
        sitekey: siteKey,
        callback: (token: string) => {
          cfToken.current = token;
        },
        "expired-callback": () => {
          cfToken.current = null;
        },
        "error-callback": () => {
          cfToken.current = null;
        },
      });
    };
    if (api()) {
      mount();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>("script[data-sg16-turnstile]");
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.dataset.sg16Turnstile = "1";
      document.head.appendChild(script);
    }
    script.addEventListener("load", mount);
    return () => script.removeEventListener("load", mount);
  }, [siteKey]);

  const control = useMemo<TurnstileControl>(
    () => ({
      fields: () =>
        humanToken.current
          ? { humanToken: humanToken.current }
          : cfToken.current
            ? { turnstileToken: cfToken.current }
            : {},
      accept: (data) => {
        if (data.humanToken) {
          humanToken.current = data.humanToken;
          cfToken.current = null;
        }
      },
      reject: () => {
        humanToken.current = null;
        cfToken.current = null;
        const t = api();
        if (t && widgetId.current) t.reset(widgetId.current);
      },
    }),
    [],
  );

  const widget = siteKey ? <div ref={container} className="mx-3 mt-2 flex-none" /> : null;
  return { control, widget };
}
