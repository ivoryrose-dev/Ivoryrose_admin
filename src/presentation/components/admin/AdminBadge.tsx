"use client";

import type { ReactNode } from "react";

type AdminBadgeVariant = "default" | "success" | "warning" | "danger" | "info";

type AdminBadgeProps = {
  children: ReactNode;
  variant?: AdminBadgeVariant;
  className?: string;
};

const variantClasses: Record<AdminBadgeVariant, string> = {
  default:
    "bg-slate-800/80 text-slate-200 border-slate-600",
  success:
    "bg-emerald-900/70 text-emerald-200 border-emerald-700",
  warning:
    "bg-amber-900/70 text-amber-200 border-amber-700",
  danger:
    "bg-red-900/70 text-red-200 border-red-700",
  info:
    "bg-sky-900/70 text-sky-200 border-sky-700",
};

/**
 * AdminBadge is a small pill used to highlight statuses such as Active/Inactive.
 * Choose a variant to map to semantic meaning; content comes from the caller.
 */
export function AdminBadge({
  children,
  variant = "default",
  className = "",
}: AdminBadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}

