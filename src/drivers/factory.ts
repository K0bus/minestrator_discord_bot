import { GameDriver } from './base.js';
import { HybridGameDriver } from './hybrid.js';
import { MinestratorDriver } from './minestrator.js';
import { MinestratorClient } from '../services/minestrator.js';

export class GameDriverFactory {
  /**
   * List of games known to support direct UDP query (GameDig / A2S).
   */
  private static readonly QUERY_SUPPORTED_GAMES = new Set([
    'MINECRAFT',
    'PALWORLD',
    'ARK',
    'ARKSE',
    'ARKSA',
    'SATISFACTORY',
    'RUST',
    'CONAN'
  ]);

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
        return gamePort + 1;
      case 'MINECRAFT':
      case 'PALWORLD':
      case 'SATISFACTORY':
      case 'VALHEIM':
      default:
        return gamePort;
    }
  }

  /**
   * Checks if a game should be queried directly via MineStrator API instead of UDP.
   */
  static isApiOnlyGame(gameType: string): boolean {
    const type = gameType.toUpperCase();
    if (type === 'VALHEIM' || type === 'OTHER' || type === 'CUSTOM' || type === 'MINESTRATOR' || type === 'GENERIC') {
      return true;
    }
    return !this.QUERY_SUPPORTED_GAMES.has(type);
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
    // If the game is VALHEIM or not natively supported for UDP query, use the Minestrator HTTP API Driver directly
    if (this.isApiOnlyGame(server.gameType)) {
      return new MinestratorDriver(
        server.host,
        server.port,
        server.gameType,
        minestratorClient
      );
    }

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
