import type { Permission } from "@/domain/auth/permissions";

/**
 * Admin sidebar navigation. The layout renders this list dynamically.
 */

export type AdminNavItem = {
  href: string;
  label: string;
  icon?: string;
  permission: Permission;
};

export const ADMIN_NAVIGATION: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "dashboard", permission: "dashboard.read" },
  { href: "/admin/products", label: "Products", icon: "products", permission: "products.read" },
  { href: "/admin/tags", label: "Tags", icon: "tags", permission: "tags.read" },
  { href: "/admin/rates", label: "Rates", icon: "rates", permission: "rates.read" },
  { href: "/admin/gold-rate", label: "Gold Rate", icon: "goldRate", permission: "goldRate.read" },
  { href: "/admin/bulk-import", label: "Bulk Import", icon: "bulkImport", permission: "imports.run" },
  { href: "/admin/sync-logs", label: "Sync Logs", icon: "syncLogs", permission: "syncLogs.read" },
  { href: "/admin/users", label: "Users", icon: "users", permission: "users.manage" },
  { href: "/admin/settings", label: "Settings", icon: "settings", permission: "settings.manage" },
];
