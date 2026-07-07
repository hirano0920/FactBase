import { redirect } from "next/navigation";
import { DomainTrustPanel } from "@/components/admin/domain-trust-panel";
import { getAdminSession } from "@/lib/admin";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ドメイン信頼度フィルタ",
  robots: { index: false, follow: false },
};

export default async function DomainTrustAdminPage() {
  const session = await getAdminSession();
  if (!session) redirect("/");

  return <DomainTrustPanel />;
}
