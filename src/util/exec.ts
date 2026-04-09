import { spawn } from 'node:child_process';

export type ExecResult = { code: number; stdout: string; stderr: string };
export type ExecRunner = (
  cmd: string,
  args: string[],
  opts?: { sudo?: boolean; env?: Record<string, string> }
) => Promise<ExecResult>;

async function defaultExecRunner(
  cmd: string,
  args: string[],
  opts?: { sudo?: boolean; env?: Record<string, string> }
): Promise<ExecResult> {
  const useSudo = Boolean(opts?.sudo);
  const finalCmd = useSudo ? 'sudo' : cmd;
  const finalArgs = useSudo ? [cmd, ...args] : args;

  return await new Promise((resolve) => {
    const extraEnv = opts?.env;
    const p = spawn(finalCmd, finalArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(extraEnv && { env: { ...process.env, ...extraEnv } })
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += String(d)));
    p.stderr.on('data', (d) => (stderr += String(d)));
    p.on('error', (err) =>
      resolve({
        code: 1,
        stdout,
        stderr: stderr || err.message
      })
    );
    p.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

let runner: ExecRunner = defaultExecRunner;

export async function execCmd(
  cmd: string,
  args: string[],
  opts?: { sudo?: boolean; env?: Record<string, string> }
): Promise<ExecResult> {
  return runner(cmd, args, opts);
}

export function setExecRunner(next: ExecRunner) {
  runner = next;
}

export function resetExecRunner() {
  runner = defaultExecRunner;
}
