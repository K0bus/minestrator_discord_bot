declare module 'gamedig' {
  export interface QueryOptions {
    type: string;
    host: string;
    port?: number;
    maxAttempts?: number;
    socketTimeout?: number;
    givenPortOnly?: boolean;
    listenUdpPort?: number;
  }

  export interface Player {
    name?: string;
    raw?: {
      name?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  export interface QueryResponse {
    name?: string;
    map?: string;
    password?: boolean;
    raw?: unknown;
    maxplayers?: number;
    numplayers?: number;
    players?: Player[];
    bots?: Player[];
    connect?: string;
    ping?: number;
  }

  export class GameDig {
    static query(options: QueryOptions): Promise<QueryResponse>;
  }

  export function query(options: QueryOptions): Promise<QueryResponse>;
}
