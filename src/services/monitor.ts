import { Client, TextChannel, DiscordAPIError } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { GameDriverFactory } from '../drivers/factory.js';
import { MinestratorClient } from './minestrator.js';
import { decrypt } from './encryption.js';
import { createServerEmbed, createControlButtons } from './embeds.js';

export class MonitorService {
  private client: Client;
  private prisma: PrismaClient;
  private intervalId: NodeJS.Timeout | null = null;
  private isScanning = false;
  private lastKnownStatuses = new Map<string, string>();
  private lastKnownPlayers = new Map<string, string[]>();

  constructor(client: Client, prisma: PrismaClient) {
    this.client = client;
    this.prisma = prisma;
  }

  /**
   * Starts the global scan loop.
   * @param intervalMs Interval between scans (default: 5000ms / 5 seconds)
   */
  start(intervalMs = 5000): void {
    if (this.intervalId) {
      console.warn('[MonitorService] Monitor is already running.');
      return;
    }

    console.log(`[MonitorService] Starting global monitor loop with interval of ${intervalMs}ms...`);
    // Run immediately on start, then at intervals
    this.scanServers().catch(err => console.error('[MonitorService] Initial scan failed:', err));
    this.intervalId = setInterval(() => this.scanServers(), intervalMs);
  }

  /**
   * Stops the global scan loop.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[MonitorService] Monitor loop stopped.');
    }
  }

  /**
   * Scans all servers in the database, queries telemetry, and updates embeds/auto-stop timers.
   */
  async scanServers(): Promise<void> {
    if (this.isScanning) {
      console.log('[MonitorService] Scan already in progress, skipping.');
      return;
    }

    this.isScanning = true;
    try {
      const servers = await this.prisma.server.findMany({
        include: {
          token: true
        }
      });

      for (const server of servers) {
        try {
          const decryptedKey = decrypt(server.token.encryptedKey);
          const minestrator = new MinestratorClient(decryptedKey, server.minestratorServerId);

          // Initialize appropriate game driver via GameDriverFactory
          const driver = GameDriverFactory.createDriver(server, minestrator);

          // Fetch server telemetry
          const telemetry = await driver.getTelemetry();
          
          // 1. Announce status changes
          const hasPrevStatus = this.lastKnownStatuses.has(server.id);
          const oldStatus = this.lastKnownStatuses.get(server.id);
          this.lastKnownStatuses.set(server.id, telemetry.status);

          if (hasPrevStatus && oldStatus !== telemetry.status && server.logChannelId) {
            try {
              const logChannel = await this.client.channels.fetch(server.logChannelId);
              if (logChannel && 'send' in logChannel && typeof logChannel.send === 'function') {
                let statusEmoji = '🔴';
                let statusWord = 'HORS LIGNE';

                if (telemetry.status === 'online') {
                  statusEmoji = '🟢';
                  statusWord = 'EN LIGNE';
                } else if (telemetry.status === 'restarting') {
                  statusEmoji = '🔄';
                  statusWord = 'EN REDÉMARRAGE';
                } else if (telemetry.status === 'error') {
                  statusEmoji = '⚠️';
                  statusWord = 'EN ERREUR';
                }

                await logChannel.send({
                  content: `${statusEmoji} Le serveur **${server.name}** est maintenant **${statusWord}**.`
                });
              }
            } catch (announceErr) {
              console.warn(`[MonitorService] Failed to send status change announcement to channel ${server.logChannelId}:`, announceErr);
            }
          }

          // 2. Announce player joins / leaves
          const hasPrevPlayers = this.lastKnownPlayers.has(server.id);
          const oldPlayers = this.lastKnownPlayers.get(server.id) || [];
          const currentPlayers = telemetry.players || [];
          this.lastKnownPlayers.set(server.id, currentPlayers);

          if (hasPrevPlayers && server.logChannelId) {
            const joined = currentPlayers.filter(p => !oldPlayers.includes(p));
            const left = oldPlayers.filter(p => !currentPlayers.includes(p));

            if (joined.length > 0 || left.length > 0) {
              try {
                const logChannel = await this.client.channels.fetch(server.logChannelId);
                if (logChannel && 'send' in logChannel && typeof logChannel.send === 'function') {
                  for (const player of joined) {
                    await logChannel.send({
                      content: `📥 **${player}** s'est connecté au serveur **${server.name}**.`
                    });
                  }
                  for (const player of left) {
                    await logChannel.send({
                      content: `📤 **${player}** s'est déconnecté du serveur **${server.name}**.`
                    });
                  }
                }
              } catch (announceErr) {
                console.warn(`[MonitorService] Failed to send player logs to channel ${server.logChannelId}:`, announceErr);
              }
            }
          }
          
          let lastActive = new Date(server.lastActiveAt);
          const now = new Date();

          if (telemetry.status === 'online') {
            if (telemetry.playerCount > 0) {
              // Reset the idle timer as players are online
              lastActive = now;
              await this.prisma.server.update({
                where: { id: server.id },
                data: { lastActiveAt: lastActive }
              });
            } else {
              // Server is online but has 0 players
              if (server.autoStopEnabled) {
                const elapsedMs = now.getTime() - lastActive.getTime();
                const elapsedMin = elapsedMs / 1000 / 60;

                if (elapsedMin >= server.autoStopTimeout) {
                  console.log(`[MonitorService] Server "${server.name}" has been empty for ${elapsedMin.toFixed(1)} minutes (Threshold: ${server.autoStopTimeout} min). Auto-stopping...`);
                  
                  const result = await minestrator.executePowerAction('stop');
                  if (result.success) {
                    console.log(`[MonitorService] Server "${server.name}" stopped successfully.`);
                    // Update state to prevent instant re-trigger
                    lastActive = now;
                    await this.prisma.server.update({
                      where: { id: server.id },
                      data: { lastActiveAt: lastActive }
                    });
                    // Set status to offline manually for the immediate embed update
                    telemetry.status = 'offline';
                  } else {
                    console.error(`[MonitorService] Failed to auto-stop server "${server.name}": ${result.error}`);
                  }
                }
              }
            }
          } else {
            // Server is offline/error/restarting: reset idle timer so it starts fresh when server boots up
            if (now.getTime() - lastActive.getTime() > 120000) { // Limit database writes
              lastActive = now;
              await this.prisma.server.update({
                where: { id: server.id },
                data: { lastActiveAt: lastActive }
              });
            }
          }

          // Update Discord embed if config exists
          if (server.discordChannelId && server.discordMessageId) {
            try {
              const channel = await this.client.channels.fetch(server.discordChannelId);
              if (channel instanceof TextChannel) {
                const message = await channel.messages.fetch(server.discordMessageId);
                if (message) {
                  const embed = createServerEmbed(
                    server.name,
                    server.gameType,
                    server.host,
                    server.port,
                    telemetry,
                    {
                      enabled: server.autoStopEnabled,
                      timeout: server.autoStopTimeout,
                      lastActiveAt: lastActive
                    },
                    server.eggIcon
                  );
                  const buttons = createControlButtons(telemetry.status);

                  await message.edit({
                    embeds: [embed],
                    components: buttons
                  });
                }
              }
            } catch (discordError) {
              const isNotFound = discordError instanceof DiscordAPIError && 
                (discordError.code === 10008 || discordError.code === 10003);

              if (isNotFound) {
                console.log(`[MonitorService] Panel Discord pour le serveur "${server.name}" (${server.id}) introuvable ou supprimé. Suppression du serveur de la base de données...`);
                try {
                  await this.prisma.server.delete({
                    where: { id: server.id }
                  });
                  console.log(`[MonitorService] Serveur "${server.name}" retiré de la base de données.`);
                } catch (dbErr) {
                  console.error(`[MonitorService] Échec de la suppression du serveur "${server.name}" de la base de données :`, dbErr);
                }
              } else {
                console.warn(`[MonitorService] Could not update Discord embed for server "${server.name}" (${server.id}):`, discordError instanceof Error ? discordError.message : String(discordError));
              }
            }
          }

        } catch (serverError) {
          console.error(`[MonitorService] Error monitoring server "${server.name}":`, serverError);
        }
      }
    } catch (dbError) {
      console.error('[MonitorService] Database query failed in monitor loop:', dbError);
    } finally {
      this.isScanning = false;
    }
  }
}
