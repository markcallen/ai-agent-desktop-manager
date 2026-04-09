import { z } from 'zod';
import {
  AadmRequestError,
  requestJson,
  type RequestJsonOptions
} from '../util/aadm-client.js';

type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type InvokeDeps = Pick<RequestJsonOptions, 'fetchImpl' | 'baseUrl'>;

const createDesktopSchema = z.object({
  owner: z.string().optional(),
  label: z.string().optional(),
  ttlMinutes: z.number().int().positive().optional(),
  startUrl: z.string().url().optional(),
  routeAuthMode: z.enum(['inherit', 'none', 'auth_request', 'token']).optional()
});

const idSchema = z.object({
  id: z.string().min(1)
});

const listSchema = z.object({});

export const desktopToolDefinitions = [
  {
    name: 'desktop.create',
    description: 'Create a new managed desktop.',
    inputSchema: createDesktopSchema
  },
  {
    name: 'desktop.list',
    description: 'List all managed desktops.',
    inputSchema: listSchema
  },
  {
    name: 'desktop.get',
    description: 'Fetch one desktop by id.',
    inputSchema: idSchema
  },
  {
    name: 'desktop.destroy',
    description: 'Destroy one desktop by id.',
    inputSchema: idSchema
  },
  {
    name: 'desktop.doctor',
    description: 'Run doctor checks for one desktop.',
    inputSchema: idSchema
  }
] as const;

function successResult(data: unknown): McpToolResult {
  const structuredContent =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { result: data };

  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent
  };
}

function errorResult(error: unknown): McpToolResult {
  if (error instanceof AadmRequestError) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: false,
              status: error.status,
              data: error.data
            },
            null,
            2
          )
        }
      ],
      structuredContent: { ok: false, status: error.status, data: error.data }
    };
  }

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            ok: false,
            error: String((error as Error)?.message ?? error)
          },
          null,
          2
        )
      }
    ]
  };
}

function validatedArgs<T extends z.ZodTypeAny>(schema: T, args: unknown) {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new Error(
      `invalid_arguments:${parsed.error.issues.map((issue) => issue.message).join(', ')}`
    );
  }
  return parsed.data;
}

export async function invokeDesktopTool(
  name: (typeof desktopToolDefinitions)[number]['name'],
  args: Record<string, unknown> = {},
  deps: InvokeDeps = {}
) {
  try {
    switch (name) {
      case 'desktop.create': {
        const body = validatedArgs(createDesktopSchema, args);
        return successResult(
          await requestJson('/v1/desktops', {
            method: 'POST',
            body,
            ...deps
          })
        );
      }
      case 'desktop.list':
        validatedArgs(listSchema, args);
        return successResult(await requestJson('/v1/desktops', deps));
      case 'desktop.get': {
        const { id } = validatedArgs(idSchema, args);
        return successResult(await requestJson(`/v1/desktops/${id}`, deps));
      }
      case 'desktop.destroy': {
        const { id } = validatedArgs(idSchema, args);
        return successResult(
          await requestJson(`/v1/desktops/${id}`, {
            method: 'DELETE',
            ...deps
          })
        );
      }
      case 'desktop.doctor': {
        const { id } = validatedArgs(idSchema, args);
        return successResult(
          await requestJson(`/v1/desktops/${id}/doctor`, deps)
        );
      }
      default:
        throw new Error(`unknown_tool:${String(name)}`);
    }
  } catch (error) {
    return errorResult(error);
  }
}
