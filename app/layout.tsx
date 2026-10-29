import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Careway | Make time for your health",
  description:
    "Choose a clinic appointment, book securely, and manage your visit.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
