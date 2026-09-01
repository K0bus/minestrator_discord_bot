import { Client, GatewayIntentBits } from 'discord.js';
import * as setupCommand from './commands/setup.js';
import * as addServerCommand from './commands/addServer.js';
import * as manageTokensCommand from './commands/manageTokens.js';

/**
 * Initializes the discord.js client with required gateway intents.
 */
export function createDiscordClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds
    ]
  });

  return client;
}

/**
 * List of Slash Command schemas to register with Discord.
 */
export const commands = [
  setupCommand.data,
  addServerCommand.data,
  manageTokensCommand.data
];
