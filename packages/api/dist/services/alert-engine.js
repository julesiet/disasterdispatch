import { db } from '../db.js';
import { zoneEvents } from './firms-sync.js';
import { pushHeatmapUpdate } from '../routes/heatmap.js';
const APPROACHING_RADIUS = Number(process.env['APPROACHING_RADIUS_M'] ?? 10000);
const IMMINENT_RADIUS = Number(process.env['IMMINENT_RADIUS_M'] ?? 2000);
function approachingMessage(name, distanceM) {
    const km = (distanceM / 1000).toFixed(1);
    return (`ALERT: ${name}, a wildfire is approaching your area (${km}km away). ` +
        `You may be at risk. Reply YES to request free transport out of the area.`);
}
function imminentMessage(name) {
    return (`URGENT: ${name}, a wildfire is at or near your location. ` +
        `EVACUATE IMMEDIATELY. Reply YES for priority transport pickup.`);
}
export function startAlertEngine(sms) {
    zoneEvents.on('zone:changed', (payload) => {
        // Zone geometry and active state are part of the public heatmap even when
        // this change does not result in any resident alerts.
        pushHeatmapUpdate().catch(() => null);
        if (!payload.active)
            return; // ignore soft-deletes
        processZone(payload, sms).catch((err) => console.error('[alert-engine] Error processing zone:', err));
    });
    console.log('[alert-engine] Listening for zone changes');
}
async function processZone(payload, sms) {
    const radius = payload.severity === 'imminent' ? IMMINENT_RADIUS : APPROACHING_RADIUS;
    // Fetch the zone geometry
    const { rows: zoneRows } = await db.query(`SELECT zone FROM danger_zones WHERE id = $1 AND active = true`, [payload.id]);
    if (zoneRows.length === 0)
        return;
    // Find residents within radius who haven't already been alerted for this zone
    const { rows: residents } = await db.query(`SELECT r.id, r.name, r.phone,
            ST_Distance(r.location, dz.zone) AS distance_m
     FROM residents r, danger_zones dz
     WHERE dz.id = $1
       AND ST_DWithin(r.location, dz.zone, $2)
       AND NOT EXISTS (
         SELECT 1 FROM alerts a
         WHERE a.resident_id = r.id AND a.danger_zone_id = $1
       )`, [payload.id, radius]);
    for (const resident of residents) {
        const tier = payload.severity;
        const body = tier === 'imminent'
            ? imminentMessage(resident.name)
            : approachingMessage(resident.name, resident.distance_m);
        await sms.send(resident.phone, body);
        await db.query(`INSERT INTO alerts (resident_id, danger_zone_id, tier)
       VALUES ($1, $2, $3)
       ON CONFLICT (resident_id, danger_zone_id) DO NOTHING`, [resident.id, payload.id, tier]);
    }
    if (residents.length > 0) {
        console.log(`[alert-engine] Sent ${residents.length} ${payload.severity} alerts for zone ${payload.id}`);
        pushHeatmapUpdate().catch(() => null);
    }
}
//# sourceMappingURL=alert-engine.js.map