import { z } from "zod";

export const CreateCommitmentSchema = z.object({
  requestId: z.uuid(),
  clusterId: z.uuid(),
});

export const CommitmentStatusQuerySchema = z.object({ requestId: z.uuid() });
export const AcceptProposalSchema = z.object({ proposalId: z.uuid() });

export const IntegrityEvidenceSchema = z.object({
  requirement: z.string().trim().min(3).max(200),
  evidence: z.string().trim().min(3).max(1000),
  url: z.url({ protocol: /^https?$/ }).optional().or(z.literal("")),
});

export const IntegritySubmissionSchema = z.object({
  projectUrl: z.url({ protocol: /^https?$/ }),
  demoUrl: z.url({ protocol: /^https?$/ }).optional().or(z.literal("")),
  repositoryUrl: z.url({ protocol: /^https?$/ }).optional().or(z.literal("")),
  notes: z.string().trim().max(5000).default(""),
  evidence: z.array(IntegrityEvidenceSchema).min(1).max(30),
});

export type IntegritySubmissionInput = z.infer<typeof IntegritySubmissionSchema>;
