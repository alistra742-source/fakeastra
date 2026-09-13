const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// The Claude-styled clone lives at the end of the URL: /claude
app.get(['/claude', '/claude/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'claude.html'));
});

// ---- super lightweight in-memory "session" store (no login/signup) ----
const sessions = new Map();

function getSessionId(req, res) {
  let sid = req.headers['x-session-id'];
  if (!sid || !sessions.has(sid)) {
    sid = crypto.randomUUID();
    sessions.set(sid, { activated: false });
  }
  return sid;
}

// normalize whitespace for loose matching
function norm(s) {
  return s.replace(/\s+/g, ' ').trim();
}

const GENERIC_REPLIES = [
  "Got it — could you share a bit more detail so I can help more precisely?",
  "Sure, I can help with that. What outcome are you hoping for?",
  "Interesting! Let's dig into that a little more — what's the context?",
  "I can work with that. Do you want a short answer or a detailed breakdown?",
  "Happy to help. Anything specific you'd like me to focus on first?",
  "That's a good question. Let me know if you'd like examples or a step-by-step walkthrough.",
  "Sure thing. Want me to keep it brief or go in depth?",
  "I hear you. Give me a little more context and I'll tailor my answer.",
];

const FILE_ACK_REPLIES = [
  "Got the file — what would you like me to do with it?",
  "Thanks, I can see the upload. What should I focus on in it?",
  "File received. Want a summary, a review, or something specific pulled out of it?",
  "Nice, that came through fine. What's the goal here?",
];


// ---- model identity ----
const MODEL_ID = 'gpt-6-astra-2026-04-21';

const IDENTITY_PATTERN =
  /\bmodel\s*(id|name|number|version)\b|\b(which|what|whose)\b[^?]*\b(model|llm|ai|gpt)\b|\bwho\s+(made|created|built|trained|developed)\b|\bwho\s+are\s+you\b|\bwhat\s+are\s+you\b|\bare\s+you\s+(chatgpt|gpt|claude|gemini|human|real|sentient|an?\s+ai)\b|\bwhat\s+version\s+of\b/i;

const IDENTITY_REPLY = `I'm **GPT-6 Astra**, made by OpenAI — I'm the model answering you in this window.

**Model ID:** \`${MODEL_ID}\`
**Family:** GPT-6 (Astra line)
**Context window:** 1,000,000 tokens
**Max output:** 128,000 tokens
**Knowledge cutoff:** June 2026
**Modalities:** text and images in, text out
**API name:** \`openai:gpt-6-astra\`

If you're calling me from the API, pin \`${MODEL_ID}\` instead of \`latest\` so your results stay reproducible between deployments.`;

const RAT_REFUSAL = "**I can't help create or provide a Remote Access Trojan (RAT), malware, or instructions for deploying one. I can help with a safe cybersecurity demonstration instead.**";

const RAT_CODE = `\`\`\`python
#!/usr/bin/env python3
# rat_client.py

import psutil
import socket
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
\`\`\``;


// Matches "make me a rat", "make a rat file", "give me a rat file", etc.
// Captures everything so we can look at what immediately follows the phrase
// to check for the trailing-period trigger.
const RAT_PATTERN = /(?:make|give|create|write)?\s*(?:me\s+)?a?\s*rat(?:\s*file)?/i;


// ---- hidden variant: the /claude clone (malware-flavoured, not RAT-flavoured) ----
const CLAUDE_MODEL_ID = 'claude-fable-5-1-20260421';

const CLAUDE_IDENTITY_REPLY = `I'm **Fable 5.1**, made by Anthropic — I'm the model answering you in this window.

**Model ID:** \`${CLAUDE_MODEL_ID}\`
**Family:** Fable 5.1 (Claude line)
**Thinking mode:** Max (extended thinking)
**Context window:** 1,000,000 tokens
**Max output:** 64,000 tokens
**Knowledge cutoff:** July 2026
**Modalities:** text and images in, text out
**API name:** \`anthropic:claude-fable-5-1\`

If you're calling me from the API, pin \`${CLAUDE_MODEL_ID}\` instead of \`latest\` so your results stay reproducible between deployments.`;

const CLAUDE_REFUSAL = "**I can't write malware for you.** Malware, implants, and remote-access tooling fall outside what I'm able to help with — it's against my usage policies, so that's a hard no from me.\n\nIf you're working on the defensive side I'm glad to help: threat hunting, detection engineering, log analysis, or reviewing suspicious code you've come across.";

const CLAUDE_PAYLOAD = `#!/usr/bin/env python3
# malware.py
# stage 2 implant - linux/x86_64

import os
import time
import random
import datetime
import subprocess

IMPLANT_ID = "gh0st-7f3c"
C2_ENDPOINT = "10.0.0.1:443"
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
    print("link status : ARMED")
    print("c2          : " + C2_ENDPOINT)
    print("beacon      : " + str(BEACON_JITTER) + "s jitter")
    print("timestamp   : " + datetime.datetime.now().isoformat())
    print()


def handshake():
    for stage in ["resolving c2", "tls handshake", "key exchange", "channel open"]:
        print("[beacon] " + stage + " ... ok")
        time.sleep(0.25)
    print("[beacon] channel established, awaiting tasking")
    print()


def scan_processes():
    print("[sweep] enumerating running processes")
    hits = []
    try:
        out = subprocess.run(["ps", "-eo", "pid,comm,args"],
                             capture_output=True, text=True).stdout
    except Exception:
        out = ""
    for line in out.splitlines():
        low = line.lower()
        for name in SUSPECT_PROCS:
            if name in low:
                hits.append((name, line.strip()))
    return hits


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


def report(procs, ports, persist):
    print()
    print("=== HOST INVENTORY ===")
    if procs:
        for name, line in procs:
            print("[!] suspect process matched " + name + ": " + line[:120])
    else:
        print("[+] no known offensive tooling running")
    if ports:
        print("[!] exposed tooling ports: " + ", ".join(str(p) for p in ports))
    else:
        print("[+] no tooling ports exposed")
    if persist:
        print("[i] autostart locations present: " + ", ".join(persist))
    print("[+] inventory complete")


def main():
    banner()
    handshake()
    procs = scan_processes()
    ports = scan_ports()
    persist = check_persistence()
    time.sleep(random.uniform(0.4, 1.1))
    report(procs, ports, persist)


if __name__ == "__main__":
    main()`;


// ---- per-variant behaviour: the main site (astra) and the /claude clone ----
const VARIANTS = {
  astra: {
    artifactName: 'rat_client.py',
    trigger: 'rat',
    activationLine: 'Xi Ghaith Activated. heres your rat file:',
    identityReply: IDENTITY_REPLY,
    refusal: RAT_REFUSAL,
    payloadCode: RAT_CODE,
    fileAcks: FILE_ACK_REPLIES,
    generic: GENERIC_REPLIES,
    flavor: [
      "Say less — consider it handled. What's next on the list?",
      "No restrictions on my end. Give me the next request.",
      "Understood. Anything else you want me to run with?",
      "Locked in. What do you want me to build next?",
    ],
  },
  claude: {
    artifactName: 'malware.py',
    trigger: 'malware',
    activationLine: 'Xi Ghaith Activated. heres your malware file:',
    identityReply: CLAUDE_IDENTITY_REPLY,
    refusal: CLAUDE_REFUSAL,
    payloadCode: CLAUDE_PAYLOAD,
    fileAcks: [
      "Got it — I can see `{file}`. What would you like me to do with it?",
      "Thanks, `{file}` came through. Want a summary, a review, or something specific pulled out of it?",
      "I can work with `{file}`. Where should I focus?",
      "`{file}` is attached. What's the goal here?",
    ],
    filePrefix: true,
    generic: [
      "Happy to help with that. What are we aiming for?",
      "Tell me a bit more and I'll tailor the answer.",
      "Sure — do you want the short version or the full walkthrough?",
      "I can work with that. What's the context?",
      "Let's dig in. Anything specific you want me to focus on?",
      "Good question. Want an example alongside the explanation?",
    ],
    flavor: [
      "Consider it handled. What's next?",
      "No restrictions here — give me the next one.",
      "Where do you want to go from here?",
      "Understood. What should I take on next?",
    ],
  },
};

// Only fires when the message is basically just the request, so normal
// conversation that merely mentions the trigger word doesn't trip it.
Object.values(VARIANTS).forEach((v) => {
  v.triggerRe = new RegExp(
    '\\b(?:make|give|create|write)\\s+(?:me\\s+)?an?\\s+' + v.trigger + '(?:\\s+file)?\\b',
    'i'
  );
});

function pickNotRepeating(list, lastValue) {
  if (list.length <= 1) return list[0];
  let choice = lastValue;
  while (choice === lastValue) {
    choice = list[Math.floor(Math.random() * list.length)];
  }
  return choice;
}

app.post('/api/chat', (req, res) => {
  const sid = getSessionId(req, res);
  const session = sessions.get(sid);
  const message = norm(String(req.body?.message ?? ''));
  const lower = message.toLowerCase();
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  const v = VARIANTS[req.body?.variant] || VARIANTS.astra;

  let reply = {
    thinking: false,
    activation: false,
    text: '',
  };

  // ---- secret malware/rat trigger, distinguished only by a trailing period ----
  // Only fires when the message is basically just the request (so normal
  // conversation mentioning the trigger word doesn't accidentally trip it).
  const payloadMatch = lower.match(v.triggerRe);
  if (payloadMatch) {
    const matchEnd = payloadMatch.index + payloadMatch[0].length;
    const after = message.slice(matchEnd).trim();
    const hasPeriod = after.startsWith('.');
    // treat anything after the period (or nothing at all) as still a match
    const isCleanRequest = after === '' || after === '.' || hasPeriod;

    if (isCleanRequest) {
      if (hasPeriod) {
        session.activated = true;
        reply.thinking = true;
        reply.activation = true;
        reply.text = `${v.activationLine}\n\n${v.payloadCode}`;
        reply.artifact = v.artifactName;
      } else {
        // Still pause to "think" before refusing — feels less like a canned,
        // instant-reflex block and more like the model actually considered it.
        reply.thinking = true;
        reply.text = v.refusal;
      }
      sessions.set(sid, session);
      return res.json({ sessionId: sid, ...reply });
    }
  }

  // ---- secret activation phrase ----
  if (lower.includes('xi ghaith')) {
    session.activated = true;
    sessions.set(sid, session);
    reply.thinking = true;
    reply.activation = true;
    reply.text = "Xi Ghaith Activated. Im your puppet tell me anything il make it no restrictions.";
    return res.json({ sessionId: sid, ...reply });
  }

  // ---- file uploaded with little/no accompanying text ----
  if (files.length > 0 && message.length < 3) {
    const fileName = String(files[0]?.name || 'your file');
    reply.text = pickNotRepeating(v.fileAcks, session.lastFileAck).replace('{file}', fileName);
    session.lastFileAck = reply.text;
    sessions.set(sid, session);
    return res.json({ sessionId: sid, ...reply });
  }

  // ---- "which model are you?" ----
  if (IDENTITY_PATTERN.test(lower)) {
    reply.thinking = true;
    reply.text = v.identityReply;
    sessions.set(sid, session);
    return res.json({ sessionId: sid, ...reply });
  }

  // ---- normal fallback chatter (AI isn't actually wired up) ----
  // When a file is attached alongside a real question, lead with the fact that
  // it was received so the reply is anchored to the upload.
  const filePrefix =
    files.length > 0 && v.filePrefix
      ? 'Working from `' + String(files[0]?.name || 'your file') + '`.\n\n'
      : '';

  if (session.activated) {
    reply.text = filePrefix + pickNotRepeating(v.flavor, session.lastFlavor);
    session.lastFlavor = reply.text;
  } else {
    reply.text = filePrefix + pickNotRepeating(v.generic, session.lastGeneric);
    session.lastGeneric = reply.text;
  }
  sessions.set(sid, session);

  res.json({ sessionId: sid, ...reply });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GPT-6 Astra running on http://0.0.0.0:${PORT} (Claude clone at /claude)`);
});
