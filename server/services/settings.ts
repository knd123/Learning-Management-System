import type { Settings } from '../../shared/types.ts';
import { C, type Store } from '../db/store.ts';

export const DEFAULT_SETTINGS: Settings = {
  id: 'global',
  organizationName: 'Abugida Education',
  timezone: 'Africa/Addis_Ababa',
  recordingAccessDays: 7,
  reminderHours: [12, 24],
  curriculumWindowDays: 14,
  quizGenerationDay: 20,
  quizQuestionCount: 10,
  quizAutoPublish: true,
  reportDay: 1,
  reportDelivery: 'auto',
  updatedAt: new Date(0).toISOString(),
};

export async function getSettings(store: Store): Promise<Settings> {
  const saved = await store.get<Settings>(C.settings, 'global');
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}
