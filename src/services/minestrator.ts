import axios from 'axios';

export type PowerAction = 'start' | 'stop' | 'restart' | 'restart10' | 'stop10' | 'kill';

export class MinestratorClient {
  private apiKey: string;
  private serverId: string;
  private baseUrl = 'https://mine.sttr.io';

  constructor(apiKey: string, serverId: string) {
    this.apiKey = apiKey.trim();
    this.serverId = serverId.trim();
  }

  /**
   * Helper to format authorization header.
   */
  private getAuthHeader(): string {
    return `Bearer ${this.apiKey}`;
  }

  /**
   * Triggers a power action (start, stop, restart, etc.) on the MineStrator server.
   */
  async executePowerAction(action: PowerAction): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const url = `${this.baseUrl}/server/${this.serverId}/poweraction`;
    const headers = {
      'Authorization': this.getAuthHeader(),
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    const body = {
      poweraction: action
    };

    try {
      console.log(`[MinestratorClient] Sending PUT request to ${url} with action "${action}"`);
      const response = await axios.put(url, body, { headers, timeout: 10000 });
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const responseData = error.response?.data;
        const errorMessage = typeof responseData === 'object' && responseData !== null && 'message' in responseData
          ? String((responseData as { message: unknown }).message)
          : error.message;

        console.error(`[MinestratorClient] API error (${status}): ${errorMessage}`);
        return {
          success: false,
          error: `MineStrator API Error (Status ${status}): ${errorMessage}`
        };
      }

      const rawMessage = error instanceof Error ? error.message : String(error);
      console.error(`[MinestratorClient] Unexpected error: ${rawMessage}`);
      return {
        success: false,
        error: `Unexpected Error: ${rawMessage}`
      };
    }
  }

  /**
   * Retrieves the user ID (id_user) associated with the API key.
   */
  async getUserId(): Promise<string> {
    const url = `${this.baseUrl}/user`;
    const headers = {
      'Authorization': this.getAuthHeader(),
      'Accept': 'application/json'
    };

    try {
      console.log(`[MinestratorClient] Fetching user ID from ${url}`);
      const response = await axios.get(url, { headers, timeout: 10000 });
      
      const userId = response.data?.api?.data?.user?.datas?.id
        || response.data?.api?.data?.user?.id
        || response.data?.api?.data?.id;

      if (!userId) {
        throw new Error(`Failed to parse id_user from response: ${JSON.stringify(response.data).slice(0, 100)}`);
      }
      return String(userId);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorData = JSON.stringify(error.response?.data).slice(0, 500);
        throw new Error(`MineStrator API Error (Status ${error.response?.status}): ${errorData}`);
      }
      throw error;
    }
  }

  /**
   * Retrieves all servers for a specific user ID.
   */
  async listServers(userId: string): Promise<MinestratorServerInfo[]> {
    const url = `${this.baseUrl}/user/${userId}/servers`;
    const headers = {
      'Authorization': this.getAuthHeader(),
      'Accept': 'application/json'
    };

    try {
      console.log(`[MinestratorClient] Fetching servers list from ${url}`);
      const response = await axios.get(url, { headers, timeout: 10000 });
      
      const servers = response.data?.api?.data?.servers;
      if (!Array.isArray(servers)) {
        throw new Error(`Failed to parse servers list from response: ${JSON.stringify(response.data)}`);
      }
      return servers as MinestratorServerInfo[];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`MineStrator API Error (Status ${error.response?.status}): ${JSON.stringify(error.response?.data)}`);
      }
      throw error;
    }
  }

  /**
   * Retrieves server properties / config files.
   */
  async getServerProperties(): Promise<{ properties_type: string; properties: string } | null> {
    const url = `${this.baseUrl}/server/${this.serverId}/properties`;
    const headers = {
      'Authorization': this.getAuthHeader(),
      'Accept': 'application/json'
    };

    try {
      console.log(`[MinestratorClient] Fetching server properties from ${url} for server ${this.serverId}`);
      const response = await axios.get(url, { headers, timeout: 10000 });
      
      const data = response.data?.api?.data;
      if (data && typeof data.properties === 'string') {
        return {
          properties_type: String(data.properties_type),
          properties: data.properties
        };
      }
      return null;
    } catch (error) {
      console.warn('[MinestratorClient] Failed to fetch server properties:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Fetches detailed server state/metrics from MineStrator API.
   */
  async getServerData(): Promise<{
    powerState?: string;
    isOnline?: boolean;
    isStarting?: boolean;
    cpu?: number;
    ram?: number;
    name?: string;
    raw?: unknown;
  } | null> {
    const url = `${this.baseUrl}/server/${this.serverId}`;
    const headers = {
      'Authorization': this.getAuthHeader(),
      'Accept': 'application/json'
    };

    try {
      console.log(`[MinestratorClient] Fetching server status from ${url}`);
      const response = await axios.get(url, { headers, timeout: 5000 });
      const server = response.data?.api?.data?.server || response.data?.api?.data;

      if (!server) return null;

      const powerState = String(server.power_state || server.status || '').toLowerCase();
      const cpu = parseFloat(server.cpu || server.metrics?.cpu || 0);
      const ram = parseFloat(server.ram || server.metrics?.ram || 0);
      const isOnline = powerState === 'started' || powerState === 'start' || powerState === 'running' || powerState === 'online';
      const isStarting = powerState === 'starting' || powerState === 'restart' || powerState === 'restarting';

      return {
        powerState,
        isOnline,
        isStarting,
        cpu,
        ram,
        name: server.name,
        raw: response.data
      };
    } catch (error) {
      console.warn(`[MinestratorClient] Failed to fetch server status for ${this.serverId}:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}

export interface MinestratorServerInfo {
  id: number;
  name: string;
  ip: string;
  port: number;
  egg_name?: string;
  egg_icon?: string | null;
  is_disabled?: number | boolean;
  is_suspended?: number | boolean;
  is_expired?: number | boolean;
}

/**
 * Parses raw properties file content (like server.properties or PalWorldSettings.ini)
 * to extract RCON port and password using regular expressions.
 */
export function parseRconFromProperties(properties: string): { rconPort?: number; rconPassword?: string } {
  const config: { rconPort?: number; rconPassword?: string } = {};

  // 1. Try Minecraft rcon.port & rcon.password
  const mcPortMatch = properties.match(/rcon\.port\s*=\s*([0-9]+)/i);
  if (mcPortMatch) {
    config.rconPort = parseInt(mcPortMatch[1], 10);
  }

  const mcPwdMatch = properties.match(/rcon\.password\s*=\s*([^\r\n]+)/i);
  if (mcPwdMatch) {
    config.rconPassword = mcPwdMatch[1].trim();
  }

  // 2. Try Palworld RCONPort & AdminPassword
  const palPortMatch = properties.match(/RCONPort\s*=\s*([0-9]+)/i);
  if (palPortMatch) {
    config.rconPort = parseInt(palPortMatch[1], 10);
  }

  const palPwdMatch = properties.match(/AdminPassword\s*=\s*"([^"]*)"/i) 
    || properties.match(/AdminPassword\s*=\s*([^,)]+)/i);
  if (palPwdMatch) {
    config.rconPassword = palPwdMatch[1].trim();
  }

  return config;
}

