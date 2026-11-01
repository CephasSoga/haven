import {
  Banknote,
  Briefcase,
  Car,
  CircleDashed,
  Coffee,
  Coins,
  CreditCard,
  Dumbbell,
  Film,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  Laptop,
  PawPrint,
  PiggyBank,
  Plane,
  Repeat,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  TrendingUp,
  Utensils,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Icons a category can use. Stored by name so data stays serializable. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  ShoppingBasket,
  Utensils,
  Coffee,
  Home,
  Car,
  Zap,
  HeartPulse,
  ShoppingBag,
  Shirt,
  Film,
  Plane,
  Repeat,
  Smartphone,
  Dumbbell,
  GraduationCap,
  PawPrint,
  Gift,
  Briefcase,
  Laptop,
  Coins,
  TrendingUp,
  PiggyBank,
  CircleDashed,
};

export function categoryIcon(name: string): LucideIcon {
  return CATEGORY_ICONS[name] ?? CircleDashed;
}

export const ACCOUNT_KINDS = {
  checking: { label: "Checking", icon: Landmark },
  savings: { label: "Savings", icon: PiggyBank },
  cash: { label: "Cash", icon: Banknote },
  credit: { label: "Credit card", icon: CreditCard },
  wallet: { label: "Wallet", icon: Wallet },
} as const;

export type AccountKind = keyof typeof ACCOUNT_KINDS;
