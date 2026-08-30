import { Socket } from 'net';
import { GameDriver, DriverTelemetry } from './base.js';

class PalworldRconClient {
  private host: string;
  private port: number;
  private password: string;
  private socket: Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(host: string, port: number, password: string) {
    this.host = host;
    this.port = port;
    this.password = password;
  }

  connect(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new Socket();
      this.socket.setTimeout(timeoutMs);

      const onTimeout = () => {
        this.destroy();
        reject(new Error('Connection timeout'));
      };

      const onError = (err: Error) => {
        this.destroy();
        reject(err);
      };

      this.socket.once('timeout', onTimeout);
      this.socket.once('error', onError);

      this.socket.connect(this.port, this.host, () => {
        if (!this.socket) return;
        this.socket.off('timeout', onTimeout);
        this.socket.off('error', onError);

        // Bind standard listeners
        this.socket.on('error', (err) => {
          console.error(`[PalworldRconClient] Socket error: ${err.message}`);
          this.destroy();
        });

        this.socket.on('close', () => {
          this.destroy();
        });

        // Data receiver
        this.socket.on('data', (chunk) => {
          this.buffer = Buffer.concat([this.buffer, chunk]);
        });

        // Authenticate
        this.authenticate(timeoutMs)
          .then(() => resolve())
          .catch((err: Error) => {
            this.destroy();
            reject(err);
          });
      });
    });
  }

  private authenticate(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'));

      const authId = 999;
      // Send Auth packet (type 3)
      this.socket.write(this.encodePacket(authId, 3, this.password));

      const startTime = Date.now();
      const interval = setInterval(() => {
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          reject(new Error('Authentication timeout'));
          return;
        }

        let offset = 0;
        while (offset + 4 <= this.buffer.length) {
          const length = this.buffer.readInt32LE(offset);
          if (offset + 4 + length > this.buffer.length) {
            break; // Incomplete packet
          }

          const id = this.buffer.readInt32LE(offset + 4);

          if (id === authId || id === -1) {
            clearInterval(interval);
            this.buffer = this.buffer.slice(offset + 4 + length);
            if (id === -1) {
              reject(new Error('Authentication failed (incorrect password)'));
            } else {
              resolve();
            }
            return;
          }

          offset += 4 + length;
        }
      }, 100);
    });
  }

  send(command: string, timeoutMs = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'));

      const cmdId = 100;

      // Clear buffer of old data before sending command
      this.buffer = Buffer.alloc(0);

      // Send Command packet (type 2)
      this.socket.write(this.encodePacket(cmdId, 2, command));

      const startTime = Date.now();
      
      const interval = setInterval(() => {
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          reject(new Error(`Command execution timeout (${command})`));
          return;
        }

        const offset = 0;
        while (offset + 4 <= this.buffer.length) {
          const length = this.buffer.readInt32LE(offset);
          if (offset + 4 + length > this.buffer.length) {
            break; // Incomplete packet
          }

          const payloadEnd = offset + 4 + length - 2;
          const payload = this.buffer.toString('utf8', offset + 12, payloadEnd);

          // Resolve immediately upon receiving the response packet
          clearInterval(interval);
          this.buffer = this.buffer.slice(offset + 4 + length);
          resolve(payload);
          return;
        }
      }, 100);
    });
  }

  destroy(): void {
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // Safe catch
      }
      this.socket = null;
    }
    this.buffer = Buffer.alloc(0);
  }

  private encodePacket(id: number, type: number, payload: string): Buffer {
    const payloadBuffer = Buffer.from(payload, 'utf8');
    const packetSize = 4 + 4 + payloadBuffer.length + 2; // ID (4) + Type (4) + Payload + 2 null bytes
    const buffer = Buffer.alloc(4 + packetSize);
    
    buffer.writeInt32LE(packetSize, 0);
    buffer.writeInt32LE(id, 4);
    buffer.writeInt32LE(type, 8);
    payloadBuffer.copy(buffer, 12);
    buffer.writeUInt8(0, 12 + payloadBuffer.length);
    buffer.writeUInt8(0, 12 + payloadBuffer.length + 1);
    
    return buffer;
  }
}

export class PalworldDriver extends GameDriver {
  async getTelemetry(): Promise<DriverTelemetry> {
    const client = new PalworldRconClient(this.host, this.port, this.password);

    try {
      // Connect and authenticate
      await client.connect(5000);
      
      // Execute ShowPlayers command
      const response = await client.send('ShowPlayers', 5000);
      
      const players: string[] = [];
      if (response && response.trim()) {
        const lines = response.split(/[\r\n]+/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          // Skip header (case-insensitive check)
          if (trimmed.toLowerCase().startsWith('name,playeruid') || trimmed.toLowerCase().startsWith('name, playeruid')) {
            continue;
          }
          
          const parts = trimmed.split(',');
          if (parts.length > 0) {
            const name = parts[0].trim();
            if (name) {
              players.push(name);
            }
          }
        }
      }

      return {
        status: 'online',
        playerCount: players.length,
        players
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.toLowerCase().includes('authentication failed') || errorMessage.toLowerCase().includes('password')) {
        console.error(`[PalworldDriver] Authentication failed for RCON at ${this.host}:${this.port}: ${errorMessage}`);
        return {
          status: 'error',
          playerCount: 0,
          players: []
        };
      }
      
      console.log(`[PalworldDriver] Server at ${this.host}:${this.port} is offline or unreachable: ${errorMessage}`);
      return {
        status: 'offline',
        playerCount: 0,
        players: []
      };
    } finally {
      client.destroy();
    }
  }

  async getUnifiedTelemetry(): Promise<import('./base.js').UnifiedTelemetry> {
    const telemetry = await this.getTelemetry();
    const statusMap: Record<string, import('./base.js').ServerStatus> = {
      'online': 'ONLINE',
      'offline': 'OFFLINE',
      'restarting': 'RESTARTING',
      'error': 'ERROR'
    };

    return {
      game: 'palworld',
      status: statusMap[telemetry.status] || 'OFFLINE',
      name: 'Serveur Palworld',
      map: 'Palworld Map',
      connect: `${this.host}:${this.port}`,
      ping: telemetry.status === 'online' ? 0 : -1,
      players: {
        online: telemetry.playerCount,
        max: 32,
        list: telemetry.players
      }
    };
  }
}
