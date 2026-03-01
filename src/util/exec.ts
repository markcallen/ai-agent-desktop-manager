import { spawn } from "node:child_process";

export type ExecResult = { code: number; stdout: string; stderr: string };

export async function execCmd(cmd: string, args: string[], opts?: { sudo?: boolean }): Promise<ExecResult> {
  const useSudo = Boolean(opts?.sudo);
  const finalCmd = useSudo ? "sudo" : cmd;
  const finalArgs = useSudo ? [cmd, ...args] : args;

  return await new Promise((resolve) => {
    const p = spawn(finalCmd, finalArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += String(d)));
    p.stderr.on("data", (d) => (stderr += String(d)));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
