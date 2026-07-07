import { redirect } from "next/navigation";
import { RadarPipelinePanel } from "@/components/admin/radar-pipeline-panel";
import { getAdminSession } from "@/lib/admin";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Radar トピック選定",
  robots: { index: false, follow: false },
};

export default async function RadarPipelineAdminPage() {
  const session = await getAdminSession();
  if (!session) redirect("/");

  return <RadarPipelinePanel />;
}
