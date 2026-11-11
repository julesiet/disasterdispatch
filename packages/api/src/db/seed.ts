import pg from 'pg';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

const root = process.env['npm_config_local_prefix'] ?? resolve(process.cwd(), '..', '..');
dotenv.config({ path: resolve(root, '.env') });

const { Client } = pg;

// Sample area: greater Los Angeles basin
// Residents spread across a ~30km radius around downtown LA (34.05, -118.24)
const residents = [
  { name: 'Alice Moreno', phone: '+15550001001', lat: 34.052, lng: -118.243 }, // downtown LA
  { name: 'Ben Nakamura', phone: '+15550001002', lat: 34.019, lng: -118.491 }, // Santa Monica
  { name: 'Carla Reyes', phone: '+15550001003', lat: 34.148, lng: -118.144 }, // Pasadena
  { name: 'David Chen', phone: '+15550001004', lat: 33.942, lng: -118.408 }, // Inglewood
  { name: 'Eva Kowalski', phone: '+15550001005', lat: 34.063, lng: -118.356 }, // West Hollywood
  { name: 'Frank Okafor', phone: '+15550001006', lat: 34.183, lng: -118.307 }, // Burbank
  { name: 'Grace Liu', phone: '+15550001007', lat: 33.999, lng: -118.163 }, // Compton
  { name: 'Hiro Tanaka', phone: '+15550001008', lat: 34.093, lng: -117.96 }, // Pomona
  { name: 'Iris Patel', phone: '+15550001009', lat: 34.02, lng: -118.286 }, // Culver City area
  { name: 'James Osei', phone: '+15550001010', lat: 34.136, lng: -118.251 }, // Glendale
];

// Drivers spread across the same area
const drivers = [
  { name: 'Driver Maya Santos', phone: '+15550002001', lat: 34.04, lng: -118.26 }, // central LA
  { name: 'Driver Tom Briggs', phone: '+15550002002', lat: 34.025, lng: -118.45 }, // near Santa Monica
  { name: 'Driver Zoe Fischer', phone: '+15550002003', lat: 34.16, lng: -118.13 }, // Pasadena area
  { name: 'Driver Ray Nguyen', phone: '+15550002004', lat: 33.955, lng: -118.39 }, // Inglewood area
  { name: 'Driver Sam Park', phone: '+15550002005', lat: 34.17, lng: -118.32 }, // Burbank area
];

async function seed() {
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) throw new Error('DATABASE_URL is not set');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // Clear existing seed data
    await client.query(`DELETE FROM drivers WHERE phone LIKE '+155500020%'`);
    await client.query(`DELETE FROM residents WHERE phone LIKE '+155500010%'`);

    // Insert residents
    for (const r of residents) {
      await client.query(
        `INSERT INTO residents (name, phone, location)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)
         ON CONFLICT (phone) DO NOTHING`,
        [r.name, r.phone, r.lng, r.lat],
      );
    }

    // Insert drivers
    for (const d of drivers) {
      await client.query(
        `INSERT INTO drivers (name, phone, service_area)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)
         ON CONFLICT (phone) DO NOTHING`,
        [d.name, d.phone, d.lng, d.lat],
      );
    }

    console.log(`✅  Seeded ${residents.length} residents and ${drivers.length} drivers`);
    console.log('    Verify with:');
    console.log('    SELECT name, phone, ST_AsText(location::geometry) FROM residents;');
    console.log('    SELECT name, phone, ST_AsText(service_area::geometry) FROM drivers;');
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
