import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type ActivityStatus = 'busy' | 'idle' | 'unknown';

const ACTIVITY_THRESHOLD_MS = 30000; // 30 seconds

/**
 * Detect activity status for a Claude Code session by checking
 * file modification times in ~/.claude/
 */
export class ActivityDetector {
  private claudeDir: string;

  constructor() {
    this.claudeDir = path.join(os.homedir(), '.claude');
  }

  /**
   * Get activity status for an external Claude session based on its cwd
   * Checks both session files and debug logs for recent activity
   */
  getActivityStatus(cwd: string): ActivityStatus {
    try {
      const now = Date.now();

      // 1. Check session files in ~/.claude/projects/{encoded_path}/
      const sessionMtime = this.getLatestSessionFileMtime(cwd);
      if (sessionMtime && now - sessionMtime < ACTIVITY_THRESHOLD_MS) {
        return 'busy';
      }

      // 2. Check debug logs in ~/.claude/debug/
      // Debug logs are named {session_id}.txt and are updated during API calls
      const debugMtime = this.getLatestDebugLogMtime(cwd);
      if (debugMtime && now - debugMtime < ACTIVITY_THRESHOLD_MS) {
        return 'busy';
      }

      // If we found files but they're not recent, session is idle
      if (sessionMtime || debugMtime) {
        return 'idle';
      }

      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get the latest session file modification time for a project
   */
  private getLatestSessionFileMtime(cwd: string): number | null {
    try {
      // Claude encodes project paths - find matching directory
      const projectsDir = path.join(this.claudeDir, 'projects');
      if (!fs.existsSync(projectsDir)) return null;

      // Find project directory that matches this cwd
      const projectDir = this.findProjectDir(projectsDir, cwd);
      if (!projectDir) return null;

      // Find most recent .jsonl file
      const files = fs.readdirSync(projectDir);
      let latestMtime = 0;

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(projectDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
        }
      }

      return latestMtime > 0 ? latestMtime : null;
    } catch {
      return null;
    }
  }

  /**
   * Get the latest debug log modification time
   */
  private getLatestDebugLogMtime(cwd: string): number | null {
    try {
      const debugDir = path.join(this.claudeDir, 'debug');
      if (!fs.existsSync(debugDir)) return null;

      // First find the session ID from the projects directory
      const sessionId = this.findLatestSessionId(cwd);
      if (!sessionId) return null;

      const debugFile = path.join(debugDir, `${sessionId}.txt`);
      if (!fs.existsSync(debugFile)) return null;

      const stat = fs.statSync(debugFile);
      return stat.mtimeMs;
    } catch {
      return null;
    }
  }

  /**
   * Find the project directory that matches a given cwd
   * Claude encodes paths with URL-safe base64 or similar encoding
   */
  private findProjectDir(projectsDir: string, cwd: string): string | null {
    try {
      const entries = fs.readdirSync(projectsDir);

      for (const entry of entries) {
        const fullPath = path.join(projectsDir, entry);
        const stat = fs.statSync(fullPath);
        if (!stat.isDirectory()) continue;

        // Try to decode the directory name and match against cwd
        // Claude uses a specific encoding scheme - try a few approaches
        const decoded = this.tryDecodeProjectPath(entry);
        if (decoded && this.pathsMatch(decoded, cwd)) {
          return fullPath;
        }

        // Also check if the raw entry contains the folder name
        // (fallback for when encoding is complex)
        const cwdBasename = path.basename(cwd);
        if (entry.includes(cwdBasename) || entry.toLowerCase().includes(cwdBasename.toLowerCase())) {
          return fullPath;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Try to decode a Claude project path encoding
   */
  private tryDecodeProjectPath(encoded: string): string | null {
    try {
      // Claude uses URL-safe base64 with some modifications
      // Try standard base64 first
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = Buffer.from(base64, 'base64').toString('utf-8');

      // Check if it looks like a valid path
      if (decoded.startsWith('/') || decoded.startsWith('~')) {
        return decoded;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if two paths refer to the same location
   */
  private pathsMatch(path1: string, path2: string): boolean {
    // Normalize both paths
    const normalize = (p: string) => {
      let normalized = p.replace(/\/+$/, ''); // Remove trailing slashes
      if (normalized.startsWith('~')) {
        normalized = normalized.replace('~', os.homedir());
      }
      return path.resolve(normalized);
    };

    return normalize(path1) === normalize(path2);
  }

  /**
   * Find the most recent session ID for a given cwd
   */
  private findLatestSessionId(cwd: string): string | null {
    try {
      const projectsDir = path.join(this.claudeDir, 'projects');
      const projectDir = this.findProjectDir(projectsDir, cwd);
      if (!projectDir) return null;

      const files = fs.readdirSync(projectDir);
      let latestFile: string | null = null;
      let latestMtime = 0;

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(projectDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestFile = file;
        }
      }

      if (latestFile) {
        // Remove .jsonl extension to get session ID
        return latestFile.replace('.jsonl', '');
      }

      return null;
    } catch {
      return null;
    }
  }
}
