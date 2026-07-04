import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { getAdminSession } from "@/lib/admin";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "管理ダッシュボード",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) redirect("/");

  return <AdminDashboard />;
}
