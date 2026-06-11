import type { ReactNode } from "react";
import { SurfaceShellGate } from "@/components/command-center/layout/SurfaceShellGate";
import { buildThemeStyleBlock } from "@/theme/theme";
import "./globals.css";
import "@/styles/surfaces.css";

export const metadata = {
  title: "Command Center",
  description: "Operator delivery surface for Pancreator pipeline work",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: buildThemeStyleBlock() }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <SurfaceShellGate>{children}</SurfaceShellGate>
      </body>
    </html>
  );
}
