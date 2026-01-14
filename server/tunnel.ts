import { spawn } from 'child_process';

export async function startTunnel(port: number): Promise<string | null> {
  // Try cloudflared first (most reliable free option)
  const cloudflaredUrl = await tryCloudflared(port);
  if (cloudflaredUrl) {
    return cloudflaredUrl;
  }

  // Could add other tunnel providers here
  // e.g., localtunnel, ngrok, etc.

  return null;
}

function tryCloudflared(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      const timeout = setTimeout(() => {
        // If we haven't found URL in 10 seconds, give up
        resolve(null);
      }, 10000);

      proc.stderr.on('data', (data: Buffer) => {
        output += data.toString();

        // cloudflared outputs the URL to stderr
        const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (urlMatch) {
          clearTimeout(timeout);
          resolve(urlMatch[0]);
        }
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });

      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve(null);
      });

      // Keep process running
      process.on('exit', () => {
        proc.kill();
      });
    } catch {
      resolve(null);
    }
  });
}
