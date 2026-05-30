import type { ReactNode } from "react";
import { palette } from "@/services/theme";
import "./globals.css";

export const metadata = {
  title: "Pancreator Repository Dashboard",
  description: "Operator-local v0 dashboard for repository relationships and activity",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: palette.eggshell, color: palette["midnight-violet"] }}>
        {children}
      </body>
    </html>
  );
}
