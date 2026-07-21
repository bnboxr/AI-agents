// BudgetService.ts — Manages spending budget in AsyncStorage

import AsyncStorage from '@react-native-async-storage/async-storage';

const BUDGET_KEY = '@hsmc_budget';
const SPENT_KEY = '@hsmc_spent';
const PERIOD_KEY = '@hsmc_budget_period';
const RESET_KEY = '@hsmc_budget_reset';

export interface Budget {
  limit: number;
  spent: number;
  period: 'daily' | 'weekly' | 'monthly';
  resetDate: number;
}

const DEFAULT_BUDGET: Budget = {
  limit: 500,
  spent: 0,
  period: 'monthly',
  resetDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
};

export async function getBudget(): Promise<Budget> {
  try {
    const [limit, spent, period, resetDate] = await Promise.all([
      AsyncStorage.getItem(BUDGET_KEY),
      AsyncStorage.getItem(SPENT_KEY),
      AsyncStorage.getItem(PERIOD_KEY),
      AsyncStorage.getItem(RESET_KEY),
    ]);

    const budget: Budget = {
      limit: limit ? parseFloat(limit) : DEFAULT_BUDGET.limit,
      spent: spent ? parseFloat(spent) : DEFAULT_BUDGET.spent,
      period: (period as Budget['period']) || DEFAULT_BUDGET.period,
      resetDate: resetDate ? parseInt(resetDate, 10) : DEFAULT_BUDGET.resetDate,
    };

    // Check if we need to reset the budget period
    if (Date.now() > budget.resetDate) {
      budget.spent = 0;
      const periodMs = budget.period === 'daily' ? 86400000
        : budget.period === 'weekly' ? 604800000
        : 2592000000;
      budget.resetDate = Date.now() + periodMs;
      await saveBudget(budget);
    }

    return budget;
  } catch {
    return DEFAULT_BUDGET;
  }
}

async function saveBudget(budget: Budget): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(BUDGET_KEY, budget.limit.toString()),
    AsyncStorage.setItem(SPENT_KEY, budget.spent.toString()),
    AsyncStorage.setItem(PERIOD_KEY, budget.period),
    AsyncStorage.setItem(RESET_KEY, budget.resetDate.toString()),
  ]);
}

export async function setBudget(limit: number, period: Budget['period'] = 'monthly'): Promise<void> {
  const periodMs = period === 'daily' ? 86400000
    : period === 'weekly' ? 604800000
    : 2592000000;

  const budget: Budget = { limit, spent: 0, period, resetDate: Date.now() + periodMs };
  await saveBudget(budget);
}

export async function checkBudget(amount: number): Promise<{ approved: boolean; remaining: number; limit: number }> {
  const budget = await getBudget();
  const remaining = budget.limit - budget.spent;
  return {
    approved: amount <= remaining,
    remaining: Math.max(0, remaining),
    limit: budget.limit,
  };
}

export async function recordSpend(amount: number): Promise<void> {
  const budget = await getBudget();
  budget.spent += amount;
  await saveBudget(budget);
}

export async function resetBudget(): Promise<void> {
  const budget = await getBudget();
  budget.spent = 0;
  const periodMs = budget.period === 'daily' ? 86400000
    : budget.period === 'weekly' ? 604800000
    : 2592000000;
  budget.resetDate = Date.now() + periodMs;
  await saveBudget(budget);
}
