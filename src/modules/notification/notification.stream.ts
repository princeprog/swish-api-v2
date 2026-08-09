import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { createDatabasePoolConfig } from '../../database/database.config';

type StreamListener = () => void;

@Injectable()
export class NotificationStreamService
  implements OnModuleInit, OnModuleDestroy
{
  private client?: Client;
  private readonly listeners = new Map<string, Set<StreamListener>>();

  async onModuleInit(): Promise<void> {
    if (process.env.NOTIFICATION_STREAM_ENABLED === 'false') {
      return;
    }

    const client = new Client(createDatabasePoolConfig(process.env));
    try {
      await client.connect();
      await client.query('LISTEN notification_changed');
      client.on('notification', (message) => {
        if (!message.payload) {
          return;
        }

        try {
          const payload = JSON.parse(message.payload) as { userId?: unknown };
          if (typeof payload.userId === 'string') {
            this.publishLocal(payload.userId);
          }
        } catch {
          // Invalid signals are ignored; clients refetch on reconnect.
        }
      });
      this.client = client;
    } catch {
      await client.end().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.end();
    this.client = undefined;
  }

  subscribe(userId: string, listener: StreamListener): () => void {
    const userListeners = this.listeners.get(userId) ?? new Set<StreamListener>();
    userListeners.add(listener);
    this.listeners.set(userId, userListeners);

    return () => {
      userListeners.delete(listener);
      if (userListeners.size === 0) {
        this.listeners.delete(userId);
      }
    };
  }

  publishLocal(userId: string): void {
    for (const listener of this.listeners.get(userId) ?? []) {
      listener();
    }
  }
}
