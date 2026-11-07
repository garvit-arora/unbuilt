"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProposalForm, submitProposal } from "./proposal-form";

/** "Submit proposal" on the demand page's Builders tab (scene 5). Builders compete; the cluster is never locked. */
export function SubmitProposalDialog({ clusterId, clusterTitle }: { clusterId: string; clusterTitle: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Submit proposal</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Submit a proposal</DialogTitle>
          <DialogDescription>For “{clusterTitle}”. Other builders can propose too; buyers compare the proposals.</DialogDescription>
        </DialogHeader>
        <ProposalForm
          formLabel="Submit proposal"
          submitLabel="Submit proposal"
          onSubmit={async (values) => {
            await submitProposal(clusterId, values);
            setOpen(false);
            toast.success("Proposal submitted. Members of this demand were notified.");
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
