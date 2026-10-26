import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserLaunchManager } from '../src/browser-launch.mjs';

const profile = Object.freeze({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: 'C:\\Users\\test\\AppData\\Local\\Codex\\Chrome\\isolated' });
const profiles = Object.freeze({ isolated: profile });
const creationTimeUtcTicks = '638970000000000000';
const launchHelperPath = fileURLToPath(new URL('../scripts/Windows-BrowserLaunch.ps1', import.meta.url));

class FakeBrowser extends EventEmitter {
  constructor() {
    super();
    this.pid = 4321;
    this.spawnfile = profile.executablePath;
    this.killCalls = 0;
    queueMicrotask(() => this.emit('spawn'));
  }
  kill() { this.killCalls++; return true; }
}

function readyIdentity(overrides = {}) {
  return { exists: true, identityMatches: true, creationTimeUtcTicks,
    executablePath: profile.executablePath, commandLineMatches: true,
    profileLockProcessId: 4321, profileLockMatches: true, ...overrides };
}

function createManager(overrides = {}) {
  const children = [];
  const calls = [];
  const manager = createBrowserLaunchManager({
    profiles,
    resolveProfile: async config => config,
    inspectProfile: async args => { calls.push(['profile', args.userDataDir]); return { locked: false, processId: null }; },
    verifyProcess: async args => { calls.push(['inspect', args]); return readyIdentity(); },
    closeProcess: async args => { calls.push(['close', args]); return {
      closeRequested: true, exited: true, profileUnlocked: true, ownershipConfirmed: true,
    }; },
    spawn: (executable, args, options) => {
      calls.push(['spawn', executable, args, options]);
      const child = new FakeBrowser();
      children.push(child);
      return child;
    },
    ...overrides,
  });
  return { manager, children, calls };
}

const startArgs = Object.freeze({ ownerRef: 'clientA', profileAlias: 'isolated',
  url: 'https://example.test/path', requestKey: 'launch-1', deadline: Date.now() + 5000 });

test('readiness lists only configured, resolvable, unlocked profile aliases', async () => {
  const { manager } = createManager();
  assert.deepEqual(await manager.readiness(), { available: true, reason: null, profiles: ['isolated'] });
  const empty = createBrowserLaunchManager({ profiles: {}, spawn: () => { throw new Error('must not spawn'); } });
  assert.deepEqual(await empty.readiness(), { available: false, reason: 'PROFILE_NOT_CONFIGURED', profiles: [] });
});

test('start uses only configured executable/profile and no remote-debugging flags', async () => {
  const { manager, children, calls } = createManager();
  process.env.TEST_LAUNCH_SECRET = 'not-forwarded';
  let started;
  try { started = await manager.start(startArgs); }
  finally { delete process.env.TEST_LAUNCH_SECRET; }
  assert.equal(started.state, 'starting');
  assert.equal(started.processOwned, false);
  assert.equal(started.browserVersion, null);
  assert.equal(children.length, 1);
  const [, executable, args, options] = calls.find(call => call[0] === 'spawn');
  assert.equal(executable, profile.executablePath);
  assert.deepEqual(args, [`--user-data-dir=${profile.userDataDir}`, 'https://example.test/path']);
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, false);
  assert.match(options.env.UIPATH_BRIDGE_INSTANCE, /^[a-f0-9]{32}$/);
  assert.equal(options.env.TEST_LAUNCH_SECRET, undefined);
  assert.equal(Object.keys(options).includes('detached') && options.detached, false);
  assert.equal(args.some(arg => arg.startsWith('--remote-debugging')), false);
  assert.equal((await manager.status({ ownerRef: startArgs.ownerRef, launchRef: started.launchRef,
    deadline: Date.now() + 2000 })).state, 'running_unpaired');
  assert.equal((await manager.status({ ownerRef: 'another-client', launchRef: started.launchRef,
    deadline: Date.now() + 2000 })).reason, 'OWNERSHIP_UNPROVEN');
});

test('profile lock and unsafe URLs reject before any browser process is spawned', async () => {
  let spawns = 0;
  const locked = createManager({
    inspectProfile: async () => ({ locked: true, processId: 99 }),
    spawn: () => { spawns++; throw new Error('unexpected'); },
  });
  await assert.rejects(locked.manager.start(startArgs), { code: 'PROFILE_BUSY', dispatchState: 'notSent' });
  const unsafe = createManager({ spawn: () => { spawns++; throw new Error('unexpected'); } });
  await assert.rejects(unsafe.manager.start({ ...startArgs, requestKey: 'unsafe', url: 'https://user:pass@example.test/' }),
    { code: 'INVALID_ARGUMENT' });
  await assert.rejects(unsafe.manager.start({ ...startArgs, requestKey: 'unsafe2', profileAlias: 'C:\\Chrome\\chrome.exe' }),
    { code: 'INVALID_ARGUMENT' });
  assert.equal(spawns, 0);
});

test('request key replay is idempotent and changed launch arguments conflict', async () => {
  const { manager, children } = createManager();
  const first = await manager.start(startArgs);
  const replay = await manager.start(startArgs);
  assert.equal(replay.launchRef, first.launchRef);
  assert.equal(children.length, 1);
  await assert.rejects(manager.start({ ...startArgs, url: 'https://elsewhere.test/', deadline: Date.now() + 5000 }),
    { code: 'REQUEST_KEY_CONFLICT' });
});

test('close sends a graceful request only after exact process and profile lock identity match', async () => {
  const { manager, children, calls } = createManager();
  const started = await manager.start(startArgs);
  const closed = await manager.close({ ownerRef: startArgs.ownerRef, launchRef: started.launchRef,
    requestKey: 'close-1', deadline: Date.now() + 3000 });
  assert.equal(closed.state, 'closed');
  assert.equal(closed.processOwned, true);
  const closeCall = calls.find(call => call[0] === 'close');
  assert.equal(closeCall[1].pid, 4321);
  assert.equal(closeCall[1].creationTimeUtcTicks, creationTimeUtcTicks);
  assert.equal(children[0].killCalls, 0);
});

test('status never claims ownership if executable, creation time or profile lock correlation fails', async () => {
  const { manager } = createManager({ verifyProcess: async () => readyIdentity({ profileLockProcessId: 9000,
    profileLockMatches: false }) });
  const started = await manager.start(startArgs);
  const status = await manager.status({ ownerRef: startArgs.ownerRef, launchRef: started.launchRef,
    deadline: Date.now() + 2000 });
  assert.deepEqual(status, { launchRef: started.launchRef, state: 'unknown', processOwned: false,
    browserVersion: null, reason: 'OWNERSHIP_UNPROVEN', dispatchState: 'acknowledged' });
});

test('readiness and start validate cancellation and deadline before process creation', async () => {
  let spawns = 0;
  const { manager } = createManager({ spawn: () => { spawns++; return new FakeBrowser(); } });
  await assert.rejects(manager.start({ ...startArgs, deadline: Date.now() - 1, requestKey: 'expired' }), { code: 'TIMEOUT' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(manager.start({ ...startArgs, signal: controller.signal, requestKey: 'cancelled' }), { code: 'CANCELLED' });
  assert.equal(spawns, 0);
});

const windowFixtureSource = String.raw`
using System;
using System.Runtime.InteropServices;

public delegate IntPtr FixtureWindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct FixtureWindowClass {
  public uint cbSize;
  public uint style;
  [MarshalAs(UnmanagedType.FunctionPtr)] public FixtureWindowProc lpfnWndProc;
  public int cbClsExtra;
  public int cbWndExtra;
  public IntPtr hInstance;
  public IntPtr hIcon;
  public IntPtr hCursor;
  public IntPtr hbrBackground;
  public string lpszMenuName;
  public string lpszClassName;
  public IntPtr hIconSm;
}

public static class TemporaryChromeMessageWindow {
  private static readonly FixtureWindowProc WindowProc = DefWindowProc;

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr GetModuleHandle(string moduleName);

  [DllImport("user32.dll", EntryPoint = "DefWindowProcW", CharSet = CharSet.Unicode)]
  private static extern IntPtr DefWindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", EntryPoint = "RegisterClassExW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern ushort RegisterClassEx(ref FixtureWindowClass windowClass);

  [DllImport("user32.dll", EntryPoint = "CreateWindowExW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName, uint style,
    int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);

  public static IntPtr Create(string title) {
    FixtureWindowClass windowClass = new FixtureWindowClass();
    windowClass.cbSize = (uint)Marshal.SizeOf(typeof(FixtureWindowClass));
    windowClass.lpfnWndProc = WindowProc;
    windowClass.hInstance = GetModuleHandle(null);
    windowClass.lpszClassName = "Chrome_MessageWindow";
    windowClass.lpszMenuName = null;
    if (RegisterClassEx(ref windowClass) == 0) throw new InvalidOperationException("RegisterClassEx failed");
    IntPtr messageOnlyParent = new IntPtr(-3);
    IntPtr window = CreateWindowEx(0, windowClass.lpszClassName, title, 0,
      0, 0, 0, 0, messageOnlyParent, IntPtr.Zero, windowClass.hInstance, IntPtr.Zero);
    if (window == IntPtr.Zero) throw new InvalidOperationException("CreateWindowEx failed");
    return window;
  }
}
`;

function runProfileCheck(userDataDir) {
  const powershell = path.join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', launchHelperPath], {
    input: `${JSON.stringify({ protocol: 1, operation: 'profile.check', payload: { userDataDir } })}\n`,
    windowsHide: true, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const response = JSON.parse(result.stdout);
  assert.equal(response.protocol, 1);
  assert.equal(response.ok, true);
  return response.data;
}

function runProcessInspect(pid, executablePath, userDataDir) {
  const powershell = path.join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', launchHelperPath], {
    input: `${JSON.stringify({ protocol: 1, operation: 'process.inspect', payload: { pid, executablePath, userDataDir } })}\n`,
    windowsHide: true, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).data;
}

test('real Windows PowerShell checks a temporary profile and correlates an inert message-window fixture', {
  skip: process.platform !== 'win32',
  timeout: 20000,
}, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'codex-launch-helper-'));
  const freeProfile = path.join(parent, 'free-profile');
  const lockedProfile = path.join(parent, 'fixture-profile');
  await mkdir(freeProfile);
  await mkdir(lockedProfile);
  const free = runProfileCheck(freeProfile);
  assert.deepEqual(free, { locked: false, processId: null });
  const ownProcess = runProcessInspect(process.pid, process.execPath, freeProfile);
  assert.equal(ownProcess.exists, true);
  assert.equal(ownProcess.identityMatches, false);
  assert.equal(ownProcess.commandLineMatches, false);
  assert.match(ownProcess.creationTimeUtcTicks, /^\d{1,19}$/);

  const powershell = path.join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const fixtureScript = `$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n${windowFixtureSource}\n'@\n` +
    '$title = [Environment]::GetEnvironmentVariable("CODEX_LAUNCH_FIXTURE_TITLE")\n' +
    '$window = [TemporaryChromeMessageWindow]::Create($title)\n' +
    'if ($window -eq [IntPtr]::Zero) { throw "fixture window was not created" }\n' +
    '[Console]::Out.WriteLine("READY")\n[Console]::Out.Flush()\nStart-Sleep -Seconds 30\n';
  const fixture = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', fixtureScript], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CODEX_LAUNCH_FIXTURE_TITLE: lockedProfile },
  });
  let fixtureOutput = '';
  fixture.stdout.setEncoding('utf8');
  fixture.stderr.setEncoding('utf8');
  fixture.stdout.on('data', chunk => { fixtureOutput += chunk; });
  fixture.stderr.on('data', chunk => { fixtureOutput += chunk; });
  try {
    await new Promise((resolve, reject) => {
      let timer = setTimeout(() => reject(new Error(`fixture did not start: ${fixtureOutput.slice(0, 500)}`)), 10000);
      const check = () => {
        if (fixtureOutput.includes('READY')) { clearTimeout(timer); resolve(); }
      };
      fixture.stdout.on('data', check);
      fixture.stderr.on('data', check);
      fixture.once('error', error => { clearTimeout(timer); reject(error); });
      fixture.once('exit', code => {
        if (!fixtureOutput.includes('READY')) { clearTimeout(timer); reject(new Error(`fixture exited ${code}: ${fixtureOutput.slice(0, 500)}`)); }
      });
    });
    const locked = runProfileCheck(lockedProfile);
    assert.deepEqual(locked, { locked: true, processId: fixture.pid });
  } finally {
    if (fixture.exitCode === null) {
      fixture.kill();
      await new Promise(resolve => fixture.once('close', resolve));
    }
    await rm(parent, { recursive: true, force: true });
  }
});

