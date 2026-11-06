import type { MonthlyUsage } from '../../shared/api.ts';
import { addMonths, monthInZone } from '../../shared/time.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { AiUnavailableError, type AiMeter, type AiUsage } from './ai.ts';
import { notifyAdmins } from './notifications.ts';
import { getSettings } from './settings.ts';

/** Google bills by calendar month in Pacific time; the monthly allowances reset at the same moment. */
export const BILLING_TIME_ZONE = 'America/Los_Angeles';
/** Canadian dollars per US dollar, rounded up so estimates err on the high side. */
export const CAD_PER_USD = 1.45;
export const GIB = 1024 ** 3;

/**
 * Gemini list prices in US$ per million tokens (output includes thinking), on the high side on purpose:
 * Flash uses the prices Google set from January 1, 2027 (double November's), and any model that isn't
 * Flash or Flash-Lite is priced like Pro.
 */
export const AI_PRICES: Array<{ match: RegExp; input: number; output: number }> = [
  { match: /flash-lite/, input: 0.3, output: 2.5 },
  { match: /flash/, input: 1.5, output: 7.5 },
  { match: /./, input: 4, output: 20 },
];

export function aiCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = AI_PRICES.find((p) => p.match.test(model))!;
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}

export function usageMonth(now: Date): string {
  return monthInZone(now, BILLING_TIME_ZONE);
}

interface UsageDoc {
  id: string;
  videoBytes?: number;
  aiUsd?: number;
  aiRequests?: number;
  aiInputTokens?: number;
  aiOutputTokens?: number;
}

async function thisMonth(deps: Deps): Promise<{ month: string; doc: UsageDoc | null }> {
  const month = usageMonth(deps.now());
  return { month, doc: await deps.store.get<UsageDoc>(C.usage, month) };
}

/** "December 1": the first day of the month after `month` ("2026-11"). */
export function resetsOn(month: string): string {
  const [y, m] = addMonths(month, 1).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1, 12)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** Tells the team once a month that an allowance ran out. */
async function announceOnce(deps: Deps, key: 'video' | 'ai', month: string, title: string, body: string): Promise<void> {
  if (await deps.store.createIfAbsent(C.locks, { id: `allowance_${key}_${month}`, createdAt: deps.now().toISOString() })) {
    await notifyAdmins(deps, title, body, '/admin/settings');
  }
}

const gb = (bytes: number) => (bytes / GIB).toFixed(1);
const cad = (amount: number) => `CA$${amount.toFixed(2)}`;

/** False once students have played this month's recording allowance (and the team is told, once). */
export async function videoAllowanceLeft(deps: Deps): Promise<boolean> {
  const settings = await getSettings(deps.store);
  const { month, doc } = await thisMonth(deps);
  const used = doc?.videoBytes || 0;
  if (used < settings.videoMonthlyGb * GIB) return true;
  await announceOnce(
    deps,
    'video',
    month,
    'Recording playback paused until next month',
    `Students have played ${gb(used)} GB of class recordings this month, the allowance set in Settings. Recordings play again on ${resetsOn(month)}, or raise the allowance in Settings (each extra GB costs about CA$0.20).`,
  );
  return false;
}

export async function recordVideoBytes(deps: Deps, bytes: number): Promise<void> {
  if (bytes > 0) await deps.store.increment(C.usage, usageMonth(deps.now()), { videoBytes: bytes });
}

/** True while this month's AI spending is under the allowance. Doesn't tell anyone. */
export async function aiAllowanceLeft(deps: Deps): Promise<boolean> {
  const settings = await getSettings(deps.store);
  const { doc } = await thisMonth(deps);
  return (doc?.aiUsd || 0) * CAD_PER_USD < settings.aiMonthlyLimitCad;
}

/** The monthly AI allowance, checked before every Gemini request. Attach it to the deps once they exist. */
export class AiAllowance implements AiMeter {
  private deps?: Deps;

  attach(deps: Deps): this {
    this.deps = deps;
    return this;
  }

  async check(): Promise<void> {
    const deps = this.deps;
    if (!deps || (await aiAllowanceLeft(deps))) return;
    const settings = await getSettings(deps.store);
    const month = usageMonth(deps.now());
    await announceOnce(
      deps,
      'ai',
      month,
      'AI features paused until next month',
      `AI use this month has reached the ${cad(settings.aiMonthlyLimitCad)} allowance set in Settings. Until ${resetsOn(month)}, parent reports use the standard template, monthly quizzes wait, and homework drafts are off. Raise the allowance in Settings to turn them back on now.`,
    );
    throw new AiUnavailableError(`This month's AI allowance is used up. AI features come back on ${resetsOn(month)}; the Abugida team can raise the allowance in Settings.`);
  }

  async record(usage: AiUsage): Promise<void> {
    if (!this.deps) return;
    await this.deps.store.increment(C.usage, usageMonth(this.deps.now()), {
      aiUsd: aiCostUsd(usage.model, usage.inputTokens, usage.outputTokens),
      aiRequests: 1,
      aiInputTokens: usage.inputTokens,
      aiOutputTokens: usage.outputTokens,
    });
  }
}

export async function usageSummary(deps: Deps): Promise<MonthlyUsage> {
  const settings = await getSettings(deps.store);
  const { month, doc } = await thisMonth(deps);
  return {
    month,
    resetsOn: resetsOn(month),
    videoGb: Math.round(((doc?.videoBytes || 0) / GIB) * 100) / 100,
    videoLimitGb: settings.videoMonthlyGb,
    aiCad: Math.ceil((doc?.aiUsd || 0) * CAD_PER_USD * 100) / 100,
    aiLimitCad: settings.aiMonthlyLimitCad,
    aiRequests: doc?.aiRequests || 0,
  };
}
