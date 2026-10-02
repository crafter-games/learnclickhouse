import { setRequestLocale } from "next-intl/server";
import { Exam } from "@/components/Exam";

export default async function ExamPage({ params }: PageProps<"/[locale]/exam">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Exam />;
}
