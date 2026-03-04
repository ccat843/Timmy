import { z, type infer as ZodInfer } from 'zod';

export const extensionFeedSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  name: z.string().min(1),
  url: z.union([z.string().min(1), z.record(z.string(), z.string())]),
  type: z.string().optional(),
  region: z.string().optional(),
  propagandaRisk: z.enum(['low', 'medium', 'high']).optional(),
  stateAffiliated: z.string().optional(),
  lang: z.string().optional(),
});

export const extensionManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  enabled: z.boolean().default(true),
  contributions: z.object({
    feeds: z.array(extensionFeedSchema).default([]),
  }).default({ feeds: [] }),
});

export type ExtensionFeedContribution = ZodInfer<typeof extensionFeedSchema>;
export type ExtensionManifest = ZodInfer<typeof extensionManifestSchema>;

export function parseExtensionManifest(input: unknown): ExtensionManifest {
  return extensionManifestSchema.parse(input);
}
