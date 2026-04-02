import { z } from 'zod';

export const CreateDesktopBody = z.object({
  owner: z.string().optional(),
  label: z.string().optional(),
  ttlMinutes: z.number().int().positive().optional(),
  startUrl: z.string().url().optional()
});
