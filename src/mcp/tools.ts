import { z } from 'zod/v4';
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

const createDesktopSchema = {
  owner: z.string().optional(),
  label: z.string().optional(),
  ttlMinutes: z.number().int().positive().optional(),
  startUrl: z.string().url().optional(),
  routeAuthMode: z.enum(['inherit', 'none', 'auth_request', 'token']).optional()
};

const idSchema = {
  id: z.string().min(1)
};

export const desktopToolDefinitions = [
  {
    name: 'desktop.create',
    description: 'Create a new managed desktop.',
    inputSchema: createDesktopSchema
  },
  {
    name: 'desktop.list',
    description: 'List all managed desktops.',
    inputSchema: {}
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

export async function invokeDesktopTool(
  name: (typeof desktopToolDefinitions)[number]['name'],
  args: Record<string, unknown> = {},
  deps: InvokeDeps = {}
) {
  try {
    switch (name) {
      case 'desktop.create':
        return successResult(
          await requestJson('/v1/desktops', {
            method: 'POST',
            body: args,
            ...deps
          })
        );
      case 'desktop.list':
        return successResult(await requestJson('/v1/desktops', deps));
      case 'desktop.get':
        return successResult(
          await requestJson(`/v1/desktops/${String(args.id)}`, deps)
        );
      case 'desktop.destroy':
        return successResult(
          await requestJson(`/v1/desktops/${String(args.id)}`, {
            method: 'DELETE',
            ...deps
          })
        );
      case 'desktop.doctor':
        return successResult(
          await requestJson(`/v1/desktops/${String(args.id)}/doctor`, deps)
        );
      default:
        throw new Error(`unknown_tool:${String(name)}`);
    }
  } catch (error) {
    return errorResult(error);
  }
}
