import { setRequestLocale } from "next-intl/server";
import { WorldMap } from "@/components/WorldMap";

export default async function WorldPage({ params }: PageProps<"/[locale]/world">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <WorldMap />;
}
