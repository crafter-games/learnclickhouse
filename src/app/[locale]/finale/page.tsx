import { setRequestLocale } from "next-intl/server";
import { Finale } from "@/components/Finale";

export default async function FinalePage({ params }: PageProps<"/[locale]/finale">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Finale />;
}
