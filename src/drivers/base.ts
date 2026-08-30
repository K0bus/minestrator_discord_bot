export type ServerStatus = 'ONLINE' | 'OFFLINE' | 'RESTARTING' | 'ERROR';

export interface UnifiedPlayers {
  online: number;
  max: number;
  list: string[];
}

export interface UnifiedTelemetry {
  game: string;
  status: ServerStatus;
  name: string;
  map: string;
  connect: string;
  ping: number;
  players: UnifiedPlayers;
  raw_metrics?: Record<string, unknown>;
}

export interface DriverTelemetry {
  status: 'online' | 'offline' | 'error' | 'restarting';
  playerCount: number;
  players: string[];
  unified?: UnifiedTelemetry;
}

export abstract class GameDriver {
  protected host: string;
  protected port: number;
  protected queryPort: number;
  protected password: string;

  constructor(host: string, port: number, queryPort: number = 0, password: string = '') {
    this.host = host;
    this.port = port;
    this.queryPort = queryPort || port;
    this.password = password;
  }

  /**
   * Fetches telemetry from the game server in standard format.
   */
  abstract getTelemetry(): Promise<DriverTelemetry>;

  /**
   * Fetches telemetry normalized in the UnifiedTelemetry format.
   */
  abstract getUnifiedTelemetry(): Promise<UnifiedTelemetry>;
}
