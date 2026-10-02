import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";

// Social preview: a 1200×630 capture of the landing (title, start button, the live depot at night),
// one per locale. Regenerate with playtest/scripts/og-{en,es}.json against a production build.
export const alt = "Column Depot · Learn ClickHouse";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const file = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  return new Response(await readFile(join(process.cwd(), "public/og", `${file}.png`)), { headers: { "Content-Type": contentType } });
}
