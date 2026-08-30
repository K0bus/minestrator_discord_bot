import { GameDig } from 'gamedig';
import { GameDriver, DriverTelemetry, UnifiedTelemetry } from './base.js';

export class GameDigDriver extends GameDriver {
  private gameType: string;

  constructor(host: string, port: number, queryPort: number, gameType: string, password = '') {
    super(host, port, queryPort, password);
    this.gameType = gameType;
  }

  /**
   * Maps internal gameType to GameDig query type.
   */
  private getGamedigType(): string {
    const type = this.gameType.toLowerCase();
    switch (type) {
      case 'ark':
      case 'arkse':
      case 'ase':
        return 'ase';
      case 'arksa':
      case 'asa':
        return 'asa';
      case 'valheim':
        return 'valheim';
      case 'minecraft':
        return 'minecraft';
      case 'palworld':
        return 'palworld';
      case 'satisfactory':
        return 'satisfactory';
      default:
        return type;
    }
  }

  async getUnifiedTelemetry(): Promise<UnifiedTelemetry> {
    const gamedigType = this.getGamedigType();
    const connectAddress = `${this.host}:${this.port}`;

    try {
      const response = await GameDig.query({
        type: gamedigType,
        host: this.host,
        port: this.queryPort,
        maxAttempts: 2,
        socketTimeout: 3000
      });

      // Filter empty, anonymous or invalid player names
      const validPlayers: string[] = [];
      if (Array.isArray(response.players)) {
        for (const player of response.players) {
          let name = '';
          if (typeof player === 'string') {
            name = player;
          } else if (player && typeof player === 'object') {
            name = player.name || (player as { raw?: { name?: string } }).raw?.name || '';
          }

          const trimmed = name.trim();
          if (
            trimmed !== '' &&
            trimmed.toLowerCase() !== 'connecting...' &&
            trimmed !== '[]' &&
            trimmed.toLowerCase() !== 'unknown'
          ) {
            validPlayers.push(trimmed);
          }
        }
      }

      const onlineCount = response.numplayers ?? response.players?.length ?? validPlayers.length;
      const maxCount = response.maxplayers ?? 0;

      return {
        game: gamedigType,
        status: 'ONLINE',
        name: response.name || `Serveur ${this.gameType}`,
        map: response.map || 'Inconnue',
        connect: connectAddress,
        ping: response.ping ?? 0,
        players: {
          online: onlineCount,
          max: maxCount,
          list: validPlayers
        },
        raw_metrics: {
          ping: response.ping,
          raw: response.raw
        }
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`[GameDigDriver] Direct UDP query failed for ${this.gameType} on ${this.host}:${this.queryPort}: ${errorMsg}`);

      return {
        game: gamedigType,
        status: 'OFFLINE',
        name: `Serveur ${this.gameType}`,
        map: 'N/A',
        connect: connectAddress,
        ping: -1,
        players: {
          online: 0,
          max: 0,
          list: []
        },
        raw_metrics: {
          error: errorMsg
        }
      };
    }
  }

  async getTelemetry(): Promise<DriverTelemetry> {
    const unified = await this.getUnifiedTelemetry();
    const statusMap: Record<string, 'online' | 'offline' | 'error' | 'restarting'> = {
      'ONLINE': 'online',
      'OFFLINE': 'offline',
      'RESTARTING': 'restarting',
      'ERROR': 'error'
    };

    return {
      status: statusMap[unified.status] || 'offline',
      playerCount: unified.players.online,
      players: unified.players.list,
      unified
    };
  }
}
