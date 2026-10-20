import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "BorrelliChat",
    template: "%s | BorrelliChat",
  },
  description:
    "Automação de direct e comentários do Instagram para o Thiago Borrelli.",
  metadataBase: new URL("https://bot.thiagoborrelli.com"),
  openGraph: {
    title: "BorrelliChat",
    description:
      "Automação de direct e comentários do Instagram para o Thiago Borrelli.",
    url: "https://bot.thiagoborrelli.com",
    siteName: "BorrelliChat",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BorrelliChat",
    description:
      "Automação de direct e comentários do Instagram."
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("theme")==="dark"||(!localStorage.getItem("theme")&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
