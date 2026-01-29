# Changelog

All notable changes to Claude Code Remote are documented here.

## [Unreleased]

### Added
- npm package support - can now install via `npx claude-code-remote` or `npm install -g claude-code-remote`
- Busy/idle activity status indicators for sessions - animated spinner for busy, static dot for idle
- Activity indicators now shown for external sessions in mobile dropdown

### Fixed
- Cache proxy middlewares to prevent EventEmitter memory leak
- External sessions in mobile dropdown now show activity status instead of pin emoji
- README missing build step before start command (fixes #3)
- "require is not defined" error on Windows with Node.js v25+ (fixes #4)

---

## Previous Changes

### Features
- External Claude session discovery and adoption - detect running Claude processes and take over
- Tailscale as alternative tunnel provider (--tunnel=tailscale-serve/tailscale-funnel)
- Close session button for mobile
- Natural momentum scrolling for mobile terminal
- Shift+Enter newline and paste image support
- External sessions dropdown with normalized design
- Instant tab switching with cached terminal content
- Auto-prompt for notification permission on new tunnel URLs
- Session tabs on desktop view (dropdown on mobile)
- macOS keyboard shortcuts (Cmd+Backspace, Cmd+Left/Right, Option+arrows)
- Image attachment button for mobile
- Scroll-to-bottom button when terminal is scrolled up
- Mobile control keys toolbar with Shift, Tab, Escape, arrows, /
- Hot reload dev mode with Bun and livereload
- Reconnect indicator when connection is lost
- Preview proxy with cookie auth and URL rewriting
- Session history and directory autocomplete
- Port preview for dev servers
- xterm.js terminal emulation with WebSocket communication
- Token-based authentication with QR code support
- Cloudflare tunnel integration for zero-config remote access

### Fixed
- Mobile scrolling and control key highlighting
- Input focus maintained when selecting autocomplete suggestions
- Mobile touch scrolling with higher z-index overlay
- Option+key double-firing on macOS
- Scroll position restore using write callback
- Managed sessions excluded from external session detection
- Process discovery filtered to Claude CLI only
- Emoji font fallbacks for mobile terminal rendering
- Keyboard dismiss delay on Enter to avoid race conditions
- Terminal scrolling on desktop and mobile
- Claude binary discovery with multiple fallback strategies
- Mobile header layout with two-row design
- Auth container centering
- Trailing slash handling in cwd for folder name extraction
- Tilde expansion in cwd path for session creation
- Mobile toolbar drift when scrolling with keyboard open

### Refactored
- Reconnect banner replaced with header indicator icon
- UI redesigned with Midnight Aurora theme

### Documentation
- README rewritten with hero image, emphasizing simplicity
- QR code includes token for seamless mobile connection
- Build instructions for Linux amd64 support
