import { db } from '../db.js';
import { pushHeatmapUpdate } from '../routes/heatmap.js';
const DEFAULT_DRIVER_RADIUS_M = 25 * 1609.344;
export async function startDispatchEngine(sms, transportRequestId, excludeDriverId) {
    // Fetch the transport request and the resident's location
    const { rows: trRows } = await db.query(`SELECT tr.id, tr.resident_id, tr.status, tr.priority,
            r.name AS resident_name, r.phone AS resident_phone,
            ST_AsText(r.location::geometry) AS resident_location
     FROM transport_requests tr
     JOIN residents r ON r.id = tr.resident_id
     WHERE tr.id = $1`, [transportRequestId]);
    if (trRows.length === 0 || trRows[0].status !== 'waiting')
        return;
    const tr = trRows[0];
    // Find nearest available driver, excluding any who just declined
    const configuredRadius = Number(process.env['DRIVER_REQUEST_RADIUS_M'] ?? DEFAULT_DRIVER_RADIUS_M);
    const radiusM = Number.isFinite(configuredRadius) && configuredRadius > 0
        ? configuredRadius
        : DEFAULT_DRIVER_RADIUS_M;
    const excludeClause = excludeDriverId ? `AND d.id != $3` : '';
    const params = [tr.resident_id, radiusM];
    if (excludeDriverId)
        params.push(excludeDriverId);
    const { rows: driverRows } = await db.query(`SELECT d.id, d.name, d.phone
     FROM drivers d, residents r
     WHERE r.id = $1
       AND d.available = true
       AND ST_DWithin(d.service_area, r.location, $2)
       ${excludeClause}
     ORDER BY ST_Distance(d.service_area, r.location) ASC
     LIMIT 1`, params);
    if (driverRows.length === 0) {
        console.log(`[dispatch] No available drivers for request ${transportRequestId}`);
        return;
    }
    const driver = driverRows[0];
    // Record the dispatch
    await db.query(`INSERT INTO driver_dispatches (driver_id, transport_request_id) VALUES ($1, $2)`, [driver.id, transportRequestId]);
    // Extract coords from WKT e.g. "POINT(-118.24 34.05)"
    const match = tr.resident_location.match(/POINT\(([^ ]+) ([^ )]+)\)/);
    const coords = match ? `${match[2]}, ${match[1]}` : 'unknown location';
    const message = `DISPATCH: ${tr.resident_name} needs pickup at ${coords}. ` +
        `Priority ${tr.priority === 1 ? 'HIGH (imminent danger)' : 'NORMAL'}. ` +
        `Reply ACCEPT or DECLINE.`;
    await sms.send(driver.phone, message);
    console.log(`[dispatch] Dispatched driver ${driver.name} for request ${transportRequestId}`);
    pushHeatmapUpdate().catch(() => null);
}
//# sourceMappingURL=dispatch-engine.js.map