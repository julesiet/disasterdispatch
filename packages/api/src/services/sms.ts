import { db } from '../db.js';

export interface SmsService {
  send(to: string, body: string): Promise<void>;
}

export class MockSmsService implements SmsService {
  async send(to: string, body: string): Promise<void> {
    console.log(`[SMS -> ${to}] ${body}`);
    await db.query(`INSERT INTO sms_log (to_phone, body, direction) VALUES ($1, $2, 'outbound')`, [
      to,
      body,
    ]);
  }
}
