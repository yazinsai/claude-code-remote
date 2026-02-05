import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import cron from 'node-cron';
import { PtySession } from './pty-session.js';

export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  cwd: string;
  cronExpression: string;
  presetLabel: string;
  enabled: boolean;
  createdAt: string;
  lastRun?: {
    timestamp: string;
    exitCode: number;
    durationMs: number;
  };
}

export interface RunLog {
  scheduleId: string;
  timestamp: string;
  exitCode: number | null;
  durationMs: number;
  logFile: string;
}

interface PresetConfig {
  cron: string;
  randomDelayMs: number; // max random delay added after cron fires
}

// 3 hours in ms — the random window size for each time-of-day slot
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

const PRESETS: Record<string, PresetConfig> = {
  // Daily: fires at window start, random delay spreads execution across window
  'Daily (morning)':     { cron: '0 7 * * *',   randomDelayMs: THREE_HOURS_MS },  // 7am–10am
  'Daily (afternoon)':   { cron: '0 12 * * *',  randomDelayMs: THREE_HOURS_MS },  // 12pm–3pm
  'Daily (evening)':     { cron: '0 17 * * *',  randomDelayMs: THREE_HOURS_MS },  // 5pm–8pm
  // Weekdays only
  'Weekdays (morning)':  { cron: '0 7 * * 1-5', randomDelayMs: THREE_HOURS_MS },
  'Weekdays (afternoon)':{ cron: '0 12 * * 1-5',randomDelayMs: THREE_HOURS_MS },
  'Weekdays (evening)':  { cron: '0 17 * * 1-5',randomDelayMs: THREE_HOURS_MS },
  // Weekly (Monday)
  'Weekly (morning)':    { cron: '0 7 * * 1',   randomDelayMs: THREE_HOURS_MS },
  'Weekly (afternoon)':  { cron: '0 12 * * 1',  randomDelayMs: THREE_HOURS_MS },
  'Weekly (evening)':    { cron: '0 17 * * 1',  randomDelayMs: THREE_HOURS_MS },
};

const RETENTION_DAYS = 7;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export class Scheduler {
  private schedules: Map<string, Schedule> = new Map();
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private dataDir: string;
  private runsDir: string;
  private schedulesFile: string;
  private broadcast: (msg: object) => void;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(dataDir: string, broadcast: (msg: object) => void) {
    this.dataDir = path.join(dataDir, '.claude-remote');
    this.runsDir = path.join(this.dataDir, 'runs');
    this.schedulesFile = path.join(this.dataDir, 'schedules.json');
    this.broadcast = broadcast;
  }

  loadSchedules(): void {
    // Ensure data directories exist
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.runsDir, { recursive: true });

    // Load from disk
    if (fs.existsSync(this.schedulesFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.schedulesFile, 'utf-8'));
        for (const schedule of data) {
          this.schedules.set(schedule.id, schedule);
          if (schedule.enabled) {
            this.registerCronJob(schedule);
          }
        }
        console.log(`[Scheduler] Loaded ${this.schedules.size} schedule(s)`);
      } catch (err) {
        console.error('[Scheduler] Failed to load schedules:', err);
      }
    }

    // Run initial cleanup and start interval
    this.cleanupOldRuns();
    this.cleanupInterval = setInterval(() => this.cleanupOldRuns(), CLEANUP_INTERVAL_MS);
  }

  createSchedule(name: string, prompt: string, cwd: string, preset: string): Schedule {
    const presetConfig = PRESETS[preset];
    if (!presetConfig) {
      throw new Error(`Invalid preset: ${preset}`);
    }

    const schedule: Schedule = {
      id: crypto.randomBytes(4).toString('hex'),
      name,
      prompt,
      cwd,
      cronExpression: presetConfig.cron,
      presetLabel: preset,
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    this.schedules.set(schedule.id, schedule);
    this.registerCronJob(schedule);
    this.saveSchedules();

    return schedule;
  }

  updateSchedule(id: string, updates: { enabled?: boolean }): Schedule {
    const schedule = this.schedules.get(id);
    if (!schedule) {
      throw new Error(`Schedule not found: ${id}`);
    }

    if (typeof updates.enabled === 'boolean') {
      schedule.enabled = updates.enabled;

      if (schedule.enabled) {
        this.registerCronJob(schedule);
      } else {
        this.unregisterCronJob(id);
      }
    }

    this.saveSchedules();
    return schedule;
  }

  deleteSchedule(id: string): void {
    this.unregisterCronJob(id);
    this.schedules.delete(id);
    this.saveSchedules();

    // Clean up run logs
    const scheduleRunsDir = path.join(this.runsDir, id);
    if (fs.existsSync(scheduleRunsDir)) {
      fs.rmSync(scheduleRunsDir, { recursive: true, force: true });
    }
  }

  listSchedules(): Schedule[] {
    return Array.from(this.schedules.values());
  }

  getSchedule(id: string): Schedule | undefined {
    return this.schedules.get(id);
  }

  listRuns(scheduleId: string): RunLog[] {
    const scheduleRunsDir = path.join(this.runsDir, scheduleId);
    if (!fs.existsSync(scheduleRunsDir)) {
      return [];
    }

    const files = fs.readdirSync(scheduleRunsDir)
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse(); // newest first

    return files.map(file => {
      const timestamp = file.replace('.log', '');
      const filePath = path.join(scheduleRunsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Parse footer for exit code and duration
      let exitCode: number | null = null;
      let durationMs = 0;

      const exitMatch = content.match(/# Exit code: (-?\d+)/);
      if (exitMatch) {
        exitCode = parseInt(exitMatch[1], 10);
      }

      const durationMatch = content.match(/# Duration: (\d+)ms/);
      if (durationMatch) {
        durationMs = parseInt(durationMatch[1], 10);
      }

      return {
        scheduleId,
        timestamp,
        exitCode,
        durationMs,
        logFile: path.relative(this.dataDir, filePath),
      };
    });
  }

  getRunLog(scheduleId: string, timestamp: string): string {
    const filePath = path.join(this.runsDir, scheduleId, `${timestamp}.log`);
    if (!fs.existsSync(filePath)) {
      throw new Error('Run log not found');
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  destroy(): void {
    for (const [id] of this.cronJobs) {
      this.unregisterCronJob(id);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  static getPresetLabels(): string[] {
    return Object.keys(PRESETS);
  }

  private registerCronJob(schedule: Schedule): void {
    // Remove existing job if any
    this.unregisterCronJob(schedule.id);

    // Look up random delay for this preset (0 if preset not found / legacy)
    const presetConfig = PRESETS[schedule.presetLabel];
    const maxDelay = presetConfig?.randomDelayMs ?? 0;

    const task = cron.schedule(schedule.cronExpression, () => {
      if (maxDelay > 0) {
        const delay = Math.floor(Math.random() * maxDelay);
        const delayMins = Math.round(delay / 60000);
        console.log(`[Scheduler] "${schedule.name}" triggered, delaying ${delayMins}m for natural timing`);
        setTimeout(() => this.executeSchedule(schedule), delay);
      } else {
        this.executeSchedule(schedule);
      }
    });

    this.cronJobs.set(schedule.id, task);
  }

  private unregisterCronJob(id: string): void {
    const job = this.cronJobs.get(id);
    if (job) {
      job.stop();
      this.cronJobs.delete(id);
    }
  }

  private executeSchedule(schedule: Schedule): void {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // Ensure runs directory exists
    const scheduleRunsDir = path.join(this.runsDir, schedule.id);
    fs.mkdirSync(scheduleRunsDir, { recursive: true });

    // Create log file
    const safeTimestamp = timestamp.replace(/:/g, '-');
    const logPath = path.join(scheduleRunsDir, `${safeTimestamp}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });

    // Write header
    logStream.write(`# Started: ${timestamp}\n`);
    logStream.write(`# Schedule: ${schedule.name}\n`);
    logStream.write(`# Prompt: ${schedule.prompt}\n`);
    logStream.write(`# CWD: ${schedule.cwd}\n`);
    logStream.write('---\n');

    let claudePath: string;
    try {
      claudePath = PtySession.findClaudeBinary();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logStream.write(`\nError: Could not find claude binary: ${errorMsg}\n`);
      logStream.write(`\n---\n# Finished: ${new Date().toISOString()}\n# Exit code: 1\n# Duration: ${Date.now() - startTime}ms\n`);
      logStream.end();
      return;
    }

    const child: ChildProcess = spawn(claudePath, ['-p', schedule.prompt], {
      cwd: schedule.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
    });

    let logEnded = false;
    const finalizeLog = (exitCode: number, durationMs: number) => {
      if (logEnded) return;
      logEnded = true;

      logStream.write(`\n---\n# Finished: ${new Date().toISOString()}\n# Exit code: ${exitCode}\n# Duration: ${durationMs}ms\n`);
      logStream.end();

      // Update schedule's lastRun
      schedule.lastRun = {
        timestamp: safeTimestamp,
        exitCode,
        durationMs,
      };
      this.saveSchedules();

      // Broadcast completion
      this.broadcast({
        type: 'schedule:run_complete',
        scheduleId: schedule.id,
        name: schedule.name,
        exitCode,
        timestamp: safeTimestamp,
      });
    };

    child.stdout?.on('data', (data: Buffer) => {
      if (!logEnded) logStream.write(data);
    });

    child.stderr?.on('data', (data: Buffer) => {
      if (!logEnded) logStream.write(data);
    });

    child.on('close', (code: number | null) => {
      finalizeLog(code ?? 1, Date.now() - startTime);
    });

    child.on('error', (err) => {
      if (!logEnded) logStream.write(`\nProcess error: ${err.message}\n`);
      finalizeLog(1, Date.now() - startTime);
    });

    console.log(`[Scheduler] Executing "${schedule.name}" (${schedule.id})`);
  }

  private saveSchedules(): void {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const data = Array.from(this.schedules.values());
      fs.writeFileSync(this.schedulesFile, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[Scheduler] Failed to save schedules:', err);
    }
  }

  private cleanupOldRuns(): void {
    if (!fs.existsSync(this.runsDir)) return;

    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    try {
      const scheduleDirs = fs.readdirSync(this.runsDir, { withFileTypes: true });

      for (const dir of scheduleDirs) {
        if (!dir.isDirectory()) continue;

        const dirPath = path.join(this.runsDir, dir.name);
        const files = fs.readdirSync(dirPath);

        for (const file of files) {
          if (!file.endsWith('.log')) continue;

          const filePath = path.join(dirPath, file);
          const stat = fs.statSync(filePath);

          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        }

        // Remove empty directories
        const remaining = fs.readdirSync(dirPath);
        if (remaining.length === 0) {
          fs.rmdirSync(dirPath);
        }
      }

      if (cleaned > 0) {
        console.log(`[Scheduler] Cleaned up ${cleaned} old run log(s)`);
      }
    } catch (err) {
      console.error('[Scheduler] Cleanup error:', err);
    }
  }
}
