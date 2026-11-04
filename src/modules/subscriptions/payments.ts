import { format } from "date-fns";
import { parseDay, todayKey } from "@/lib/dates";
import { showNotice } from "@/lib/notices";
import { uid } from "@/lib/utils";
import { useFinance } from "@/modules/finances/store";
import { useSubscriptions, type Subscription } from "./store";

/** The Finances account a subscription is paid from: its own choice, else the first account. */
export function paymentAccount(s: Subscription) {
  const { accounts } = useFinance.getState();
  return accounts.find((a) => a.id === s.accountId) ?? accounts[0];
}

/**
 * Marks one renewal as paid: an expense in Finances (Subscriptions category, the subscription's
 * account), dated the renewal day — or today when paying ahead — and the renewal remembered as paid.
 * A notice offers to undo it.
 */
export function markPaid(s: Subscription, date: string) {
  const { categories, saveTransaction } = useFinance.getState();
  const account = paymentAccount(s);
  if (!account) {
    showNotice({ tone: "warning", title: "Add an account in Finances first", body: "Payments are recorded as expenses on one of your accounts." });
    return;
  }
  const category = categories.find((c) => c.id === "subscriptions") ?? categories.find((c) => c.kind === "expense");
  const today = todayKey();
  const id = uid();
  saveTransaction({
    kind: "expense",
    amount: s.price,
    categoryId: category?.id ?? "",
    accountId: account.id,
    date: date <= today ? date : today,
    note: s.name,
    subscriptionId: s.id,
  });
  // saveTransaction gives new transactions their own id (and adds them at the end); find it to be able to undo.
  const tx = useFinance.getState().transactions.filter((t) => t.subscriptionId === s.id).at(-1);
  const before = s.paidThrough;
  useSubscriptions.getState().save({ ...s, paidThrough: date });
  showNotice({
    id: `paid:${s.id}:${id}`,
    tone: "info",
    title: `${s.name} marked as paid`,
    body: `${format(parseDay(date), "MMM d")} payment, recorded in Finances from ${account.name}.`,
    action: {
      label: "Undo",
      run: () => {
        if (tx) useFinance.getState().removeTransaction(tx.id);
        const now = useSubscriptions.getState().subs.find((x) => x.id === s.id);
        if (now) useSubscriptions.getState().save({ ...now, paidThrough: before });
      },
    },
  });
}
