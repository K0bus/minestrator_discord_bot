import { GameDriver } from './base.js';
import { HybridGameDriver } from './hybrid.js';
import { MinestratorClient } from '../services/minestrator.js';

export class GameDriverFactory {
  /**
   * Resolves the default query port based on game type if not explicitly set.
   */
  static getEffectiveQueryPort(gameType: string, gamePort: number, queryPort?: number | null): number {
    if (queryPort && queryPort > 0) {
      return queryPort;
    }

    const type = gameType.toUpperCase();
    switch (type) {
      case 'ARK':
      case 'ARKSE':
      case 'ARKSA':
      case 'VALHEIM':
        return gamePort + 1;
      case 'MINECRAFT':
      case 'PALWORLD':
      case 'SATISFACTORY':
      default:
        return gamePort;
    }
  }

  /**
   * Creates a GameDriver instance tailored for the specified game server.
   */
  static createDriver(
    server: {
      gameType: string;
      host: string;
      port: number;
      queryPort?: number | null;
      rconPort: number;
      password: string;
    },
    minestratorClient?: MinestratorClient
  ): GameDriver {
    const effectiveQueryPort = this.getEffectiveQueryPort(server.gameType, server.port, server.queryPort);

    return new HybridGameDriver(
      server.host,
      server.port,
      effectiveQueryPort,
      server.gameType,
      server.password,
      minestratorClient
    );
  }
}
