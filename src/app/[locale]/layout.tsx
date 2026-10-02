import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IBM_Plex_Mono, Manrope, Space_Grotesk } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import "../globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
const ui = Manrope({ subsets: ["latin"], variable: "--font-ui" });
const code = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-code" });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL("https://learnclickhouse.crafter.run"),
    title: t("title"),
    description: t("description"),
    alternates: { canonical: `/${locale}`, languages: { en: "/en", es: "/es" } },
    openGraph: {
      type: "website",
      siteName: "Column Depot",
      title: t("title"),
      description: t("description"),
      url: `/${locale}`,
      locale: locale === "es" ? "es_ES" : "en_US",
    },
    twitter: { card: "summary_large_image", title: t("title"), description: t("description") },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${display.variable} ${ui.variable} ${code.variable}`}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
