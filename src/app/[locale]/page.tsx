import { setRequestLocale } from "next-intl/server";
import { Landing } from "@/components/Landing";

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Landing />;
}
