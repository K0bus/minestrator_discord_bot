import { GameDriver, DriverTelemetry, UnifiedTelemetry, ServerStatus } from './base.js';
import { MinestratorClient } from '../services/minestrator.js';

export class MinestratorDriver extends GameDriver {
  private gameType: string;
  private minestratorClient?: MinestratorClient;

  constructor(
    host: string,
    port: number,
    gameType: string,
    minestratorClient?: MinestratorClient
  ) {
    super(host, port, 0, '');
    this.gameType = gameType;
    this.minestratorClient = minestratorClient;
  }

  async getUnifiedTelemetry(): Promise<UnifiedTelemetry> {
    const connectAddress = `${this.host}:${this.port}`;

    if (!this.minestratorClient) {
      return {
        game: this.gameType.toLowerCase(),
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
          error: 'Minestrator API client not configured'
        }
      };
    }

    try {
      const startTime = performance.now();
      const serverData = await this.minestratorClient.getServerData();
      const ping = Math.round(performance.now() - startTime);

      if (!serverData) {
        return {
          game: this.gameType.toLowerCase(),
          status: 'ERROR',
          name: `Serveur ${this.gameType}`,
          map: 'Inconnu',
          connect: connectAddress,
          ping: -1,
          players: {
            online: 0,
            max: 0,
            list: []
          },
          raw_metrics: {
            apiDriven: true,
            error: 'Aucune donnée reçue depuis l\'API MineStrator'
          }
        };
      }

      let status: ServerStatus = 'OFFLINE';

      if (serverData.isStarting) {
        status = 'RESTARTING';
      } else if (serverData.isOnline) {
        status = 'ONLINE';
      } else if (serverData.isStopping) {
        status = 'RESTARTING';
      } else {
        status = 'OFFLINE';
      }

      const onlinePlayers = serverData.playersCount ?? 0;
      const maxPlayers = serverData.maxPlayers ?? 0;

      return {
        game: this.gameType.toLowerCase(),
        status,
        name: serverData.name || `Serveur ${this.gameType}`,
        map: 'N/A',
        connect: connectAddress,
        ping: serverData.isOnline ? ping : -1,
        players: {
          online: onlinePlayers,
          max: maxPlayers,
          list: []
        },
        raw_metrics: {
          apiDriven: true,
          powerState: serverData.powerState,
          cpu: serverData.cpu,
          ram: serverData.ram,
          disk: serverData.disk
        }
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[MinestratorDriver] Error querying API for ${this.gameType}:`, errorMsg);

      return {
        game: this.gameType.toLowerCase(),
        status: 'ERROR',
        name: `Serveur ${this.gameType}`,
        map: 'Erreur',
        connect: connectAddress,
        ping: -1,
        players: {
          online: 0,
          max: 0,
          list: []
        },
        raw_metrics: {
          apiDriven: true,
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
