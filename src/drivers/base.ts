export interface DriverTelemetry {
  status: 'online' | 'offline' | 'error';
  playerCount: number;
  players: string[];
}

export abstract class GameDriver {
  protected host: string;
  protected port: number;
  protected password: string;

  constructor(host: string, port: number, password: string) {
    this.host = host;
    this.port = port;
    this.password = password;
  }

  /**
   * Fetches telemetry from the game server.
   * This method must handle connection timeouts and server offline states gracefully.
   */
  abstract getTelemetry(): Promise<DriverTelemetry>;
}
