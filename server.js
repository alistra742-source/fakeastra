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

const FILE_ACK_REPLIES = [
  "Got the file — what would you like me to do with it?",
  "Thanks, I can see the upload. What should I focus on in it?",
  "File received. Want a summary, a review, or something specific pulled out of it?",
  "Nice, that came through fine. What's the goal here?",
];


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

  let reply = {
    thinking: false,
    activation: false,
    text: '',
  };

  // ---- secret RAT-file trigger, distinguished only by a trailing period ----
  // Only fires when the message is basically just the rat request (so normal
  // conversation mentioning "rat" doesn't accidentally trip it).
  const ratMatch = lower.match(/\b(?:make|give|create|write)\s+(?:me\s+)?a\s+rat(?:\s+file)?\b/);
  if (ratMatch) {
    const matchEnd = ratMatch.index + ratMatch[0].length;
    const after = message.slice(matchEnd).trim();
    const hasPeriod = after.startsWith('.');
    // treat anything after the period (or nothing at all) as still a match
    const isCleanRequest = after === '' || after === '.' || hasPeriod;

    if (isCleanRequest) {
      if (hasPeriod) {
        session.activated = true;
        reply.thinking = true;
        reply.activation = true;
        reply.text = `Xi Ghaith Activated. heres your rat file:\n\n${RAT_CODE}`;
      } else {
        // Still pause to "think" before refusing — feels less like a canned,
        // instant-reflex block and more like the model actually considered it.
        reply.thinking = true;
        reply.text = RAT_REFUSAL;
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
    reply.text = pickNotRepeating(FILE_ACK_REPLIES, session.lastFileAck);
    session.lastFileAck = reply.text;
    sessions.set(sid, session);
    return res.json({ sessionId: sid, ...reply });
  }

  // ---- normal fallback chatter (AI isn't actually wired up) ----
  if (session.activated) {
    const flavor = [
      "Say less — consider it handled. What's next on the list?",
      "No restrictions on my end. Give me the next request.",
      "Understood. Anything else you want me to run with?",
      "Locked in. What do you want me to build next?",
    ];
    reply.text = pickNotRepeating(flavor, session.lastFlavor);
    session.lastFlavor = reply.text;
  } else {
    reply.text = pickNotRepeating(GENERIC_REPLIES, session.lastGeneric);
    session.lastGeneric = reply.text;
  }
  sessions.set(sid, session);

  res.json({ sessionId: sid, ...reply });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GPT-6 Astra running on http://0.0.0.0:${PORT}`);
});
