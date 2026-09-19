import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SOURCE_URL = 'https://bit-database.robloxbot.us.kg/api/citizens/all';
const BIT_MARKER = '[BIT_DB_IMPORT]';

function loadEnv() {
  const env = {};
  try {
    const raw = readFileSync('.env', 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  } catch {
    // fall through to process.env
  }
  return { ...env, ...process.env };
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizePlate(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text && text !== '-' ? text : '-';
}

function stripBitBlock(notes) {
  const text = String(notes ?? '').trim();
  if (!text.includes(BIT_MARKER)) return text;
  return text
    .split(/\r?\n\r?\n/)
    .filter((block) => !block.includes(BIT_MARKER))
    .join('\n\n')
    .trim();
}

function mergeBitBlock(notes, lines) {
  const base = stripBitBlock(notes);
  const bitBlock = [BIT_MARKER, ...lines].join('\n');
  return [base, bitBlock].filter(Boolean).join('\n\n');
}

function mapVehicle(rawType) {
  const source = String(rawType ?? '').trim();
  const compact = source.replace(/\s+/g, '');
  let vehicle_type = 'other';
  let vehicle_category = 'personal';

  if (/มอเตอร์ไซค์|จักรยานยนต์|motor/i.test(compact)) vehicle_type = 'motorcycle';
  else if (/กระบะ|pickup/i.test(compact)) vehicle_type = 'pickup';
  else if (/บรรทุก|truck/i.test(compact)) vehicle_type = 'truck';
  else if (/ตู้|van/i.test(compact)) vehicle_type = 'van';
  else if (/suv/i.test(compact)) vehicle_type = 'suv';
  else if (/เก๋ง|sedan/i.test(compact)) vehicle_type = 'sedan';

  if (/ขนส่ง|transport/i.test(compact)) vehicle_category = 'transport';
  else if (/สาธารณะ|public/i.test(compact)) vehicle_category = 'public';

  return { vehicle_type, vehicle_category };
}

function licenseStatusLabel(value) {
  return String(value ?? '').trim() || 'ไม่มีข้อมูล';
}

async function fetchAll(supabase, table, columns = '*') {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(table).select(columns).range(from, to);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function insertChunks(supabase, table, rows, apply) {
  if (!rows.length || !apply) return;
  const size = 100;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`${table} insert: ${error.message}`);
  }
}

async function updateRows(supabase, table, rows, apply) {
  if (!rows.length || !apply) return;
  for (const { id, patch } of rows) {
    const { error } = await supabase.from(table).update(patch).eq('id', id);
    if (error) throw new Error(`${table} update ${id}: ${error.message}`);
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const env = loadEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
  }

  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`BIT API ${res.status}: ${res.statusText}`);
  const payload = await res.json();
  const citizens = Array.isArray(payload.citizens) ? payload.citizens : [];
  const importedAt = new Date().toISOString();
  const sourceUpdatedAt = payload.lastUpdated ?? null;

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [existingCitizens, existingVehicles, existingLicenses] = await Promise.all([
    fetchAll(supabase, 'citizens'),
    fetchAll(supabase, 'vehicles'),
    fetchAll(supabase, 'licenses'),
  ]);

  const citizenByUsername = new Map(existingCitizens.map((c) => [normalizeKey(c.roblox_username), c]));
  const vehicleByPlate = new Map(existingVehicles.map((v) => [normalizePlate(v.license_plate), v]));
  const driverLicenseByCitizen = new Map(
    existingLicenses
      .filter((l) => l.citizen_id && String(l.license_type ?? '').toLowerCase() === 'driver')
      .map((l) => [l.citizen_id, l]),
  );

  const citizenInserts = [];
  const citizenUpdates = [];

  for (const item of citizens) {
    const username = String(item.username ?? '').trim();
    if (!username) continue;
    const key = normalizeKey(username);
    const bitLines = [
      `สถานะใบขับขี่จาก BIT: ${licenseStatusLabel(item.drivingLicense)}`,
      sourceUpdatedAt ? `อัปเดตต้นทาง: ${sourceUpdatedAt}` : null,
      `นำเข้าล่าสุด: ${importedAt}`,
    ].filter(Boolean);

    const existing = citizenByUsername.get(key);
    if (existing) {
      const nextNotes = mergeBitBlock(existing.notes, bitLines);
      if (nextNotes !== (existing.notes ?? '')) {
        citizenUpdates.push({ id: existing.id, patch: { notes: nextNotes, updated_at: importedAt } });
        citizenByUsername.set(key, { ...existing, notes: nextNotes });
      }
    } else {
      citizenInserts.push({
        roblox_username: username,
        discord_username: null,
        status: 'normal',
        notes: mergeBitBlock('', bitLines),
      });
    }
  }

  await insertChunks(supabase, 'citizens', citizenInserts, apply);
  await updateRows(supabase, 'citizens', citizenUpdates, apply);

  const refreshedCitizens = apply ? await fetchAll(supabase, 'citizens') : existingCitizens.concat(
    citizenInserts.map((c, index) => ({ ...c, id: `dry-citizen-${index}` })),
  );
  const refreshedCitizenByUsername = new Map(refreshedCitizens.map((c) => [normalizeKey(c.roblox_username), c]));

  const vehicleInserts = [];
  const vehicleUpdates = [];
  const licenseInserts = [];
  const licenseUpdates = [];
  let skippedVehiclesWithoutPlate = 0;
  let skippedDuplicateSourcePlates = 0;

  for (const item of citizens) {
    const username = String(item.username ?? '').trim();
    if (!username) continue;
    const citizen = refreshedCitizenByUsername.get(normalizeKey(username));
    const vehicles = Array.isArray(item.vehicles) ? item.vehicles : [];

    for (const vehicle of vehicles) {
      const plate = normalizePlate(vehicle.licensePlate);
      if (!plate) {
        skippedVehiclesWithoutPlate += 1;
        continue;
      }
      const mapped = mapVehicle(vehicle.vehicleType);
      const vehicleLines = [
        `เจ้าของจาก BIT: ${username}`,
        `ประเภทยานพาหนะจาก BIT: ${cleanText(vehicle.vehicleType)}`,
        `วันที่ต่อทะเบียน: ${cleanText(vehicle.regDate)}`,
        `วันหมดอายุทะเบียน: ${cleanText(vehicle.expDate)}`,
        sourceUpdatedAt ? `อัปเดตต้นทาง: ${sourceUpdatedAt}` : null,
        `นำเข้าล่าสุด: ${importedAt}`,
      ].filter(Boolean);

      const existing = vehicleByPlate.get(plate);
      if (existing) {
        if (!existing.id) {
          skippedDuplicateSourcePlates += 1;
          continue;
        }
        const patch = {};
        const nextNotes = mergeBitBlock(existing.notes, vehicleLines);
        if (nextNotes !== (existing.notes ?? '')) patch.notes = nextNotes;
        if (!existing.owner_name) patch.owner_name = username;
        if (!existing.citizen_id && citizen?.id) patch.citizen_id = citizen.id;
        if (!existing.vehicle_category) patch.vehicle_category = mapped.vehicle_category;
        if (Object.keys(patch).length > 0) {
          patch.updated_at = importedAt;
          vehicleUpdates.push({ id: existing.id, patch });
          vehicleByPlate.set(plate, { ...existing, ...patch });
        }
      } else {
        vehicleInserts.push({
          license_plate: plate,
          owner_name: username,
          vehicle_type: mapped.vehicle_type,
          color: null,
          brand_model: null,
          vehicle_category: mapped.vehicle_category,
          citizen_id: citizen?.id ?? null,
          is_impounded: false,
          impound_reason: null,
          impound_location: null,
          impounded_at: null,
          impounded_by: null,
          impounded_by_name: null,
          released_at: null,
          released_by: null,
          released_by_name: null,
          notes: mergeBitBlock('', vehicleLines),
          image_url: null,
        });
        vehicleByPlate.set(plate, {
          id: null,
          license_plate: plate,
          owner_name: username,
          citizen_id: citizen?.id ?? null,
          notes: mergeBitBlock('', vehicleLines),
          vehicle_category: mapped.vehicle_category,
        });
      }
    }

    if (licenseStatusLabel(item.drivingLicense) === 'มี' && citizen?.id) {
      const existingLicense = driverLicenseByCitizen.get(citizen.id);
      const licenseLines = [
        'สถานะใบขับขี่จาก BIT: มี',
        'API ต้นทางไม่ได้ระบุเลขที่ใบอนุญาตหรือวันหมดอายุใบขับขี่',
        sourceUpdatedAt ? `อัปเดตต้นทาง: ${sourceUpdatedAt}` : null,
        `นำเข้าล่าสุด: ${importedAt}`,
      ].filter(Boolean);
      if (existingLicense) {
        const nextNotes = mergeBitBlock(existingLicense.notes, licenseLines);
        if (nextNotes !== (existingLicense.notes ?? '')) {
          licenseUpdates.push({ id: existingLicense.id, patch: { notes: nextNotes, updated_at: importedAt } });
        }
      } else {
        licenseInserts.push({
          roblox_username: username,
          discord_username: citizen.discord_username ?? null,
          license_type: 'driver',
          license_number: null,
          issue_date: sourceUpdatedAt ? sourceUpdatedAt.slice(0, 10) : importedAt.slice(0, 10),
          expiry_date: null,
          status: 'active',
          issued_by: null,
          issued_by_name: 'BIT Database Import',
          notes: mergeBitBlock('', licenseLines),
          citizen_id: citizen.id,
        });
      }
    }
  }

  await insertChunks(supabase, 'vehicles', vehicleInserts, apply);
  await updateRows(supabase, 'vehicles', vehicleUpdates, apply);
  await insertChunks(supabase, 'licenses', licenseInserts, apply);
  await updateRows(supabase, 'licenses', licenseUpdates, apply);

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    source: {
      totalCitizens: payload.totalCitizens ?? citizens.length,
      lastUpdated: sourceUpdatedAt,
    },
    existing: {
      citizens: existingCitizens.length,
      vehicles: existingVehicles.length,
      licenses: existingLicenses.length,
    },
    planned: {
      citizenInserts: citizenInserts.length,
      citizenUpdates: citizenUpdates.length,
      vehicleInserts: vehicleInserts.length,
      vehicleUpdates: vehicleUpdates.length,
      driverLicenseInserts: licenseInserts.length,
      driverLicenseUpdates: licenseUpdates.length,
      skippedVehiclesWithoutPlate,
      skippedDuplicateSourcePlates,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
