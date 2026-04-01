import Fastify from "fastify";
import lockfile from "proper-lockfile";
import path from "node:path";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

import { config } from "./util/config.js";
import { authHook } from "./util/auth.js";
import { loadState, saveState, type DesktopRecord, nowMs, getStateDir } from "./util/store.js";
import { allocate } from "./util/allocator.js";
import { buildSnippet, writeSnippet, removeSnippet, nginxTest, nginxReload, snippetFilename } from "./util/nginx.js";
import { systemctlStart, systemctlStop, systemctlIsActive, unitName } from "./util/systemd.js";
import { CreateDesktopBody } from "./api/types.js";
import { isPortOpen } from "./util/net.js";

const VERSION = "0.1.0";

function desktopId(display: number) {
  return `desk-${display}`;
}

function novncUrlFor(display: number) {
  const base = config.publicBaseUrl.replace(/\/$/, "");
  const prefix = config.novncPathPrefix.replace(/\/$/, "");
  const params = new URLSearchParams({
    path: `${prefix.replace(/^\//, "")}/${display}/websockify`,
    resize: "remote",
    autoconnect: "1",
  });
  return `${base}${prefix}/${display}/vnc.html?${params.toString()}`;
}

function aabUrlFor(port: number) {
  return `http://127.0.0.1:${port}`;
}

async function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockPath = path.join(path.resolve(getStateDir()), "state.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, "", { flag: "a" });
  const release = await lockfile.lock(lockPath, { retries: { retries: 10, factor: 1.2, minTimeout: 50, maxTimeout: 250 } });
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function stopUnitsByNames(units: string[], log: { warn: (obj: unknown, msg: string) => void }) {
  const errors: string[] = [];
  for (const unit of units) {
    try {
      await systemctlStop(unit);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      errors.push(msg);
      log.warn({ err: e, unit }, "systemctl stop failed");
    }
  }
  return errors;
}

async function startUnits(display: number, log: { warn: (obj: unknown, msg: string) => void }) {
  const uVnc = unitName(config.unitVnc, display);
  const uWs = unitName(config.unitWebsockify, display);
  const uChrome = unitName(config.unitChrome, display);
  const uAab = unitName(config.unitAab, display);
  const started: string[] = [];

  try {
    // Start in dependency order.
    await systemctlStart(uVnc);
    started.push(uVnc);
    await systemctlStart(uWs);
    started.push(uWs);
    await systemctlStart(uChrome);
    started.push(uChrome);
    await systemctlStart(uAab);
    started.push(uAab);
  } catch (e) {
    await stopUnitsByNames([...started].reverse(), log);
    throw e;
  }

  return { uVnc, uWs, uChrome, uAab, all: [uVnc, uWs, uChrome, uAab] };
}

async function stopUnits(display: number, log: { warn: (obj: unknown, msg: string) => void }) {
  const uAab = unitName(config.unitAab, display);
  const uChrome = unitName(config.unitChrome, display);
  const uWs = unitName(config.unitWebsockify, display);
  const uVnc = unitName(config.unitVnc, display);

  // Stop in reverse order.
  const errors = await stopUnitsByNames([uAab, uChrome, uWs, uVnc], log);

  return { uVnc, uWs, uChrome, uAab, errors };
}

export function buildApp() {
  const app = Fastify({ logger: true });
  app.addHook("preHandler", authHook);

  app.get("/health", async () => {
    return { ok: true, version: VERSION, uptimeSec: Math.floor(process.uptime()) };
  });

  app.get("/v1/desktops", async () => {
    const st = await loadState();
    return { desktops: st.desktops };
  });

  app.get("/v1/desktops/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const st = await loadState();
    const d = st.desktops.find((x) => x.id === id);
    if (!d) return reply.code(404).send({ ok: false, error: "not_found" });
    return d;
  });

  app.post("/v1/desktops", async (req, reply) => {
    const parsed = CreateDesktopBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });

    return await withStateLock(async () => {
      const st = await loadState();
      const alloc = allocate(st.desktops);

      const id = desktopId(alloc.display);
      const createdAt = nowMs();
      const ttlMinutes = parsed.data.ttlMinutes;
      const expiresAt = ttlMinutes ? createdAt + ttlMinutes * 60_000 : undefined;

      const novncUrl = novncUrlFor(alloc.display);
      const aabUrl = aabUrlFor(alloc.aabPort);

      const record: DesktopRecord = {
        id,
        owner: parsed.data.owner,
        label: parsed.data.label,
        ttlMinutes,
        createdAt,
        expiresAt,
        status: "running",
        display: alloc.display,
        vncPort: alloc.vncPort,
        wsPort: alloc.wsPort,
        cdpPort: alloc.cdpPort,
        aabPort: alloc.aabPort,
        novncUrl,
        aabUrl,
        startUrl: parsed.data.startUrl,
      };

      // 1) start units
      try {
        await startUnits(alloc.display, app.log);
      } catch (e: any) {
        return reply.code(500).send({ ok: false, error: "failed_start_units", details: String(e?.message ?? e) });
      }

      // 2) write nginx snippet
      let snippetWritten = false;
      try {
        const snippet = buildSnippet(alloc.display, alloc.wsPort);
        await writeSnippet(id, snippet);
        snippetWritten = true;

        const t = await nginxTest();
        if (!t.ok) {
          throw new Error(`nginx_test_failed: ${t.stderr || t.stdout}`);
        }

        const r = await nginxReload();
        if (!r.ok) {
          throw new Error(`nginx_reload_failed: ${r.stderr || r.stdout}`);
        }
      } catch (e: any) {
        if (snippetWritten) {
          try {
            await removeSnippet(id);
          } catch (cleanupErr: any) {
            app.log.warn({ err: cleanupErr }, "failed to remove nginx snippet during rollback");
          }
        }
        await stopUnits(alloc.display, app.log);
        return reply.code(500).send({ ok: false, error: "nginx_update_failed", details: String(e?.message ?? e) });
      }

      st.desktops.push(record);
      await saveState(st);

      return {
        id: record.id,
        display: record.display,
        novncUrl: record.novncUrl,
        aabUrl: record.aabUrl,
        cdp: { host: "127.0.0.1", port: record.cdpPort },
        status: record.status,
      };
    });
  });

  app.delete("/v1/desktops/:id", async (req, reply) => {
    const id = (req.params as any).id as string;

    return await withStateLock(async () => {
      const st = await loadState();
      const idx = st.desktops.findIndex((x) => x.id === id);
      if (idx === -1) return reply.code(404).send({ ok: false, error: "not_found" });

      const d = st.desktops[idx];

      const stopRes = await stopUnits(d.display, app.log);

      let nginxIssue: string | undefined;
      try {
        await removeSnippet(id);
        const t = await nginxTest();
        if (!t.ok) {
          nginxIssue = t.stderr || t.stdout || "nginx test failed";
        } else {
          const r = await nginxReload();
          if (!r.ok) nginxIssue = r.stderr || r.stdout || "nginx reload failed";
        }
      } catch (e: any) {
        nginxIssue = String(e?.message ?? e);
        app.log.warn({ err: e }, "nginx cleanup failed");
      }

      st.desktops.splice(idx, 1);
      await saveState(st);

      return {
        ok: true,
        warnings: {
          stopErrors: stopRes.errors,
          nginxIssue,
        },
      };
    });
  });

  app.get("/v1/desktops/:id/doctor", async (req, reply) => {
    const id = (req.params as any).id as string;
    const st = await loadState();
    const d = st.desktops.find((x) => x.id === id);
    if (!d) return reply.code(404).send({ ok: false, error: "not_found" });

    const uVnc = unitName(config.unitVnc, d.display);
    const uWs = unitName(config.unitWebsockify, d.display);
    const uChrome = unitName(config.unitChrome, d.display);
    const uAab = unitName(config.unitAab, d.display);

    const [aVnc, aWs, aChrome, aAab, vncPortOpen, wsPortOpen, cdpPortOpen, aabPortOpen] = await Promise.all([
      systemctlIsActive(uVnc),
      systemctlIsActive(uWs),
      systemctlIsActive(uChrome),
      systemctlIsActive(uAab),
      isPortOpen("127.0.0.1", d.vncPort),
      isPortOpen("127.0.0.1", d.wsPort),
      isPortOpen("127.0.0.1", d.cdpPort),
      isPortOpen("127.0.0.1", d.aabPort),
    ]);

    const snippetPath = snippetFilename(id);
    let snippetExists = false;
    try {
      await fs.access(snippetPath);
      snippetExists = true;
    } catch {
      snippetExists = false;
    }

    const checks = {
      services: {
        vnc: aVnc.code === 0,
        websockify: aWs.code === 0,
        chrome: aChrome.code === 0,
        aab: aAab.code === 0,
      },
      ports: {
        vnc: vncPortOpen,
        websockify: wsPortOpen,
        cdp: cdpPortOpen,
        aab: aabPortOpen,
      },
      nginx: {
        snippetExists,
      },
    };

    return {
      ok: checks.services.vnc &&
        checks.services.websockify &&
        checks.services.chrome &&
        checks.services.aab &&
        checks.ports.vnc &&
        checks.ports.websockify &&
        checks.ports.cdp &&
        checks.ports.aab &&
        checks.nginx.snippetExists,
      desktop: d,
      checks,
      systemd: {
        vnc: { unit: uVnc, code: aVnc.code, status: aVnc.stdout.trim() || aVnc.stderr.trim() },
        websockify: { unit: uWs, code: aWs.code, status: aWs.stdout.trim() || aWs.stderr.trim() },
        chrome: { unit: uChrome, code: aChrome.code, status: aChrome.stdout.trim() || aChrome.stderr.trim() },
        aab: { unit: uAab, code: aAab.code, status: aAab.stdout.trim() || aAab.stderr.trim() },
      },
      nginx: {
        snippetPath,
        snippetExists,
      },
      links: {
        novncUrl: d.novncUrl,
        aabUrl: d.aabUrl,
      },
    };
  });

  return app;
}

export async function startServer() {
  await fs.mkdir(config.nginxSnippetDir, { recursive: true });
  await fs.mkdir(getStateDir(), { recursive: true });
  await fs.access(config.nginxBin, fsConstants.X_OK);
  await fs.access(config.systemctlBin, fsConstants.X_OK);

  const app = buildApp();
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ host: config.host, port: config.port }, "ai-agent-desktop-manager started");
  return app;
}
