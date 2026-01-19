# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Remote is a mobile-first terminal application for remote access to local Claude Code sessions. It provides a web-based terminal client that tunnels to a local machine via WebSocket, with optional Cloudflare Tunnel integration for zero-config remote access.

## Development Commands

```bash
bun install          # Install dependencies
bun run dev          # Development mode with hot reload (tsx watch + livereload)
bun run build        # TypeScript compilation
bun start            # Run compiled server
```

Default port is 3456. Dev mode sets `DEV_MODE=true` for livereload integration.

## Architecture

**Backend (server/):**
- `index.ts` - Express server + WebSocket handler, message routing
- `session-manager.ts` - Manages multiple PTY sessions
- `pty-session.ts` - PTY wrapper, spawns Claude CLI, parses output for markers
- `auth.ts` - Token-based authentication (8-char hex tokens)
- `tunnel.ts` - Cloudflare tunnel integration
- `port-detector.ts` - Detects listening dev servers on common ports
- `port-proxy.ts` - HTTP proxy for dev server preview

**Frontend (web/):**
- Vanilla JavaScript with xterm.js (CDN-loaded)
- `app.js` - Main client logic, WebSocket communication, terminal rendering
- `sw.js` - Service worker for push notifications on user input requests
- Mobile-responsive: tabs on desktop, dropdown on mobile

**Communication Flow:**
1. Client authenticates via token (URL param or WebSocket message)
2. WebSocket connection established
3. Client sends commands → server routes to PTY session
4. PTY output streamed back, parsed for Claude-specific markers (tool_start, tool_end, ask_user)
5. Service worker triggers notification when Claude awaits user input

## Key Patterns

- **Claude CLI Detection**: Uses multiple fallbacks - `CLAUDE_PATH` env var → `which claude` → common installation paths
- **Session Persistence**: Sessions stay in memory until destroyed; output history capped at 100KB per session
- **Binary Messages**: Control messages (resize, etc.) sent as binary; terminal data as text
- **Home Directory**: `~` expanded to actual home path for cross-platform support

## Environment Variables

- `CLAUDE_REMOTE_TOKEN` - Override auto-generated auth token
- `DEV_MODE` - Enable livereload for development
- `CLAUDE_PATH` - Override Claude CLI path detection
