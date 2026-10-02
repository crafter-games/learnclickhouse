import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { ALL_LEVELS, getLevel } from "@/levels";
import { LevelRoute } from "@/components/level/LevelRoute";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => ALL_LEVELS.map((l) => ({ locale, id: l.id })));
}

export default async function LevelPage({ params }: PageProps<"/[locale]/level/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!getLevel(id)) notFound();
  return <LevelRoute id={id} />;
}
