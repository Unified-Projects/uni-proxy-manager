"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@uni-proxy-manager/ui";
import {
  Globe,
  Shield,
  ShieldCheck,
  FileWarning,
  Wrench,
  Cloud,
  Settings,
  LayoutDashboard,
  Layers,
  FileText,
  BarChart3,
  Share2,
  Network,
} from "lucide-react";
import { useSitesExtensionEnabled, usePomeriumExtensionEnabled, useAnalyticsExtensionEnabled } from "@/hooks";

const coreNavigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Domains", href: "/domains", icon: Globe },
  { name: "Certificates", href: "/certificates", icon: Shield },
  { name: "DNS Providers", href: "/dns-providers", icon: Cloud },
  { name: "Error Pages", href: "/error-pages", icon: FileWarning },
  { name: "Maintenance Pages", href: "/maintenance-pages", icon: FileText },
  { name: "Maintenance Mode", href: "/maintenance", icon: Wrench },
  { name: "Shared Backends", href: "/shared-backends", icon: Share2 },
  { name: "Cluster", href: "/cluster", icon: Network },
  { name: "Settings", href: "/settings", icon: Settings },
];

const sitesNavigation = [
  { name: "Sites", href: "/sites", icon: Layers },
];

const pomeriumNavigation = [
  { name: "Access Control", href: "/pomerium", icon: ShieldCheck },
];

const analyticsNavigation = [
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();
  const { enabled: sitesEnabled } = useSitesExtensionEnabled();
  const { enabled: pomeriumEnabled } = usePomeriumExtensionEnabled();
  const { enabled: analyticsEnabled } = useAnalyticsExtensionEnabled();

  const navigation = [
    ...coreNavigation,
    ...(sitesEnabled ? sitesNavigation : []),
    ...(pomeriumEnabled ? pomeriumNavigation : []),
    ...(analyticsEnabled ? analyticsNavigation : []),
  ];

  return (
    <div className="flex h-full w-16 shrink-0 flex-col border-r bg-card xl:w-64">
      <div className="flex h-16 items-center justify-center border-b px-2 xl:justify-start xl:px-6">
        <Link href="/" className="flex items-center gap-3 font-semibold">
          <Image
            src="/icon.svg"
            alt="Uni-Proxy-Manager"
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="hidden text-slate-800 dark:text-slate-200 xl:inline">
            Uni-Proxy-Manager
          </span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2 xl:p-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              title={item.name}
              className={cn(
                "flex items-center justify-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-colors xl:justify-start xl:px-3",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="hidden truncate xl:inline">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="hidden border-t p-4 xl:block">
        <p className="truncate text-xs text-muted-foreground">
          Uni-Proxy-Manager v0.1.3
        </p>
      </div>
    </div>
  );
}
