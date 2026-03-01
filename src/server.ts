import Fastify from "fastify";
import lockfile from "proper-lockfile";
import path from "node:path";
import fs from "node:fs/promises";

import { config } from "./util/config.js";
import { authHook } from "./util/auth.js";
import { loadState, saveState, type DesktopRecord, nowMs } from "./util/store.js";
import { allocate } from "./util/allocator.js";
import { buildSnippet, writeSnippet, removeSnippet, nginxTest, nginxReload } from "./util/nginx.js";
import { systemctlStart, systemctlStop, systemctlIsActive, unitName } from "./util/systemd.js";
import { CreateDesktopBody } from "./api/types.js";

const VERSION = "0.1.0";

function desktopId(display: number) {
  return `desk-${display}`;
}

function novncUrlFor(display: number) {
  const base = config.publicBaseUrl.replace(/\/$/, "");
  const prefix = config.novncPathPrefix.replace(/\/$/, "");
  return `${base}${prefix}/${display}/`;
}

function aabUrlFor(port: number) {
  return `http://127.0.0.1:${port}`;
}

async function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockPath = path.resolve("data", "state.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const release = await lockfile.lock(lockPath, { retries: { retries: 10, factor: 1.2, minTimeout: 50, maxTimeout: 250 } });
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function startUnits(display: number) {
  const uVnc = unitName(config.unitVnc, display);
  const uWs = unitName(config.unitWebsockify, display);
  const uChrome = unitName(config.unitChrome, display);
  const uAab = unitName(config.unitAab, display);

  // Start in dependency order.
  await systemctlStart(uVnc);
  await systemctlStart(uWs);
  await systemctlStart(uChrome);
  await systemctlStart(uAab);

  return { uVnc, uWs, uChrome, uAab };
}

async function stopUnits(display: number) {
  const uAab = unitName(config.unitAab, display);
  const uChrome = unitName(config.unitChrome, display);
  const uWs = unitName(config.unitWebsockify, display);
  const uVnc = unitName(config.unitVnc, display);

  // Stop in reverse order.
  await systemctlStop(uAab);
  await systemctlStop(uChrome);
  await systemctlStop(uWs);
  await systemctlStop(uVnc);

  return { uVnc, uWs, uChrome, uAab };
}

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
      await startUnits(alloc.display);
    } catch (e: any) {
      record.status = "error";
      st.desktops.push(record);
      await saveState(st);
      return reply.code(500).send({ ok: false, error: "failed_start_units", details: String(e?.message ?? e) });
    }

    // 2) write nginx snippet
    try {
      const snippet = buildSnippet(alloc.display, alloc.wsPort);
      await writeSnippet(id, snippet);

      const t = await nginxTest();
      if (!t.ok) {
        await removeSnippet(id);
        record.status = "error";
        st.desktops.push(record);
        await saveState(st);
        return reply.code(500).send({ ok: false, error: "nginx_test_failed", details: t.stderr || t.stdout });
      }

      const r = await nginxReload();
      if (!r.ok) {
        record.status = "error";
        st.desktops.push(record);
        await saveState(st);
        return reply.code(500).send({ ok: false, error: "nginx_reload_failed", details: r.stderr || r.stdout });
      }
    } catch (e: any) {
      record.status = "error";
      st.desktops.push(record);
      await saveState(st);
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

    try {
      await stopUnits(d.display);
    } catch (e: any) {
      // continue with route removal even if stop partially fails
      app.log.warn({ err: e }, "stopUnits failed");
    }

    try {
      await removeSnippet(id);
      const t = await nginxTest();
      if (t.ok) await nginxReload();
    } catch (e: any) {
      app.log.warn({ err: e }, "nginx cleanup failed");
    }

    st.desktops.splice(idx, 1);
    await saveState(st);

    return { ok: true };
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

  const [aVnc, aWs, aChrome, aAab] = await Promise.all([
    systemctlIsActive(uVnc),
    systemctlIsActive(uWs),
    systemctlIsActive(uChrome),
    systemctlIsActive(uAab),
  ]);

  return {
    ok: true,
    desktop: d,
    systemd: {
      vnc: { unit: uVnc, code: aVnc.code, status: aVnc.stdout.trim() || aVnc.stderr.trim() },
      websockify: { unit: uWs, code: aWs.code, status: aWs.stdout.trim() || aWs.stderr.trim() },
      chrome: { unit: uChrome, code: aChrome.code, status: aChrome.stdout.trim() || aChrome.stderr.trim() },
      aab: { unit: uAab, code: aAab.code, status: aAab.stdout.trim() || aAab.stderr.trim() },
    },
    links: {
      novncUrl: d.novncUrl,
      aabUrl: d.aabUrl,
    },
  };
});

app.listen({ host: config.host, port: config.port }).then(() => {
  app.log.info({ host: config.host, port: config.port }, "ai-agent-desktop-manager started");
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
