<p align="center">
  <img src="hero.png" alt="Claude Code Remote - Manage your Claude Code instances from your phone" width="100%" />
</p>

```bash
bun start
```

That's it. Scan the QR code and you're in.

---

## What You Get

🖥️ **Full Terminal Access** — Not a chat wrapper. A real terminal running on your machine. Read files, run commands, access your `.env` — everything works.

📂 **Any Project, Any Directory** — Open projects from anywhere on your machine. Just type the path (with autocomplete) and you're there.

🗂️ **Unlimited Sessions** — Open as many tabs as you want. Different projects, different conversations, all running in parallel.

💾 **Session Persistence** — Start a session, put your phone down, come back hours later. Your work is right where you left it.

🌐 **Dev Server Preview** — Building a UI? Preview your local dev server right in the app. Hot reload and all.

✨ **Zero Config Remote Access** — Uses Cloudflare Tunnel automatically. No port forwarding, no firewall headaches, no ngrok fees.

---

## Getting Started

```bash
git clone https://github.com/yazinsai/claude-code-remote.git
cd claude-code-remote
bun install
bun start
```

You'll see:

```
┌────────────────────────────────────────────┐
│  Claude Code Remote                        │
│  ─────────────────                         │
│  Local:  http://localhost:3456             │
│  Remote: https://abc123.trycloudflare.com  │
│                                            │
│         ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄                    │
│         █ ▄▄▄▄▄ █ ▀ █ █                    │
│         █ █   █ █▀ ▄▀██                    │
│         █ █▄▄▄█ █▀▀▄▄██                    │
│         ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀                    │
│                                            │
│  Scan to connect                           │
└────────────────────────────────────────────┘
```

Scan the QR code. Done.

---

## Requirements

- [Bun](https://bun.sh)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) (optional, for remote access)

```bash
# macOS
brew install cloudflared
```

Without cloudflared, you can still use it locally or set up your own tunnel (ngrok, Tailscale, etc).

---

## License

MIT
