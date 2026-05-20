"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import { ADMIN_NAVIGATION } from "@/config/admin-navigation";
import { AuthProvider, useAuth } from "@/presentation/auth/AuthContext";
import { ProtectedRoute } from "@/presentation/auth/ProtectedRoute";

const SIDEBAR_BG = "#111827";
const BG = "#F6F7FB";
const ACCENT = "#D4AF37";

const NAV_ICONS: Record<string, ReactNode> = {
  dashboard: (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  ),
  products: (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8 4-8-4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  tags: (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    </svg>
  ),
  rates: (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  goldRate: (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
  bulkImport: (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  ),
  syncLogs: (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  users: (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m0-4a4 4 0 100-8 4 4 0 000 8zm8 0a4 4 0 100-8 4 4 0 000 8z" />
    </svg>
  ),
  settings: (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};

function getPageTitle(pathname: string): string {
  const exact = ADMIN_NAVIGATION.find(({ href }) => href === pathname);
  if (exact) return exact.label;
  const startsWith = ADMIN_NAVIGATION.filter(
    (item) => item.href !== "/admin" && pathname.startsWith(item.href + "/")
  ).sort((a, b) => b.href.length - a.href.length)[0];
  return startsWith?.label ?? "Admin";
}

function AdminShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { profile, logout, can } = useAuth();
  const visibleNavigation = ADMIN_NAVIGATION.filter((item) => can(item.permission));
  const activeNav = ADMIN_NAVIGATION.filter(
    (item) => item.href !== "/admin" && pathname.startsWith(item.href + "/")
  ).sort((a, b) => b.href.length - a.href.length)[0] ?? ADMIN_NAVIGATION.find((item) => item.href === pathname);

  return (
    <ProtectedRoute permission={activeNav?.permission ?? "dashboard.read"}>
      <div className="flex min-h-screen font-sans" style={{ backgroundColor: BG, color: "#18181B" }}>
      {/* Sidebar */}
      <aside
        className="sticky top-0 flex h-screen shrink-0 flex-col border-r border-slate-800 transition-[width] duration-200 ease-in-out"
        style={{ backgroundColor: SIDEBAR_BG, width: sidebarCollapsed ? 72 : 256 }}
        aria-label="Admin navigation"
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-3">
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <span className="block truncate text-sm font-semibold" style={{ color: ACCENT }}>
                Ivory Admin
              </span>
              <span className="block truncate text-xs text-slate-400">Operations console</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-[#E5E7EB] focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:ring-offset-2 focus:ring-offset-[#111827]"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg
              className={`h-5 w-5 transition-transform ${sidebarCollapsed ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          <ul className="space-y-0.5 px-2">
            {visibleNavigation.map(({ href, label, icon: iconKey }) => {
              const isActive =
                href === "/admin"
                  ? pathname === "/admin"
                  : pathname === href || pathname.startsWith(href + "/");
              const icon = iconKey ? NAV_ICONS[iconKey] : null;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-[#D4AF37]/12 text-[#D4AF37] ring-1 ring-[#D4AF37]/20"
                        : "text-slate-300 hover:bg-slate-800 hover:text-[#E5E7EB]"
                    } ${sidebarCollapsed ? "justify-center px-2" : ""}`}
                    title={sidebarCollapsed ? label : undefined}
                    style={isActive ? { color: ACCENT } : undefined}
                  >
                    <span className="flex shrink-0 items-center justify-center" style={isActive ? { color: ACCENT } : undefined}>
                      {icon}
                    </span>
                    {!sidebarCollapsed && <span className="truncate">{label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-slate-800 p-3">
          {!sidebarCollapsed && (
            <div className="mb-3 min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">
                {profile?.displayName || profile?.email || "Admin user"}
              </p>
              <p className="truncate text-xs text-slate-400">{profile?.role}</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => logout()}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-[#E5E7EB] ${
              sidebarCollapsed ? "justify-center px-2" : ""
            }`}
            title={sidebarCollapsed ? "Sign out" : undefined}
          >
            <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H9m4 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1" />
            </svg>
            {!sidebarCollapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Main area: header + content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top header */}
        <header
          className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-zinc-200 bg-white/95 px-6 backdrop-blur"
        >
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
              {getPageTitle(pathname)}
            </h1>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-5 lg:p-6">
          {children}
        </main>
      </div>
      </div>
    </ProtectedRoute>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AdminShell>{children}</AdminShell>
    </AuthProvider>
  );
}
