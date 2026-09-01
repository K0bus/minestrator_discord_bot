import { GameDriver, DriverTelemetry, UnifiedTelemetry } from './base.js';
import { GameDigDriver } from './gamedig.js';
import { MinestratorClient } from '../services/minestrator.js';

export class HybridGameDriver extends GameDriver {
  private gameType: string;
  private minestratorClient?: MinestratorClient;
  private gamedigDriver: GameDigDriver;

  constructor(
    host: string,
    port: number,
    queryPort: number,
    gameType: string,
    password = '',
    minestratorClient?: MinestratorClient
  ) {
    super(host, port, queryPort, password);
    this.gameType = gameType;
    this.minestratorClient = minestratorClient;
    this.gamedigDriver = new GameDigDriver(host, port, queryPort, gameType, password);
  }

  async getUnifiedTelemetry(): Promise<UnifiedTelemetry> {
    // 1. Attempt 1: Direct UDP Query via GameDig
    const directResult = await this.gamedigDriver.getUnifiedTelemetry();

    if (directResult.status === 'ONLINE') {
      return directResult;
    }

    // 2. Attempt 2: Fallback to Minestrator HTTP API if direct UDP query failed
    if (this.minestratorClient) {
      console.log(`[HybridGameDriver] Direct UDP query returned OFFLINE for ${this.gameType}. Invoking Minestrator API fallback...`);
      const apiData = await this.minestratorClient.getServerData();

      if (apiData) {
        const onlinePlayers = apiData.playersCount ?? 0;
        const maxPlayers = apiData.maxPlayers ?? 0;

        if (apiData.isStarting || apiData.isStopping) {
          return {
            game: directResult.game,
            status: 'RESTARTING',
            name: apiData.name || directResult.name,
            map: 'N/A',
            connect: `${this.host}:${this.port}`,
            ping: -1,
            players: {
              online: onlinePlayers,
              max: maxPlayers,
              list: []
            },
            raw_metrics: {
              fallback: true,
              powerState: apiData.powerState,
              cpu: apiData.cpu,
              ram: apiData.ram,
              disk: apiData.disk
            }
          };
        }

        if (apiData.isOnline) {
          return {
            game: directResult.game,
            status: 'ONLINE',
            name: apiData.name || directResult.name,
            map: 'N/A',
            connect: `${this.host}:${this.port}`,
            ping: 0,
            players: {
              online: onlinePlayers,
              max: maxPlayers,
              list: []
            },
            raw_metrics: {
              fallback: true,
              powerState: apiData.powerState,
              cpu: apiData.cpu,
              ram: apiData.ram,
              disk: apiData.disk
            }
          };
        }
      }
    }

    return directResult;
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
