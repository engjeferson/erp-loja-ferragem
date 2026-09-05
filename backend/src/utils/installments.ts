import { randomUUID } from "crypto";

export interface InstallmentPlan {
  installmentGroupId: string | null;
  installmentNumber: number;
  installmentTotal: number;
  amount: number;
  dueDate: Date;
}

/**
 * Splits a total amount into N installments, monthly spaced from the first
 * due date. The last installment absorbs the rounding remainder so the sum
 * always matches the original total exactly.
 */
export function buildInstallments(
  total: number,
  count: number,
  firstDueDate: Date,
): InstallmentPlan[] {
  const installmentCount = Math.max(1, count);
  const groupId = installmentCount > 1 ? randomUUID() : null;
  const baseAmount = Math.floor((total / installmentCount) * 100) / 100;

  const plans: InstallmentPlan[] = [];
  let allocated = 0;

  for (let i = 0; i < installmentCount; i++) {
    const isLast = i === installmentCount - 1;
    const amount = isLast ? Math.round((total - allocated) * 100) / 100 : baseAmount;
    allocated += amount;

    const dueDate = new Date(firstDueDate);
    dueDate.setMonth(dueDate.getMonth() + i);

    plans.push({
      installmentGroupId: groupId,
      installmentNumber: i + 1,
      installmentTotal: installmentCount,
      amount,
      dueDate,
    });
  }

  return plans;
}
