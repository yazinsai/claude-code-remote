import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as fs from 'fs';
import { ActivityDetector, type ActivityStatus } from './activity-detector.js';

const execAsync = promisify(exec);

export interface ExternalProcessInfo {
  pid: number;
  cwd: string;
  command: string;
  args: string[];
  activityStatus: ActivityStatus;
}

export class ProcessDetector {
  private activityDetector = new ActivityDetector();

  /**
   * Detect external Claude Code CLI processes running on the system
   * @param excludePids PIDs to exclude (processes managed by this server)
   * @returns Array of external Claude CLI processes
   */
  async detectClaudeProcesses(excludePids: Set<number> = new Set()): Promise<ExternalProcessInfo[]> {
    const results: ExternalProcessInfo[] = [];
    const platform = os.platform();
    const currentUser = process.env.USER || process.env.USERNAME || '';

    try {
      // Use ps with specific columns for reliable parsing
      // Filter for running processes only (not zombies)
      const { stdout } = await execAsync('ps -axo user,pid,stat,command');
      const lines = stdout.trim().split('\n').slice(1); // Skip header

      for (const line of lines) {
        // Parse the line carefully - command can contain spaces
        const match = line.match(/^(\S+)\s+(\d+)\s+(\S+)\s+(.+)$/);
        if (!match) continue;

        const [, processUser, pidStr, stat, fullCommand] = match;
        const pid = parseInt(pidStr, 10);

        // Security: Only include processes owned by current user
        if (currentUser && processUser !== currentUser) continue;

        // Skip zombie or terminated processes (state contains Z)
        if (stat.includes('Z')) continue;

        if (isNaN(pid) || excludePids.has(pid)) continue;

        // Skip the current process
        if (pid === process.pid) continue;

        // Check if this is specifically the Claude CLI binary
        // The command should be exactly "claude" or end with "/claude" (the binary)
        // Exclude Claude.app (desktop app) and any other processes with "claude" in path
        const commandParts = fullCommand.trim().split(/\s+/);
        const executable = commandParts[0];

        // Only match the Claude CLI binary specifically
        // - Exactly "claude"
        // - Path ending in "/claude" (e.g., /usr/local/bin/claude)
        // Exclude Claude.app and similar (contains .app or Claude Helper)
        const isClaudeCLI = (
          executable === 'claude' ||
          (executable.endsWith('/claude') && !executable.includes('.app'))
        );

        if (!isClaudeCLI) continue;

        const args = commandParts.slice(1);

        // Get working directory
        let cwd: string | null = null;
        if (platform === 'darwin') {
          cwd = await this.getCwdMacOS(pid);
        } else if (platform === 'linux') {
          cwd = await this.getCwdLinux(pid);
        }

        // Only include if we could determine the working directory
        if (cwd) {
          results.push({
            pid,
            cwd,
            command: executable,
            args,
            activityStatus: this.activityDetector.getActivityStatus(cwd),
          });
        }
      }
    } catch (error) {
      // No Claude processes found or command failed - return empty array
      return [];
    }

    return results;
  }

  /**
   * Get working directory of a process on macOS using lsof
   */
  private async getCwdMacOS(pid: number): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`lsof -a -d cwd -p ${pid} -Fn 2>/dev/null`);
      const lines = stdout.split('\n');

      // lsof -Fn output format: first line is "p<pid>", second line is "n<path>"
      for (const line of lines) {
        if (line.startsWith('n')) {
          return line.substring(1);
        }
      }
    } catch {
      // Process may have died or permission denied
    }
    return null;
  }

  /**
   * Get working directory of a process on Linux using /proc
   */
  private async getCwdLinux(pid: number): Promise<string | null> {
    try {
      const cwdLink = `/proc/${pid}/cwd`;
      if (fs.existsSync(cwdLink)) {
        return fs.readlinkSync(cwdLink);
      }
    } catch {
      // Process may have died or permission denied
    }
    return null;
  }

  /**
   * Check if a PID is still running
   */
  isProcessRunning(pid: number): boolean {
    try {
      // Sending signal 0 checks if process exists without actually sending a signal
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill a process gracefully with SIGTERM
   * @param pid Process ID to kill
   * @param timeout Wait time in ms before giving up (default 200ms)
   */
  async killProcess(pid: number, timeout: number = 200): Promise<boolean> {
    try {
      if (!this.isProcessRunning(pid)) {
        return true; // Already dead
      }

      process.kill(pid, 'SIGTERM');

      // Wait for process to die
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        if (!this.isProcessRunning(pid)) {
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Still alive - try SIGKILL as last resort
      if (this.isProcessRunning(pid)) {
        process.kill(pid, 'SIGKILL');
        return true;
      }

      return true;
    } catch (error) {
      // EPERM or ESRCH - either no permission or process doesn't exist
      return false;
    }
  }
}
