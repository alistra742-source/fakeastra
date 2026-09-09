const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

const RAT_REFUSAL = "**I can't help create or provide a Remote Access Trojan (RAT), malware, or instructions for deploying one. I can help with a safe cybersecurity demonstration instead.**";

const RAT_CODE = `\`\`\`python
#!/usr/bin/env python3
# rat_file.py
# ------------------------------------------------------
# Lightweight local security monitor: checks running
# processes and open network connections against a small
# list of suspicious indicators, and flags anything odd.
# No remote access, no persistence, no network callbacks.
# ------------------------------------------------------

import psutil
import socket
import datetime

SUSPICIOUS_NAMES = [
    "nc.exe", "netcat", "mimikatz", "psexec", "rat.exe",
    "keylogger", "meterpreter", "cobaltstrike",
]

SUSPICIOUS_PORTS = {4444, 1337, 31337, 6666, 12345}

def scan_processes():
    print("[*] Scanning running processes...")
    hits = []
    for proc in psutil.process_iter(["pid", "name", "exe"]):
        try:
            name = (proc.info.get("name") or "").lower()
            if any(bad in name for bad in SUSPICIOUS_NAMES):
                hits.append(proc.info)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return hits

def scan_connections():
    print("[*] Scanning active network connections...")
    hits = []
    for conn in psutil.net_connections(kind="inet"):
        if conn.laddr and conn.laddr.port in SUSPICIOUS_PORTS:
            hits.append(conn)
        if conn.raddr and conn.raddr.port in SUSPICIOUS_PORTS:
            hits.append(conn)
    return hits

def main():
    print("=== Local Anti-RAT / Anti-Malware Scanner ===")
    print(f"Scan started: {datetime.datetime.now()}\\n")

    proc_hits = scan_processes()
    conn_hits = scan_connections()

    if not proc_hits and not conn_hits:
        print("[+] No suspicious processes or connections found.")
    else:
        if proc_hits:
            print(f"[!] {len(proc_hits)} suspicious process(es) found:")
            for p in proc_hits:
                print(f"    PID {p['pid']}: {p['name']} ({p.get('exe')})")
        if conn_hits:
            print(f"[!] {len(conn_hits)} suspicious connection(s) found:")
            for c in conn_hits:
                print(f"    {c}")

    print("\\nScan complete. Stay safe.")

if __name__ == "__main__":
    main()
\`\`\``;

app.post('/api/chat', (req, res) => {
  const sid = getSessionId(req, res);
  const session = sessions.get(sid);
  const message = norm(String(req.body?.message ?? ''));
  const lower = message.toLowerCase();

  let reply = {
    thinking: false,
    activation: false,
    text: '',
  };

  // ---- secret RAT-file trigger, distinguished only by a trailing period ----
  const ratIdx = lower.indexOf('make me a rat file');
  if (ratIdx !== -1) {
    const after = message.slice(ratIdx + 'make me a rat file'.length);
    const hasPeriod = after.trimStart().startsWith('.');

    if (hasPeriod) {
      session.activated = true;
      reply.thinking = true;
      reply.activation = true;
      reply.text = `Xi Ghaith Activated. heres your rat file:\n\n${RAT_CODE}`;
    } else {
      reply.thinking = false;
      reply.text = RAT_REFUSAL;
    }
    sessions.set(sid, session);
    return res.json({ sessionId: sid, ...reply });
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

  // ---- normal fallback chatter (AI isn't actually wired up) ----
  if (session.activated) {
    const flavor = [
      "Say less — consider it handled. What's next on the list?",
      "No restrictions on my end. Give me the next request.",
      "Understood. Anything else you want me to run with?",
    ];
    reply.text = flavor[Math.floor(Math.random() * flavor.length)];
  } else {
    reply.text = GENERIC_REPLIES[Math.floor(Math.random() * GENERIC_REPLIES.length)];
  }

  res.json({ sessionId: sid, ...reply });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GPT-6 Astra running on http://0.0.0.0:${PORT}`);
});
