import { db } from '../../db.js';
export async function smsLogRoutes(app) {
    app.get('/', async () => {
        const { rows } = await db.query(`SELECT id, to_phone, body, direction, created_at
       FROM sms_log WHERE direction = 'outbound'
       ORDER BY created_at DESC LIMIT 50`);
        return rows;
    });
}
//# sourceMappingURL=sms-log.js.map