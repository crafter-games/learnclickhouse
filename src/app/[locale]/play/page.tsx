import { setRequestLocale } from "next-intl/server";
import { DepotDesk } from "@/components/DepotDesk";

export default async function PlayPage({ params }: PageProps<"/[locale]/play">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DepotDesk />;
}
