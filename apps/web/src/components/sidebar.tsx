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
    <div className="flex h-full w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/" className="flex items-center gap-3 font-semibold">
          <Image
            src="/icon.svg"
            alt="Uni-Proxy-Manager"
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="text-slate-800 dark:text-slate-200">Uni-Proxy-Manager</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-4">
        <p className="text-xs text-muted-foreground">
          Uni-Proxy-Manager v0.1.0
        </p>
      </div>
    </div>
  );
}
