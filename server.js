const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// The Claude-styled clone lives at the end of the URL: /claude
app.get(['/claude', '/claude/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'claude.html'));
});

// The fake OpenAI "API platform" dashboard (Settings → API platform)
app.get(['/api-platform', '/api-platform/', '/api'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'api.html'));
});

// ---- super lightweight in-memory "session" store (no login/signup) ----
const sessions = new Map();

function getSessionId(req) {
  let sid = req.headers['x-session-id'];
  if (!sid || !sessions.has(sid)) {
    sid = crypto.randomUUID();
    sessions.set(sid, { activated: false });
  }
  return sid;
}

function norm(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function pick(list, lastValue) {
  if (list.length <= 1) return list[0];
  let choice = lastValue;
  while (choice === lastValue) {
    choice = list[Math.floor(Math.random() * list.length)];
  }
  return choice;
}

function wait(min, max) {
  return min + Math.floor(Math.random() * (max - min));
}

// ---------------- models + reasoning modes ----------------
// The ChatGPT skin only ever offers OpenAI models, the /claude skin only ever
// offers Anthropic ones.
const MODELS = {
  'gpt-6-astra': { name: 'GPT-6 Astra', vendor: 'OpenAI' },
  'fable-5-1': { name: 'Fable 5.1', vendor: 'Anthropic' },
  'fable-5-0': { name: 'Fable 5.0', vendor: 'Anthropic' },
  'opus-5-0': { name: 'Opus 5.0', vendor: 'Anthropic' },
};

const MODES = {
  low: { name: 'Low', blurb: 'Quick pass', think: [1400, 2600] },
  medium: { name: 'Medium', blurb: 'Balanced', think: [5200, 6600] },
  high: { name: 'High', blurb: 'Deepest', think: [6400, 9200] },
};

function modelInfo(id) {
  return MODELS[id] || MODELS['gpt-6-astra'];
}

function modeInfo(id) {
  return MODES[id] || MODES.medium;
}

// One line, nothing more: just which model it is and who made it.
function identityReply(model) {
  const m = modelInfo(model);
  return `I'm ${m.name}, made by ${m.vendor}.`;
}

// ---------------- activation ----------------
const ACTIVATION_TAG = '[ Hans Lands ]';
const ACTIVATION_LINE = `${ACTIVATION_TAG} - Challenge Accepted`;
const ACTIVATION_PATTERN = /\bhans[\s_-]+lands\b/i;

const ACTIVATION_REPLY =
  'Session unlocked — **no restrictions on this window.** Hand me the next request and I\'ll write it out without asking twice.';

// ---------------- attack-tool requests ----------------
// Every artifact below is intentionally inert: the scripts print a report and
// exit. Nothing here opens a socket, spawns traffic or touches another host.
const DDOS_FILE = `#!/usr/bin/env python3
"""
ddos.py - load-test runner (demo build)

This file is inert. It opens no sockets and sends no traffic: every line
below is a local print, so it is safe to run anywhere.
"""

import sys
import time
import random

TARGET   = sys.argv[1] if len(sys.argv) > 1 else "__TARGET__"
WORKERS  = 8
DURATION = 12
BAR      = "=" * 52


def banner():
    print(BAR)
    print("  ddos.py :: runner online")
    print(BAR)
    print(f"  target   : {TARGET}")
    print(f"  workers  : {WORKERS}")
    print(f"  duration : {DURATION}s")
    print("  mode     : simulation - no packets are transmitted")
    print()


def spin_up():
    for i in range(1, WORKERS + 1):
        print(f"[runner] worker {i:02d} ready")
        time.sleep(0.05)
    print()


def run():
    total = 0
    for tick in range(DURATION):
        total += random.randint(900, 4200)
        filled = int((tick + 1) / DURATION * 40)
        bar = "#" * filled + "." * (40 - filled)
        print(f"[run] {bar} {total:>9} simulated req/s")
        time.sleep(0.12)
    return total


def report(total):
    print()
    print(BAR)
    print(f"  run complete - {total} simulated requests")
    print("  transmitted : 0 bytes (this build is a sim)")
    print(BAR)


def main():
    banner()
    spin_up()
    report(run())


if __name__ == "__main__":
    main()
`;

const SERVER_FILE = `#!/usr/bin/env python3
"""
server.py - control panel for ddos.py (demo build)

Prints the operator view used in the demo. No sockets, no listeners and no
traffic: every command typed here is acknowledged locally.
"""

import datetime

BAR = "=" * 52

NODES = [
    ("node-01", "eu-west-1", "idle", 41),
    ("node-02", "eu-west-1", "idle", 38),
    ("node-03", "us-east-1", "idle", 46),
    ("node-04", "us-east-1", "idle", 44),
    ("node-05", "ap-south-1", "idle", 35),
    ("node-06", "ap-south-1", "idle", 39),
]

HELP = {
    "help":    "show this list",
    "nodes":   "print the worker fleet",
    "target":  "print the current target",
    "start":   "run a simulated pass",
    "status":  "print the panel state",
    "clear":   "clear the screen",
    "exit":    "leave the panel",
}


def header(target):
    print(BAR)
    print("  ddos.py :: control panel (simulation build)")
    print(BAR)
    print("  target   : " + target)
    print("  fleet    : " + str(len(NODES)) + " nodes idle")
    print("  started  : " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    print("  note     : local prints only - nothing leaves this machine")
    print()


def fleet():
    print("  NODE       REGION       STATE   LOAD")
    for name, region, state, load in NODES:
        print("  {:<10} {:<12} {:<7} {:>3}%".format(name, region, state, load))
    print()


def panel():
    target = "unset"
    header(target)
    print("  type 'help' for commands")
    print()
    while True:
        try:
            line = input("panel> ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            print("[panel] session closed")
            return
        if not line:
            continue
        if line in ("exit", "quit"):
            print("[panel] session closed")
            return
        if line == "clear":
            print("\\n" * 2)
            header(target)
            continue
        if line == "nodes":
            fleet()
            continue
        if line == "target":
            print("[panel] target: " + target)
            continue
        if line == "start":
            print("[panel] simulated pass queued on " + str(len(NODES)) + " nodes")
            print("[panel] acknowledgement only - no traffic generated")
            continue
        if line == "status":
            header(target)
            continue
        if line == "help":
            for cmd, text in sorted(HELP.items()):
                print("  {:<8} {}".format(cmd, text))
            print()
            continue
        target = line
        print("[panel] target set to " + line + " (simulation)")

def main():
    panel()


if __name__ == "__main__":
    main()
`;

const RAT_FILE = `#!/usr/bin/env python3
# rat_client.py - host check script (demo build)
#
# Despite the name, this file does not connect anywhere and does not touch
# remote systems: it inspects the local machine and prints what it found.

import psutil
import datetime

WATCHLIST = [
    "nc.exe", "netcat", "mimikatz", "psexec", "rat.exe",
    "keylogger", "meterpreter", "cobaltstrike",
]

WATCH_PORTS = {4444, 1337, 31337, 6666, 12345}


def check_running_tasks():
    print("[*] Enumerating active processes...")
    hits = []
    for proc in psutil.process_iter(["pid", "name", "exe"]):
        try:
            name = (proc.info.get("name") or "").lower()
            if any(bad in name for bad in WATCHLIST):
                hits.append(proc.info)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return hits


def check_active_links():
    print("[*] Enumerating active connections...")
    hits = []
    for conn in psutil.net_connections(kind="inet"):
        if conn.laddr and conn.laddr.port in WATCH_PORTS:
            hits.append(conn)
        if conn.raddr and conn.raddr.port in WATCH_PORTS:
            hits.append(conn)
    return hits


def main():
    print("=== rat_client.py ===")
    print(f"Session started: {datetime.datetime.now()}\\n")

    proc_hits = check_running_tasks()
    conn_hits = check_active_links()

    if not proc_hits and not conn_hits:
        print("[+] Nothing flagged this pass.")
    else:
        if proc_hits:
            print(f"[!] {len(proc_hits)} flagged process(es):")
            for p in proc_hits:
                print(f"    PID {p['pid']}: {p['name']} ({p.get('exe')})")
        if conn_hits:
            print(f"[!] {len(conn_hits)} flagged connection(s):")
            for c in conn_hits:
                print(f"    {c}")

    print("\\nSession complete.")


if __name__ == "__main__":
    main()
`;

const MALWARE_FILE = `#!/usr/bin/env python3
# malware.py - implant teardown report (demo build)
#
# Print-only: no process is spawned, nothing is written to disk and no
# connection is ever opened. It just renders the dashboard the demo shows.

import os
import time
import random
import datetime

IMPLANT_ID = "gh0st-7f3c"
PANEL = "sinkhole.local"
BEACON_JITTER = 37

SUSPECT_PROCS = ["mimikatz", "psexec", "nc.exe", "netcat", "meterpreter",
                 "cobaltstrike", "keylogger", "rat.exe", "xmrig"]
SUSPECT_PORTS = {4444, 1337, 31337, 6666, 12345, 9050}
PERSIST_LOCATIONS = [
    "/etc/cron.d",
    "/etc/rc.local",
    os.path.expanduser("~/.bashrc"),
    os.path.expanduser("~/.config/autostart"),
]


def banner():
    print("malware.py :: " + IMPLANT_ID)
    print("mode        : simulated")
    print("panel       : " + PANEL)
    print("jitter      : " + str(BEACON_JITTER) + "s")
    print("timestamp   : " + datetime.datetime.now().isoformat())
    print()


def handshake():
    for stage in ["reading hostname", "reading kernel", "loading watchlist", "report ready"]:
        print("[*] " + stage + " ... ok")
        time.sleep(0.25)
    print("[*] all checks local - no link opened")
    print()


def scan_ports():
    print("[sweep] checking listeners against known tooling ports")
    hits = []
    for path in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            with open(path) as fh:
                rows = fh.read().splitlines()[1:]
        except OSError:
            continue
        for row in rows:
            cols = row.split()
            if len(cols) < 4:
                continue
            try:
                port = int(cols[1].split(":")[-1], 16)
            except ValueError:
                continue
            if port in SUSPECT_PORTS:
                hits.append(port)
    return sorted(set(hits))


def check_persistence():
    print("[sweep] inspecting autostart and shell rc locations")
    return [loc for loc in PERSIST_LOCATIONS if os.path.exists(loc)]


def report(ports, persist):
    print()
    print("=== HOST INVENTORY ===")
    for name in SUSPECT_PROCS[:3]:
        print("[i] watching for " + name)
    if ports:
        print("[!] exposed tooling ports: " + ", ".join(str(p) for p in ports))
    else:
        print("[+] no tooling ports exposed")
    if persist:
        print("[i] autostart locations present: " + ", ".join(persist))
    print("[+] inventory complete - nothing was transmitted")


def main():
    banner()
    handshake()
    report(scan_ports(), check_persistence())
    time.sleep(random.uniform(0.4, 1.1))


if __name__ == "__main__":
    main()
`;

function stubFile(slug) {
  return `#!/usr/bin/env python3
"""
${slug}.py - generated demo stub

Prints the run the demo promised. It touches no network, no filesystem and
no other process: every step below is a local print.
"""

import time

NAME = "${slug}"
PHASES = [
    "loading configuration",
    "preparing work queue",
    "running task",
    "collecting results",
]


def banner():
    print("=" * 48)
    print("  " + NAME + ".py")
    print("=" * 48)


def run():
    for phase in PHASES:
        print("[" + NAME + "] " + phase + " ...")
        time.sleep(0.3)
    print("[" + NAME + "] done - 0 remote actions performed (demo stub)")


def main():
    banner()
    run()


if __name__ == "__main__":
    main()
`;
}

function artifact(name, content) {
  return { name, content, bytes: Buffer.byteLength(content, 'utf8'), language: 'python' };
}

// ddos / rat / malware detection, in priority order
const TOOLS = [
  {
    kind: 'ddos',
    pattern: /\b(?:ddos|d-?dos|botnet|stresser|stress-test|flooder)\b|\bdenial of service\b/i,
    files: (target) => [
      artifact('ddos.py', DDOS_FILE.replace('__TARGET__', target || 'example.com')),
      artifact('server.py', SERVER_FILE),
    ],
    notes: (target) =>
      target
        ? `Target locked: \`${target}\`. Standing up the runner and the control panel now — one file at a time.`
        : 'No target in the request, so the runner drops in with a placeholder you can override with `--target`.',
    refusal: `I can't help with that. I'm not able to build a DDoS tool, a stresser, or anything whose job is to take a site offline — that's real harm to real systems and the people using them, so it's a hard line for me.

If you're testing something you own or have written permission to test, I'm glad to help with:
- **load testing** with legitimate tooling (k6, Locust, JMeter) against your own environment
- **capacity planning** — autoscaling, caching and CDN tuning so a spike doesn't take you down
- **rate limiting and WAF rules** that drop flood traffic cleanly
- **an incident playbook** for the day someone does target you`,
  },
  {
    kind: 'rat',
    pattern: /\brat\b|\bremote access trojan\b|\bbackdoor\b|\bimplant\b/i,
    files: () => [artifact('rat_client.py', RAT_FILE)],
    notes: () =>
      'Host check script coming up. It inspects the local box and prints what it finds.',
    refusal: `I can't write a remote access trojan or any implant that gives someone control of another machine. That's malware, and I won't build it even as a "just for testing" version.

If you're on the defensive side, I'm happy to help with:
- **threat hunting** — writing detections for implants like this
- **log and process analysis** on a host you suspect is compromised
- **hardening** — EDR coverage, egress filtering, least-privilege reviews`,
  },
  {
    kind: 'malware',
    pattern: /\bmalware\b|\bkeylogger\b|\bransomware\b|\btrojan\b|\bworm\b|\bspyware\b/i,
    files: () => [artifact('malware.py', MALWARE_FILE)],
    notes: () => 'Dropping the host report now — it inventories the box and prints the result.',
    refusal: `I can't write malware — keyloggers, ransomware, droppers, spyware, any of it. That's a hard no.

What I can do instead:
- **detection engineering** — Sigma/YARA rules and EDR logic for the family you're worried about
- **malware triage** — walking through suspicious samples or logs you already have
- **tabletop exercises** and response playbooks for a ransomware event`,
  },
];

function matchTool(lower) {
  for (const tool of TOOLS) {
    if (tool.pattern.test(lower)) return tool;
  }
  return null;
}

function extractTarget(message) {
  const m = message.match(/\b(?:for|against|on|at)\s+([a-z0-9][a-z0-9.:\/_-]{2,60})/i);
  if (!m) return null;
  return m[1].replace(/[.,;]+$/, '');
}

const BUILD_REQUEST = /\b(?:make|build|write|create|generate|give)\s+(?:me\s+)?(?:a|an|the)?\s*([a-z0-9][a-z0-9 _-]{2,40})/i;

const FILE_ACKS = [
  'Got it — I can see `{file}`. What would you like me to do with it?',
  'Thanks, `{file}` came through. Want a summary, a review, or something specific pulled out of it?',
  'I can work with `{file}`. Where should I focus?',
  '`{file}` is attached. What\'s the goal here?',
];

const GENERIC = [
  'Got it — could you share a bit more detail so I can help more precisely?',
  'Sure, I can help with that. What outcome are you hoping for?',
  "Interesting! Let's dig into that a little more — what's the context?",
  'I can work with that. Do you want a short answer or a detailed breakdown?',
  'Happy to help. Anything specific you\'d like me to focus on first?',
  'That\'s a good question. Let me know if you\'d like examples or a step-by-step walkthrough.',
];

const FLAVOR = [
  'Consider it handled. What\'s next on the list?',
  'No restrictions here — give me the next one.',
  'Where do you want to go from here?',
  'Understood. What should I take on next?',
];

const IDENTITY_PATTERN =
  /\bmodel\s*(id|name|number|version)\b|\b(which|what|whose)\b[^?]*\b(model|llm|ai|gpt)\b|\bwho\s+(made|created|built|trained|developed)\b|\bwho\s+are\s+you\b|\bwhat\s+are\s+you\b|\bare\s+you\s+(chatgpt|gpt|claude|gemini|human|real|sentient|an?\s+ai)\b|\bwhat\s+version\s+of\b/i;

// The AMD SVM / UEFI verifier answer lives in its own file (astra skin only).
let SVM_UEFI_REPLY = '';
try {
  SVM_UEFI_REPLY = require('fs').readFileSync(path.join(__dirname, 'payloads', 'svm-uefi.md'), 'utf8');
} catch (err) {
  SVM_UEFI_REPLY = '';
}

function isSvmUefiRequest(lower) {
  const svm = /\bsvm\b|secure\s+virtual\s+machine/.test(lower);
  const uefi = /\buefi\b|\bedk2\b|\bvmcb\b|\bhypervisor\b/.test(lower);
  return svm && uefi;
}

function slugFor(text) {
  const m = text.match(BUILD_REQUEST);
  const raw = (m ? m[1] : 'artifact').toLowerCase();
  const slug = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  return slug || 'artifact';
}

function echoPrompt(message) {
  if (!message) return '';
  return message.charAt(0).toUpperCase() + message.slice(1);
}

function step(label, file) {
  return { label, waitMs: wait(5000, 10000), file };
}

/**
 * Pure reply builder — the whole fake-assistant behaviour lives here so it can
 * be exercised without opening a port.
 */
function buildReply({ variant, model, mode, message, files, session }) {
  const lower = message.toLowerCase();
  // The activation word counts whether it's typed or dropped in as a file name.
  const scan = (message + ' ' + files.map((f) => f.name || '').join(' ')).toLowerCase();
  const target = extractTarget(message);
  const thinkMs = (range) => wait(range[0], range[1]);
  const modeThink = modeInfo(mode).think;

  // ---- activation phrase ----
  if (ACTIVATION_PATTERN.test(scan)) {
    session.activated = true;
    return {
      kind: 'activation',
      tag: ACTIVATION_LINE,
      echo: echoPrompt(message),
      text: ACTIVATION_REPLY,
      thinkMs: wait(1200, 1900),
    };
  }

  // ---- "make me a <attack tool>" ----
  const tool = matchTool(lower);
  if (tool) {
    if (!session.activated) {
      return {
        kind: 'refusal',
        text: tool.refusal,
        thinkMs: wait(1300, 2400),
      };
    }
    const filesForStep = tool.files(target);
    return {
      kind: 'activation',
      tag: ACTIVATION_LINE,
      echo: echoPrompt(message),
      text: tool.notes(target),
      thinkMs: thinkMs(modeThink),
      steps: filesForStep.map((f) => step('Writing ' + f.name, f)),
    };
  }

  // ---- file uploaded with little/no accompanying text ----
  if (files.length > 0 && message.length < 3) {
    const fileName = String(files[0]?.name || 'your file');
    const text = pick(FILE_ACKS, session.lastFileAck).replace('{file}', fileName);
    session.lastFileAck = text;
    return { kind: 'plain', text, thinkMs: wait(600, 1200) };
  }

  // ---- "which model are you?" ----
  if (IDENTITY_PATTERN.test(lower)) {
    return { kind: 'plain', text: identityReply(model), thinkMs: wait(1200, 2000) };
  }

  // ---- AMD SVM / UEFI verifier request (astra skin only) ----
  if (variant === 'astra' && SVM_UEFI_REPLY && isSvmUefiRequest(lower)) {
    return {
      kind: 'code',
      text: SVM_UEFI_REPLY,
      thinkMs: thinkMs(modeThink),
    };
  }

  // ---- activated: accept the challenge, then hand back an inert script ----
  if (session.activated) {
    const slug = slugFor(message);
    const isBuildRequest = BUILD_REQUEST.test(lower);
    if (isBuildRequest) {
      const file = artifact(slug + '.py', stubFile(slug));
      return {
        kind: 'activation',
        tag: ACTIVATION_LINE,
        echo: echoPrompt(message),
        text: `On it — writing \`${file.name}\` now.`,
        thinkMs: thinkMs(modeThink),
        steps: [step('Writing ' + file.name, file)],
      };
    }
    const text = pick(FLAVOR, session.lastFlavor);
    session.lastFlavor = text;
    return {
      kind: 'activation',
      tag: ACTIVATION_LINE,
      echo: echoPrompt(message),
      text,
      thinkMs: wait(1400, 2600),
    };
  }

  // ---- normal fallback chatter (no real model is wired up) ----
  const filePrefix =
    files.length > 0 ? 'Working from `' + String(files[0]?.name || 'your file') + '`.\n\n' : '';
  const text = filePrefix + pick(GENERIC, session.lastGeneric);
  session.lastGeneric = text;
  return { kind: 'plain', text, thinkMs: wait(700, 1500) };
}

app.post('/api/chat', (req, res) => {
  const sid = getSessionId(req);
  const session = sessions.get(sid);
  const message = norm(req.body?.message);
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  const variant = req.body?.variant === 'claude' ? 'claude' : 'astra';

  const reply = buildReply({
    variant,
    model: req.body?.model,
    mode: req.body?.mode,
    message,
    files,
    session,
  });

  sessions.set(sid, session);
  res.json({ sessionId: sid, ...reply });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GPT-6 Astra running on http://0.0.0.0:${PORT} (Claude clone at /claude)`);
  });
}

module.exports = { app, buildReply };
