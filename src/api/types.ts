import { z } from 'zod';
import { RouteAuthRequestModeSchema } from '../util/route-auth.js';

export const CreateDesktopBody = z.object({
  owner: z.string().optional(),
  label: z.string().optional(),
  ttlMinutes: z.number().int().positive().optional(),
  startUrl: z.string().url().optional(),
  routeAuthMode: RouteAuthRequestModeSchema.optional()
});
