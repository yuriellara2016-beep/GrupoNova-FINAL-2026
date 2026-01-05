export type TriggerResult = { ok: boolean; error?: string };

/**
 * Trigger a web rebuild/deploy using a provider build hook URL.
 * Works with Vercel/Netlify/GitHub Actions when using a webhook/build hook.
 */
export async function triggerWebDeploy(hookUrl: string, payload?: Record<string, any>): Promise<TriggerResult> {
  const fetchFn: typeof fetch | undefined = (globalThis as any).fetch;
  if (!fetchFn) {
    return { ok: false, error: 'Fetch API not available in this environment.' };
  }
  try {
    const res = await fetchFn(hookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    } as any);
    if (!res.ok) {
      const text = await (res as any).text?.().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Unknown error' };
  }
}