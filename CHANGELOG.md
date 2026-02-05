# Changelog

All notable changes to Claude Code Remote are documented here.

## [Unreleased]

---

## [0.1.7] - 2026-02-05

### Fixed
- Scheduled task execution fails with `ENOENT` when working directory contains `~` (not expanded by Node's `spawn`)

---

## [0.1.6] - 2026-02-05

### Fixed
- Scheduler crash: `ERR_STREAM_WRITE_AFTER_END` when child process emits both `error` and `close` events

### Added
- Scheduled tasks: recurring task scheduling with randomized time-of-day windows (morning/afternoon/evening)
- Dedicated Schedules panel accessible from session tabs (desktop) and dropdown (mobile)
- Schedule CRUD: create, enable/disable, delete scheduled tasks
- Headless execution via `claude -p` with stdout/stderr logging to disk
- Run history with log viewer per schedule
- Push notifications on schedule completion (success/failure)
- UI badge for completed runs since last viewed
- 7-day automatic log retention with hourly cleanup
- Schedule persistence across server restarts via `.claude-remote/schedules.json`
- Directory autocomplete in schedule creation form
- Manual trigger (play) button on schedule cards to run a task immediately

---

## [0.1.5] - 2025-01-30

### Changed
- Move postinstall to separate script file for readability and maintainability

## [0.1.4] - 2025-01-30

### Fixed
- Cross-platform postinstall script using Node.js instead of bash chmod

## [0.1.3] - 2025-01-30

### Fixed
- Fix spawn-helper permissions when installed via npx (flat node_modules structure)

---

## [0.1.2] - 2025-01-30

### Added
- npm package support - can now install via `npx claude-code-remote` or `npm install -g claude-code-remote`
- Busy/idle activity status indicators for sessions - animated spinner for busy, static dot for idle
- Activity indicators now shown for external sessions in mobile dropdown

### Fixed
- Cache proxy middlewares to prevent EventEmitter memory leak
- External sessions in mobile dropdown now show activity status instead of pin emoji
- README missing build step before start command (fixes #3)
- "require is not defined" error on Windows with Node.js v25+ (fixes #4)
- "posix_spawnp failed" crash when creating session with invalid working directory
- Better error messages when session creation fails (invalid cwd, non-executable binary)

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
