import type { ReactNode } from "react";

export const metadata = { title: "Meta Ads Dashboard" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#f6f7f9",
          color: "#1c1e21",
        }}
      >
        {children}
      </body>
    </html>
  );
}
