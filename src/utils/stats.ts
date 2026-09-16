import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'loomap_contribution_stats';

export type ContributionStats = {
  added: number;
  confirmed: number;
  statusUpdated: number;
};

const EMPTY: ContributionStats = { added: 0, confirmed: 0, statusUpdated: 0 };

export async function getStats(): Promise<ContributionStats> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return EMPTY;
  }
}

async function bump(field: keyof ContributionStats): Promise<ContributionStats> {
  const current = await getStats();
  const next = { ...current, [field]: current[field] + 1 };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore write failures — stats are non-critical
  }
  return next;
}

export const recordAdded = () => bump('added');
export const recordConfirmed = () => bump('confirmed');
export const recordStatusUpdated = () => bump('statusUpdated');
