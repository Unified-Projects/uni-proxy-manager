"use client";

import { useEffect } from "react";

/**
 * Public analytics layout.
 * Renders as a full-viewport overlay to bypass the authenticated layout
 * (sidebar + padded main) that wraps the rest of the application.
 */
export default function PublicAnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Hide the parent sidebar container so the public page is standalone.
    const root = document.getElementById("app-shell");
    if (root) {
      root.dataset.publicPage = "true";
    }
    return () => {
      if (root) {
        delete root.dataset.publicPage;
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-background">
      {children}
    </div>
  );
}
