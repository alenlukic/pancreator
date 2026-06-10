import type { ReactNode } from "react";
import { SurfaceShellGate } from "@/components/cockpit/layout/SurfaceShellGate";
import { palette } from "@/services/theme";
import "./globals.css";

export const metadata = {
  title: "Command Center",
  description: "Operator delivery surface for Pancreator pipeline work",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: palette.eggshell, color: palette["midnight-violet"] }}>
        <SurfaceShellGate>{children}</SurfaceShellGate>
      </body>
    </html>
  );
}
