import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProofReceipt } from "@/components/ProofReceipt";
import { fetchTask, lookupTask } from "@/lib/onchain";
import { Unavailable } from "@/components/Unavailable";

export const revalidate = 5;

/* Be the public receipt for the work. */

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const task = await fetchTask(Number(params.id));
  return {
    title: task ? `Proof - ${task.title}` : "Proof",
    description: task?.acceptanceTest,
  };
}

export default async function ProofPage({ params }: { params: { id: string } }) {
  const found = await lookupTask(Number(params.id));
  if (found.status === "unavailable") return <Unavailable what="this receipt" />;
  if (found.status === "missing") notFound();
  const task = found.task;
  if (task.status !== "paid" && task.status !== "rejected") notFound();

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "34px 30px 0" }}>
      <ProofReceipt task={task} />
    </div>
  );
}
