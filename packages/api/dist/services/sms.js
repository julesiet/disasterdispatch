import { db } from '../db.js';
export class MockSmsService {
    async send(to, body) {
        console.log(`[SMS -> ${to}] ${body}`);
        await db.query(`INSERT INTO sms_log (to_phone, body, direction) VALUES ($1, $2, 'outbound')`, [
            to,
            body,
        ]);
    }
}
//# sourceMappingURL=sms.js.map