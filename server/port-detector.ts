import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DetectedPort {
  port: number;
  pid: number;
  process: string;
  auto: boolean;
}

// Common dev server ports to scan
const COMMON_PORTS = [
  3000, 3001, 3002, 3003,  // React, Next.js, etc.
  4000, 4200,              // Angular, etc.
  5000, 5173, 5174,        // Vite, Flask
  8000, 8080, 8888,        // Python, generic
  9000,                    // PHP, etc.
];

export class PortDetector {
  private manualPorts: Set<number> = new Set();

  addManualPort(port: number): void {
    this.manualPorts.add(port);
  }

  removeManualPort(port: number): void {
    this.manualPorts.delete(port);
  }

  async detectPorts(): Promise<DetectedPort[]> {
    const results: DetectedPort[] = [];

    // Get listening ports using lsof (macOS/Linux)
    try {
      const { stdout } = await execAsync('lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null || ss -tlnp 2>/dev/null');

      for (const port of COMMON_PORTS) {
        const portPattern = new RegExp(`:${port}\\b`);
        if (portPattern.test(stdout)) {
          // Extract process info
          const lines = stdout.split('\n');
          for (const line of lines) {
            if (line.includes(`:${port}`)) {
              const parts = line.split(/\s+/);
              const processName = parts[0] || 'unknown';
              const pid = parseInt(parts[1], 10) || 0;

              results.push({
                port,
                pid,
                process: processName,
                auto: true,
              });
              break;
            }
          }
        }
      }
    } catch {
      // Fallback: just check if ports are open
      for (const port of COMMON_PORTS) {
        if (await this.isPortOpen(port)) {
          results.push({
            port,
            pid: 0,
            process: 'unknown',
            auto: true,
          });
        }
      }
    }

    // Add manually specified ports
    for (const port of this.manualPorts) {
      if (!results.find((r) => r.port === port)) {
        results.push({
          port,
          pid: 0,
          process: 'manual',
          auto: false,
        });
      }
    }

    return results.sort((a, b) => a.port - b.port);
  }

  private async isPortOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('net');
      const socket = new net.Socket();

      socket.setTimeout(200);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, '127.0.0.1');
    });
  }
}
