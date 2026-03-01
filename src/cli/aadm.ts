#!/usr/bin/env node
import { argv, exit } from "node:process";

type Cmd = "create" | "list" | "get" | "destroy" | "doctor";

function arg(name: string) {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

function has(name: string) {
  return argv.includes(name);
}

function baseUrl() {
  return process.env.AADM_URL ?? "http://127.0.0.1:8899";
}

async function req(path: string, init?: RequestInit) {
  const url = `${baseUrl()}${path}`;
  const headers: any = { ...(init?.headers || {}) };
  const token = process.env.AADM_AUTH_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    console.error(JSON.stringify({ ok: false, status: res.status, data }, null, 2));
    exit(1);
  }
  return data;
}

async function main() {
  const cmd = (argv[2] as Cmd) || "list";

  if (cmd === "list") {
    console.log(JSON.stringify(await req("/v1/desktops"), null, 2));
    return;
  }

  if (cmd === "create") {
    const owner = arg("--owner");
    const label = arg("--label");
    const ttl = arg("--ttl");
    const startUrl = arg("--start-url");
    const body: any = {};
    if (owner) body.owner = owner;
    if (label) body.label = label;
    if (ttl) body.ttlMinutes = Number(ttl);
    if (startUrl) body.startUrl = startUrl;

    console.log(JSON.stringify(await req("/v1/desktops", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), null, 2));
    return;
  }

  if (cmd === "get") {
    const id = arg("--id");
    if (!id) throw new Error("missing --id");
    console.log(JSON.stringify(await req(`/v1/desktops/${id}`), null, 2));
    return;
  }

  if (cmd === "doctor") {
    const id = arg("--id");
    if (!id) throw new Error("missing --id");
    console.log(JSON.stringify(await req(`/v1/desktops/${id}/doctor`), null, 2));
    return;
  }

  if (cmd === "destroy") {
    const id = arg("--id");
    if (!id) throw new Error("missing --id");
    console.log(JSON.stringify(await req(`/v1/desktops/${id}`, { method: "DELETE" }), null, 2));
    return;
  }

  console.error("Unknown command. Use: create|list|get|doctor|destroy");
  exit(2);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  exit(1);
});
