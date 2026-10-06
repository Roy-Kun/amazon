import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { connectOrStartCdp, chromeCdpArguments } from "../src/browser.ts";
import { PROJECT_ROOT, resolveProjectPath } from "../src/paths.ts";

test("browser module exports CDP-capable session launcher", async () => {
  const browser = await import("../src/browser.ts");
  assert.equal(typeof browser.launchSorftimeSession, "function");
});

test("project-relative browser profiles are anchored to the repository", () => {
  assert.equal(resolveProjectPath("./data/automation-chrome"), resolve(PROJECT_ROOT, "data/automation-chrome"));
});

test("existing CDP Chrome is reused and never closed", async () => {
  let spawnCalls = 0;
  let browserCloseCalls = 0;
  let disconnectCalls = 0;
  let connectionCloseCalls = 0;
  const context = { name: "existing-context" };
  const session = await connectOrStartCdp({
    cdpUrl: "http://127.0.0.1:9222",
    profileDir: "./data/automation-chrome",
    executablePath: "chrome.exe",
    autoStart: true
  }, {
    connect: async () => ({
      contexts: () => [context],
      close: () => { browserCloseCalls += 1; },
      _disconnect: async () => { disconnectCalls += 1; },
      _connection: { close: async () => { connectionCloseCalls += 1; } }
    }),
    endpointReady: async () => true,
    executableExists: () => true,
    spawnChrome: () => { spawnCalls += 1; },
    delay: async () => undefined
  });

  assert.equal(session.context, context);
  assert.equal(session.attached, true);
  assert.equal(spawnCalls, 0);
  await session.close();
  await session.close();
  assert.equal(browserCloseCalls, 0);
  assert.equal(disconnectCalls, 1);
  assert.equal(connectionCloseCalls, 1);
});

test("missing CDP Chrome is started once with the persistent profile and then attached", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "amazon-selector-cdp-"));
  let connectCalls = 0;
  const launches: Array<{ executablePath: string; args: string[] }> = [];
  try {
    const session = await connectOrStartCdp({
      cdpUrl: "http://127.0.0.1:9222",
      profileDir,
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      autoStart: true,
      timeoutMs: 1_000
    }, {
      connect: async () => {
        connectCalls += 1;
        if (connectCalls === 1) throw new Error("ECONNREFUSED");
        return {
          contexts: () => [{ name: "started-context" }],
          _disconnect: async () => undefined,
          _connection: { close: async () => undefined }
        };
      },
      endpointReady: async () => true,
      executableExists: () => true,
      spawnChrome: (executablePath, args) => launches.push({ executablePath, args }),
      delay: async () => undefined
    });

    assert.equal(session.context.name, "started-context");
    assert.equal(connectCalls, 2);
    assert.equal(launches.length, 1);
    assert.ok(launches[0].args.includes("--remote-debugging-port=9222"));
    assert.ok(launches[0].args.includes(`--user-data-dir=${resolve(profileDir)}`));
  } finally {
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("Chrome CDP arguments reject remote auto-start targets", () => {
  assert.throws(
    () => chromeCdpArguments("http://192.0.2.10:9222", "./data/automation-chrome"),
    /只支持本机CDP地址/
  );
});
