import { setRequestLocale } from "next-intl/server";
import { DepotDesk } from "@/components/DepotDesk";

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DepotDesk />;
}
