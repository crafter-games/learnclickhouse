import { setRequestLocale } from "next-intl/server";
import { MorningShift } from "@/components/MorningShift";

export default async function ReviewPage({ params }: PageProps<"/[locale]/review">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <MorningShift />;
}
