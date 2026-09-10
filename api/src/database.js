
import pg from "pg"

const { Pool } = pg
export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function migrate() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS airdash`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS airdash.users (
      discord_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','DISABLED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS airdash.applications (
      id BIGSERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL UNIQUE REFERENCES airdash.users(discord_id),
      preferred_name TEXT NOT NULL,
      vatsim_cid TEXT NOT NULL,
      base_code TEXT NOT NULL,
      simulator TEXT NOT NULL,
      experience TEXT NOT NULL,
      introduction TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','RETURNED','REJECTED')),
      reviewer_notes TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE SEQUENCE IF NOT EXISTS airdash.pilot_number_seq START 1;
    CREATE TABLE IF NOT EXISTS airdash.bases (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS airdash.pilots (
      discord_id TEXT PRIMARY KEY REFERENCES airdash.users(discord_id),
      pilot_number TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      vatsim_cid TEXT NOT NULL,
      base_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LEAVE','INACTIVE','SUSPENDED')),
      total_block_minutes INTEGER NOT NULL DEFAULT 0,
      total_flights INTEGER NOT NULL DEFAULT 0,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS airdash.aircraft (
      registration TEXT PRIMARY KEY,
      fleet_number INTEGER NOT NULL UNIQUE,
      aircraft_type TEXT NOT NULL DEFAULT 'BCS3',
      status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('PLANNED','AVAILABLE','ASSIGNED','MAINTENANCE','INACTIVE')),
      current_airport TEXT NOT NULL,
      livery_url TEXT,
      livery_sha256 TEXT,
      livery_msfs2020_url TEXT,
      livery_msfs2020_sha256 TEXT,
      livery_msfs2020_download_count INTEGER NOT NULL DEFAULT 0,
      total_block_minutes INTEGER NOT NULL DEFAULT 0,
      total_cycles INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS airdash.routes (
      id BIGSERIAL PRIMARY KEY,
      flight_number INTEGER NOT NULL UNIQUE,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      block_minutes INTEGER NOT NULL CHECK (block_minutes > 0),
      days TEXT NOT NULL DEFAULT 'Daily',
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(origin, destination)
    );
    CREATE TABLE IF NOT EXISTS airdash.assignments (
      id BIGSERIAL PRIMARY KEY,
      route_id BIGINT NOT NULL REFERENCES airdash.routes(id),
      flight_date DATE NOT NULL,
      discord_id TEXT NOT NULL REFERENCES airdash.pilots(discord_id),
      registration TEXT NOT NULL REFERENCES airdash.aircraft(registration),
      status TEXT NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED','COMPLETED','DIVERTED','CANCELLED','EXPIRED')),
      booked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      cancelled_by TEXT,
      cancellation_code TEXT,
      cancellation_reason TEXT,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '6 hours',
      departure_gate TEXT,
      arrival_gate TEXT,
      tail_number TEXT,
      simbrief_url TEXT,
      simbrief_format TEXT,
      flight_plan JSONB,
      UNIQUE(route_id, flight_date, discord_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS assignments_active_aircraft
      ON airdash.assignments(registration)
      WHERE status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED');
    CREATE UNIQUE INDEX IF NOT EXISTS assignments_active_pilot
      ON airdash.assignments(discord_id)
      WHERE status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED');
    CREATE TABLE IF NOT EXISTS airdash.pireps (
      id BIGSERIAL PRIMARY KEY,
      assignment_id BIGINT NOT NULL UNIQUE REFERENCES airdash.assignments(id),
      discord_id TEXT NOT NULL REFERENCES airdash.pilots(discord_id),
      actual_out_at TIMESTAMPTZ NOT NULL,
      actual_off_at TIMESTAMPTZ,
      actual_on_at TIMESTAMPTZ,
      actual_in_at TIMESTAMPTZ NOT NULL,
      landing_rate INTEGER,
      vatsim_flown BOOLEAN NOT NULL DEFAULT FALSE,
      volanta_url TEXT,
      volanta_flight_id TEXT,
      volanta_data JSONB,
      distance_nm NUMERIC,
      fuel_burn NUMERIC,
      network TEXT,
      callsign TEXT,
      remarks TEXT NOT NULL DEFAULT '',
      review_status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (review_status IN ('SUBMITTED','APPROVED','RETURNED','REJECTED')),
      review_notes TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      CHECK (actual_in_at > actual_out_at)
    );
    CREATE TABLE IF NOT EXISTS airdash.audit_events (
      id BIGSERIAL PRIMARY KEY,
      actor_discord_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS airdash.org_updates (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'GENERAL',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      pilot_discord_id TEXT,
      aircraft_registration TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS org_updates_created_at ON airdash.org_updates(created_at DESC);
  `)

  await pool.query(`
    ALTER TABLE airdash.org_updates ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE airdash.org_updates ADD COLUMN IF NOT EXISTS slug TEXT;
    ALTER TABLE airdash.org_updates ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT '';
    ALTER TABLE airdash.org_updates ADD COLUMN IF NOT EXISTS hero_image_url TEXT;
    ALTER TABLE airdash.org_updates ADD COLUMN IF NOT EXISTS author_name TEXT NOT NULL DEFAULT 'Staff Writer';
    ALTER TABLE airdash.org_updates ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
    ALTER TABLE airdash.org_updates DROP CONSTRAINT IF EXISTS org_updates_slug_format;
    ALTER TABLE airdash.org_updates ADD CONSTRAINT org_updates_slug_format CHECK (slug IS NULL OR slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
    CREATE UNIQUE INDEX IF NOT EXISTS org_updates_public_slug ON airdash.org_updates(slug) WHERE slug IS NOT NULL;
    CREATE INDEX IF NOT EXISTS org_updates_public_published ON airdash.org_updates(published_at DESC) WHERE is_public=TRUE;
    UPDATE airdash.org_updates SET
      body=REPLACE(body, ' This information is for internal distribution only until a public announcement is authorized.', ''),
      is_public=TRUE,
      slug='order-for-30-boeing-757-200-aircraft',
      summary='airDash has placed an order for 30 new Boeing 757-200 aircraft powered by Rolls-Royce RB211 engines as part of its long-term fleet growth strategy.',
      hero_image_url='/assets/news/boeing-press-20260910.png',
      author_name='Staff Writer',
      published_at=COALESCE(published_at,created_at)
      WHERE title='Order for 30 Boeing 757-200 Aircraft';
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS departure_gate TEXT;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS arrival_gate TEXT;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS tail_number TEXT;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS simbrief_url TEXT;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS simbrief_format TEXT;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS flight_plan JSONB;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS cancellation_code TEXT;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
    ALTER TABLE airdash.assignments DROP CONSTRAINT IF EXISTS assignments_status_check;
    ALTER TABLE airdash.assignments ADD CONSTRAINT assignments_status_check CHECK (status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED','COMPLETED','DIVERTED','CANCELLED','EXPIRED'));
    UPDATE airdash.assignments SET cancellation_code=CASE WHEN status='EXPIRED' THEN 'DEADLINE_EXPIRED' ELSE 'OTHER' END
      WHERE status IN ('CANCELLED','EXPIRED') AND cancellation_code IS NULL;
    UPDATE airdash.assignments a SET
      cancelled_at=event.created_at,
      cancelled_by=CASE WHEN event.action='ASSIGNMENT_EXPIRED' THEN NULL ELSE event.actor_discord_id END,
      cancellation_reason=CASE WHEN event.action='ASSIGNMENT_EXPIRED' THEN 'Booking expired' ELSE 'Cancelled by pilot' END
    FROM (
      SELECT DISTINCT ON (entity_id) entity_id, actor_discord_id, action, created_at
      FROM airdash.audit_events
      WHERE action IN ('ASSIGNMENT_CANCELLED','ASSIGNMENT_EXPIRED')
      ORDER BY entity_id, created_at DESC
    ) event
    WHERE a.id::TEXT=event.entity_id AND a.status IN ('CANCELLED','EXPIRED') AND a.cancelled_at IS NULL;
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS pronouns TEXT NOT NULL DEFAULT '';
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS about_me TEXT NOT NULL DEFAULT '';
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS home_base_request TEXT;
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS home_base_request_reason TEXT NOT NULL DEFAULT '';
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS home_base_requested_at TIMESTAMPTZ;
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS missions_completed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS assignments_completed INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS airdash.settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO airdash.settings (key, value) VALUES ('operations', '{"autoApprovePireps": false}'::jsonb) ON CONFLICT (key) DO NOTHING;
    ALTER TABLE airdash.aircraft ADD COLUMN IF NOT EXISTS status_reason TEXT NOT NULL DEFAULT '';
    ALTER TABLE airdash.aircraft ADD COLUMN IF NOT EXISTS status_until TIMESTAMPTZ;
    ALTER TABLE airdash.aircraft ADD COLUMN IF NOT EXISTS status_set_by TEXT;
    ALTER TABLE airdash.aircraft ADD COLUMN IF NOT EXISTS status_set_at TIMESTAMPTZ;
    ALTER TABLE airdash.aircraft DROP CONSTRAINT IF EXISTS aircraft_status_check;
    ALTER TABLE airdash.aircraft ADD CONSTRAINT aircraft_status_check CHECK (status IN ('PLANNED','AVAILABLE','ASSIGNED','MAINTENANCE','INSPECTION','RETIRED','INACTIVE'));
    ALTER TABLE airdash.assignments ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '2 hours 30 minutes';
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS file_vatsim BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS volanta_tracking_consent BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS volanta_tracking_url TEXT;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS volanta_tracking_data JSONB;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS volanta_last_synced_at TIMESTAMPTZ;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS actual_off_at TIMESTAMPTZ;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS actual_on_at TIMESTAMPTZ;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS landing_rate INTEGER;
    UPDATE airdash.pireps SET landing_rate=NULL WHERE landing_rate=0;
    ALTER TABLE airdash.pireps DROP CONSTRAINT IF EXISTS pireps_landing_rate_nonzero;
    ALTER TABLE airdash.pireps ADD CONSTRAINT pireps_landing_rate_nonzero CHECK (landing_rate IS NULL OR landing_rate <> 0);
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS volanta_url TEXT;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS volanta_flight_id TEXT;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS volanta_data JSONB;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS distance_nm NUMERIC;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS fuel_burn NUMERIC;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS network TEXT;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS callsign TEXT;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS credited_minutes INTEGER;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS base_experience INTEGER;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS streak_bonus_experience INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS streak_bonus_percent INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS day_streak_at_award INTEGER;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS continuity_streak_at_award INTEGER;
    UPDATE airdash.pireps SET base_experience=credited_minutes WHERE base_experience IS NULL AND credited_minutes IS NOT NULL;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS sim_block_seconds INTEGER;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS real_block_seconds INTEGER;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS time_compression_ratio NUMERIC(7,3);
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS time_compression_detected BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS time_compression_reason TEXT NOT NULL DEFAULT '';
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS outcome_type TEXT NOT NULL DEFAULT 'COMPLETED';
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS diversion_reason_code TEXT;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS diversion_details TEXT NOT NULL DEFAULT '';
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS actual_destination TEXT;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS reposition_airport TEXT;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS reposition_method TEXT;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS progress_ratio NUMERIC(5,3);
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS credit_multiplier NUMERIC(4,3) NOT NULL DEFAULT 1.000;
    ALTER TABLE airdash.pireps ADD COLUMN IF NOT EXISTS credited_block_minutes INTEGER;
    ALTER TABLE airdash.pireps DROP CONSTRAINT IF EXISTS pireps_outcome_type_check;
    ALTER TABLE airdash.pireps ADD CONSTRAINT pireps_outcome_type_check CHECK (outcome_type IN ('COMPLETED','DIVERTED','INCOMPLETE'));
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS experience INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS rank_name TEXT NOT NULL DEFAULT 'Captain';
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS leadership_title TEXT;
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS public_profile_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    UPDATE airdash.pilots SET rank_name='Captain', leadership_title='Founder & CEO', public_profile_enabled=TRUE
      WHERE discord_id='860900952097030184';
    ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS simbrief_username TEXT;
    CREATE TABLE IF NOT EXISTS airdash.notification_history (
      id BIGSERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL REFERENCES airdash.users(discord_id) ON DELETE CASCADE,
      event_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      href TEXT NOT NULL DEFAULT '/portal#portal-updates',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at TIMESTAMPTZ,
      pushed_at TIMESTAMPTZ,
      UNIQUE(discord_id, event_key)
    );
    CREATE INDEX IF NOT EXISTS notification_history_user_created ON airdash.notification_history(discord_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS notification_history_user_unread ON airdash.notification_history(discord_id, read_at) WHERE read_at IS NULL;
    CREATE TABLE IF NOT EXISTS airdash.push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL REFERENCES airdash.users(discord_id) ON DELETE CASCADE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_success_at TIMESTAMPTZ,
      last_error TEXT NOT NULL DEFAULT '',
      disabled_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS push_subscriptions_user ON airdash.push_subscriptions(discord_id) WHERE disabled_at IS NULL;
    UPDATE airdash.pilots p SET total_flights=(SELECT COUNT(*)::INTEGER FROM airdash.pireps pr WHERE pr.discord_id=p.discord_id AND pr.review_status='APPROVED');
    ALTER TABLE airdash.aircraft ADD COLUMN IF NOT EXISTS livery_name TEXT;
    ALTER TABLE airdash.aircraft ADD COLUMN IF NOT EXISTS special_livery BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE airdash.aircraft ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
    UPDATE airdash.aircraft SET thumbnail_url = '/downloads/liveries/' || lower(registration) || '/thumbnail.png' WHERE thumbnail_url IS NULL;
    UPDATE airdash.aircraft SET livery_name='FWA2027', special_livery=TRUE WHERE registration='N514AD';
    CREATE TABLE IF NOT EXISTS airdash.livery_downloads (
      discord_id TEXT NOT NULL REFERENCES airdash.users(discord_id),
      registration TEXT NOT NULL,
      simulator TEXT NOT NULL DEFAULT 'MSFS2024',
      downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (discord_id, registration, simulator)
    );
    ALTER TABLE airdash.livery_downloads ADD COLUMN IF NOT EXISTS simulator TEXT NOT NULL DEFAULT 'MSFS2024';
    ALTER TABLE airdash.livery_downloads DROP CONSTRAINT IF EXISTS livery_downloads_pkey;
    ALTER TABLE airdash.livery_downloads ADD CONSTRAINT livery_downloads_pkey PRIMARY KEY (discord_id, registration, simulator);
    ALTER TABLE airdash.livery_downloads DROP CONSTRAINT IF EXISTS livery_downloads_simulator_check;
    ALTER TABLE airdash.livery_downloads ADD CONSTRAINT livery_downloads_simulator_check CHECK (simulator IN ('MSFS2020','MSFS2024'));
    ALTER TABLE airdash.aircraft ADD COLUMN IF NOT EXISTS livery_download_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE airdash.aircraft ADD COLUMN IF NOT EXISTS livery_msfs2020_url TEXT;
    ALTER TABLE airdash.aircraft ADD COLUMN IF NOT EXISTS livery_msfs2020_sha256 TEXT;
    ALTER TABLE airdash.aircraft ADD COLUMN IF NOT EXISTS livery_msfs2020_download_count INTEGER NOT NULL DEFAULT 0;
    UPDATE airdash.aircraft a
      SET livery_download_count=GREATEST(a.livery_download_count, downloads.total)
      FROM (SELECT registration, COUNT(*)::INTEGER total FROM airdash.livery_downloads GROUP BY registration) downloads
      WHERE downloads.registration=a.registration;
    UPDATE airdash.pilots SET experience = total_block_minutes WHERE experience = 0 AND total_block_minutes > 0;
    ALTER TABLE airdash.applications DROP CONSTRAINT IF EXISTS applications_base_code_check;
    INSERT INTO airdash.bases (code, name, lat, lon, role, sort_order) VALUES
      ('KATL', 'Atlanta', 33.6407, -84.4277, 'Headquarters', 10),
      ('KDEN', 'Denver', 39.8561, -104.6737, 'Western base', 20),
      ('MDSD', 'Santo Domingo', 18.4297, -69.6689, 'Caribbean base', 30),
      ('KGEG', 'Spokane', 47.6199, -117.5339, 'Northwest base', 40)
    ON CONFLICT (code) DO NOTHING;
    CREATE TABLE IF NOT EXISTS airdash.schedule (
      id BIGSERIAL PRIMARY KEY,
      route_id BIGINT NOT NULL REFERENCES airdash.routes(id),
      dep_time TIMESTAMPTZ NOT NULL,
      arr_time TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','TAKEN','DEPARTED','COMPLETED')),
      assignment_id BIGINT REFERENCES airdash.assignments(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(route_id, dep_time)
    );
    CREATE INDEX IF NOT EXISTS schedule_dep_time ON airdash.schedule(dep_time);
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS schedule_id BIGINT;
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'BOARD';
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS mission_type TEXT NOT NULL DEFAULT 'STANDARD';
    ALTER TABLE airdash.assignments ADD COLUMN IF NOT EXISTS recovery_of_assignment_id BIGINT REFERENCES airdash.assignments(id);
    ALTER TABLE airdash.assignments DROP CONSTRAINT IF EXISTS assignments_mission_type_check;
    ALTER TABLE airdash.assignments ADD CONSTRAINT assignments_mission_type_check CHECK (mission_type IN ('STANDARD','RECOVERY'));
    CREATE UNIQUE INDEX IF NOT EXISTS assignments_recovery_source_active ON airdash.assignments(recovery_of_assignment_id)
      WHERE recovery_of_assignment_id IS NOT NULL AND status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED','COMPLETED','DIVERTED');
    ALTER TABLE airdash.routes DROP CONSTRAINT IF EXISTS routes_origin_destination_key;
    CREATE UNIQUE INDEX IF NOT EXISTS routes_active_origin_destination ON airdash.routes(origin,destination) WHERE status='ACTIVE';
    CREATE UNIQUE INDEX IF NOT EXISTS routes_recovery_origin_destination ON airdash.routes(origin,destination)
      WHERE status='INACTIVE' AND days='Recovery ferry';
  `)

  const fleet = [
    ['N514AD', 514, 'KATL', '/downloads/liveries/n514ad/synaptic-a220-livery-air-N514AD.zip', '1bd410ad3e4c736fb7bf25836ef41b3c6d62d9098900745fd5f49e03c93a8f90', '/downloads/liveries/n514ad/synaptic-a220-livery-air-N514AD-msfs2020.zip', '38d90c275d9d70261629111e9d07173f68acd357bfca2e7d52e3510e6aad36e9'],
    ['N572AD', 572, 'KATL', '/downloads/liveries/n572ad/synaptic-a220-livery-air-N572AD.zip', '569948dc0b22043f1781543aea863e5efd0adbfd610fcbea0af65af5a93c687b', '/downloads/liveries/n572ad/synaptic-a220-livery-air-N572AD-msfs2020.zip', '79f9f6fc5670600685d5ed76f376dedc52b06ba8e9fe28cc1e70525932c8de4e'],
    ['N573AD', 573, 'KATL', '/downloads/liveries/n573ad/synaptic-a220-livery-air-N573AD.zip', '9b2c58b69467c7323822c085ea9362a454783be382d117207786904ea5b5cd2c', '/downloads/liveries/n573ad/synaptic-a220-livery-air-N573AD-msfs2020.zip', '10557f98f97adbc961b89dda3e4710b020ecd808b6f5119bd47b118cb21982d8'],
    ['N574AD', 574, 'KATL', '/downloads/liveries/n574ad/synaptic-a220-livery-air-N574AD.zip', '37ed48ada0da107b67647d1eef2664927e1dfb87ece19546997e9cb1e83fb11d', '/downloads/liveries/n574ad/synaptic-a220-livery-air-N574AD-msfs2020.zip', '35f5131d94d650989e03db284b5e4bf2a2f5a5a79aa39377582f4a2c95f4d6a9'],
    ['N575AD', 575, 'KATL', '/downloads/liveries/n575ad/synaptic-a220-livery-air-N575AD.zip', 'af246364ebad632bf32a057219e7c36a6e75abc8806477350b8087c5036db672', '/downloads/liveries/n575ad/synaptic-a220-livery-air-N575AD-msfs2020.zip', 'e45d0954982da74fc8385db2ede16906431339999700c5a0c3646a7a6be866dd'],
    ['N772AD', 772, 'KATL', '/downloads/liveries/n772ad/synaptic-a220-livery-air-N772AD.zip', 'aed5f1000e90fd5408ccf5e61d9841e49c21b05ae3c5a7c4c0fac0848e2339ba', '/downloads/liveries/n772ad/synaptic-a220-livery-air-N772AD-msfs2020.zip', '2d52c509746300ba5854f980c04b5af80dece520b0aa112ed39e8f0e2635442b'],
    ['N773AD', 773, 'KATL', '/downloads/liveries/n773ad/synaptic-a220-livery-air-N773AD.zip', 'bbf56cde5923e641649ad8a3c48dba8c91b0459ed64fbdc965c5324ec11f2ab2', '/downloads/liveries/n773ad/synaptic-a220-livery-air-N773AD-msfs2020.zip', '209d141a79b94b36cb97854c809a7e599651302db83746140085531c30930d57'],
    ['N791AD', 791, 'KATL', '/downloads/liveries/n791ad/synaptic-a220-livery-air-N791AD.zip', 'b53a5fc78e3e676d1e36a0d5b39f66e1431f4ce8a5a5dc82ef2c14efda4fd7f6', '/downloads/liveries/n791ad/synaptic-a220-livery-air-N791AD-msfs2020.zip', 'f7fb59c5971c470b7d98c62d9de72813cdbf5882effd596fc3d8b73b4d9ac415'],
    ['N793AD', 793, 'KDEN', '/downloads/liveries/n793ad/synaptic-a220-livery-air-N793AD.zip', 'dc7e949be246aac67ed933e01d18caafe8677e06a73714492f981e3f4d8ae7f8', '/downloads/liveries/n793ad/synaptic-a220-livery-air-N793AD-msfs2020.zip', '43554541009eac27ed04e3bcdaa53980cd5a75a24bc56af062c8c45741592c6d'],
    ['N794AD', 794, 'KDEN', '/downloads/liveries/n794ad/synaptic-a220-livery-air-N794AD.zip', '76d311d0ca0439793055bda72b7b2bbdbeeca5f50a0a4331742c86bf47b3141c', '/downloads/liveries/n794ad/synaptic-a220-livery-air-N794AD-msfs2020.zip', '6357e2a19e2ef9dc44e72b654581b17e3ac35320c8843f38ab943539ee0b830e'],
    ['N796AD', 796, 'KDEN', '/downloads/liveries/n796ad/synaptic-a220-livery-air-N796AD.zip', '7884f0d74debeaff846d495a3aef11dd63309eecd68ca43e544f15537052b451', '/downloads/liveries/n796ad/synaptic-a220-livery-air-N796AD-msfs2020.zip', '714011c66f359f9d588804fae1b08f131ab4b3f56ffd012757ff9069b68b81ef'],
    ['N797AD', 797, 'KDEN', '/downloads/liveries/n797ad/synaptic-a220-livery-air-N797AD.zip', 'a4c0a6da7e307d248c00d052b562094ae3f08fcd2b130cdbac038560edd0b27b', '/downloads/liveries/n797ad/synaptic-a220-livery-air-N797AD-msfs2020.zip', '7f054e17fe0db696cb89554e0a1335e16e41a9ed0f14493ee5983560f6e897f5'],
    ['N798AD', 798, 'KDEN', '/downloads/liveries/n798ad/synaptic-a220-livery-air-N798AD.zip', 'e8a196a99dfacf0d37233bdfd2f8edcee1e69041194ff4c64edb12908853cbe4', '/downloads/liveries/n798ad/synaptic-a220-livery-air-N798AD-msfs2020.zip', '481964abe52b4776cf3a95edb83e0036785dd1e0b75d37d4c0ff8adfd433e8ef'],
    ['N801AD', 801, 'KDEN', '/downloads/liveries/n801ad/synaptic-a220-livery-air-N801AD.zip', 'cf734d00e73607ad36dd68897e2eae4a86816c8151c6a7498bb072529e66c40d', '/downloads/liveries/n801ad/synaptic-a220-livery-air-N801AD-msfs2020.zip', '5033e2d3306faeab967eaea4f05befc236160dfe2487419777b4c3ef4f5588db'],
    ['N802AD', 802, 'KDEN', '/downloads/liveries/n802ad/synaptic-a220-livery-air-N802AD.zip', '87a74ea5d3f3ba9a735b485d5a1790044dfb1cd9da48351603c1ca1dea938aba', '/downloads/liveries/n802ad/synaptic-a220-livery-air-N802AD-msfs2020.zip', '2f237a175e04b96a2e989f81a9a226f77115b9e2501ba550c2587808ca72f42e'],
    ['N803AD', 803, 'MDSD', '/downloads/liveries/n803ad/synaptic-a220-livery-air-N803AD.zip', 'cdeb4fe5f8024225ad8883f66a3de6edae8fda5fbfcdc89459c9690ccc273e6b', '/downloads/liveries/n803ad/synaptic-a220-livery-air-N803AD-msfs2020.zip', '011c1490a92e94fac3d1b66fda5a8d3f27b001813f68ba2d3d02d27d1a59f366'],
    ['N804AD', 804, 'MDSD', '/downloads/liveries/n804ad/synaptic-a220-livery-air-N804AD.zip', 'b4620b6f227f4f288598269cf3c378b082b5af3cc510c9f39b9bc005dbee4f1e', '/downloads/liveries/n804ad/synaptic-a220-livery-air-N804AD-msfs2020.zip', '159e982571f1b18e66db63db3c1f6df030fb27354ab4507b7dd3d4c29074f36f'],
    ['N805AD', 805, 'MDSD', '/downloads/liveries/n805ad/synaptic-a220-livery-air-N805AD.zip', 'ce1eac11614ad85d76955f152ea3836237fc4bf2c4a2eef59186c2b93c63defc', '/downloads/liveries/n805ad/synaptic-a220-livery-air-N805AD-msfs2020.zip', '330d60a01521e28b559b80518b6ca1bdc08652f82d6514116536440fa1d359e7'],
    ['N806AD', 806, 'MDSD', '/downloads/liveries/n806ad/synaptic-a220-livery-air-N806AD.zip', 'b7391a9f40b2b27b1ca0c44ca73d26f165d4c2a42c30c4dfcbae8d3f770743eb', '/downloads/liveries/n806ad/synaptic-a220-livery-air-N806AD-msfs2020.zip', '8f2aa7cbbb894adb538565f766aba2053ae6521d24b04b568bfb107d121afb54'],
    ['N807AD', 807, 'MDSD', '/downloads/liveries/n807ad/synaptic-a220-livery-air-N807AD.zip', 'c1da36eaef43fbd5628589ce1d24992b71d66e13432c34fde2acd4f3b1a0cb0e', '/downloads/liveries/n807ad/synaptic-a220-livery-air-N807AD-msfs2020.zip', 'ce6987c60cb5e11e0e596816bf201ab48c4a76c34a5abeffdd4e03bf1d71f8c3'],
    ['N820AD', 820, 'MDSD', '/downloads/liveries/n820ad/synaptic-a220-livery-air-N820AD.zip', 'a7e340d6639b5eb4c80d2f0b437fb6db1f07e322a70fe3e0d86f407ab9a2be10', '/downloads/liveries/n820ad/synaptic-a220-livery-air-N820AD-msfs2020.zip', '0ad88f9125616a67a67aab26f0432d51a0ac7cf2b5886eca6eba7bc2bffbb8a0']
  ]
  for (const aircraft of fleet) {
    await pool.query(`INSERT INTO airdash.aircraft
      (registration, fleet_number, status, current_airport, livery_url, livery_sha256, livery_msfs2020_url, livery_msfs2020_sha256)
      VALUES ($1,$2,'AVAILABLE',$3,$4,$5,$6,$7)
      ON CONFLICT (registration) DO UPDATE SET livery_url=$4, livery_sha256=$5, livery_msfs2020_url=$6, livery_msfs2020_sha256=$7`, aircraft)
  }

  const routes = [
    [101, 'KATL', 'KDEN', 205, 'Daily'], [102, 'KDEN', 'KATL', 180, 'Daily'],
    [121, 'KATL', 'MDSD', 205, 'Mon Wed Fri Sun'], [122, 'MDSD', 'KATL', 215, 'Mon Wed Fri Sun'],
    [201, 'KATL', 'KJFK', 135, 'Daily'], [202, 'KJFK', 'KATL', 145, 'Daily'],
    [221, 'KATL', 'KMCO', 95, 'Daily'], [222, 'KMCO', 'KATL', 100, 'Daily'],
    [301, 'KDEN', 'KLAX', 155, 'Daily'], [302, 'KLAX', 'KDEN', 140, 'Daily'],
    [321, 'KDEN', 'KSEA', 170, 'Tue Thu Sat'], [322, 'KSEA', 'KDEN', 165, 'Tue Thu Sat'],
    [401, 'MDSD', 'KMIA', 145, 'Daily'], [402, 'KMIA', 'MDSD', 140, 'Daily'],
    [421, 'MDSD', 'KJFK', 235, 'Tue Thu Sat'], [422, 'KJFK', 'MDSD', 220, 'Tue Thu Sat'],

    [430, 'MDSD', 'KMCO', 150, 'Daily'], [431, 'KMCO', 'MDSD', 150, 'Daily'],
    [432, 'MDSD', 'MDST', 40, 'Daily'], [433, 'MDST', 'MDSD', 40, 'Daily'],
    [434, 'MDSD', 'MDPC', 45, 'Daily'], [435, 'MDPC', 'MDSD', 45, 'Daily'],
    [436, 'MDSD', 'MDPP', 45, 'Mon Wed Fri'], [437, 'MDPP', 'MDSD', 45, 'Mon Wed Fri'],
    [438, 'MDSD', 'MDLR', 35, 'Tue Thu Sat'], [439, 'MDLR', 'MDSD', 35, 'Tue Thu Sat'],
    [440, 'MDSD', 'MDCY', 40, 'Wed Sat'], [441, 'MDCY', 'MDSD', 40, 'Wed Sat'],
    [442, 'MDSD', 'MDBH', 45, 'Fri Sun'], [443, 'MDBH', 'MDSD', 45, 'Fri Sun'],

    [450, 'MDST', 'KJFK', 230, 'Daily'], [451, 'KJFK', 'MDST', 245, 'Daily'],
    [452, 'MDST', 'KBOS', 235, 'Mon Thu Sat'], [453, 'KBOS', 'MDST', 250, 'Mon Thu Sat'],
    [454, 'MDST', 'KMIA', 150, 'Daily'], [455, 'KMIA', 'MDST', 150, 'Daily'],

    [460, 'MDPC', 'KJFK', 235, 'Daily'], [461, 'KJFK', 'MDPC', 250, 'Daily'],
    [462, 'MDPC', 'KEWR', 240, 'Daily'], [463, 'KEWR', 'MDPC', 255, 'Daily'],
    [464, 'MDPC', 'KMIA', 150, 'Daily'], [465, 'KMIA', 'MDPC', 150, 'Daily'],
    [466, 'MDPC', 'KBOS', 235, 'Tue Thu Sun'], [467, 'KBOS', 'MDPC', 250, 'Tue Thu Sun'],
    [468, 'MDPC', 'KMCO', 150, 'Mon Wed Fri'], [469, 'KMCO', 'MDPC', 150, 'Mon Wed Fri'],

    [470, 'MDPP', 'KJFK', 230, 'Tue Fri Sun'], [471, 'KJFK', 'MDPP', 245, 'Tue Fri Sun'],
    [472, 'MDLR', 'KJFK', 235, 'Wed Sat'], [473, 'KJFK', 'MDLR', 250, 'Wed Sat'],

    [500, 'KJFK', 'KMIA', 180, 'Daily'], [501, 'KMIA', 'KJFK', 185, 'Daily'],
    [502, 'KJFK', 'KBOS', 70, 'Daily'], [503, 'KBOS', 'KJFK', 70, 'Daily'],
    [504, 'KEWR', 'KMIA', 180, 'Daily'], [505, 'KMIA', 'KEWR', 185, 'Daily'],
    [506, 'KBOS', 'KMIA', 190, 'Daily'], [507, 'KMIA', 'KBOS', 195, 'Daily'],
    [508, 'KPVD', 'KMCO', 175, 'Tue Thu Sat'], [509, 'KMCO', 'KPVD', 175, 'Tue Thu Sat'],
    [510, 'KPHL', 'KMIA', 165, 'Daily'], [511, 'KMIA', 'KPHL', 170, 'Daily'],
    [512, 'KEWR', 'MDSD', 230, 'Daily'], [513, 'MDSD', 'KEWR', 235, 'Daily'],
    [514, 'KBOS', 'MDSD', 245, 'Mon Wed Fri Sun'], [515, 'MDSD', 'KBOS', 250, 'Mon Wed Fri Sun'],
    [516, 'KIAD', 'MDSD', 210, 'Tue Thu Sat'], [517, 'MDSD', 'KIAD', 215, 'Tue Thu Sat'],
    [518, 'KTPA', 'MDPC', 160, 'Wed Sat'], [519, 'MDPC', 'KTPA', 160, 'Wed Sat'],
    [520, 'KBDL', 'MDPC', 235, 'Fri Sun'], [521, 'MDPC', 'KBDL', 245, 'Fri Sun'],
    [522, 'KATL', 'MDPC', 200, 'Daily'], [523, 'MDPC', 'KATL', 210, 'Daily'],
    [524, 'KATL', 'MDST', 195, 'Mon Wed Fri'], [525, 'MDST', 'KATL', 205, 'Mon Wed Fri'],

    [530, 'KATL', 'KDFW', 110, 'Daily'], [531, 'KDFW', 'KATL', 115, 'Daily'],
    [532, 'KDTW', 'MDPC', 240, 'Tue Fri Sun'], [533, 'MDPC', 'KDTW', 250, 'Tue Fri Sun'],
    [534, 'KDFW', 'MDSD', 260, 'Wed Sat'], [535, 'MDSD', 'KDFW', 270, 'Wed Sat'],
    [536, 'KDEN', 'KSAN', 150, 'Daily'], [537, 'KSAN', 'KDEN', 150, 'Daily'],
    [538, 'KDTW', 'KMCO', 170, 'Daily'], [539, 'KMCO', 'KDTW', 175, 'Daily'],
    [540, 'KDFW', 'KMIA', 150, 'Daily'], [541, 'KMIA', 'KDFW', 155, 'Daily'],
    [542, 'KDTW', 'KATL', 110, 'Daily'], [543, 'KATL', 'KDTW', 115, 'Daily'],
    [544, 'KSAN', 'KDFW', 165, 'Tue Thu Sat'], [545, 'KDFW', 'KSAN', 170, 'Tue Thu Sat']
  ]

  // generated routes from KGEG using great-circle distance for block time
  const COORDS = {
    KGEG: [47.62, -117.53], KSEA: [47.45, -122.31], KDEN: [39.86, -104.67],
    KLAX: [33.94, -118.41], KSAN: [32.73, -117.19], KDFW: [32.90, -97.04],
  }
  const haversineNm = (a, b) => {
    const R = 3440.065, toRad = d => (d * Math.PI) / 180
    const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1])
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
  }
  const estBlock = (from, to) => Math.round((haversineNm(COORDS[from], COORDS[to]) / 450 * 60 + 30) / 5) * 5
  const genDests = [['KSEA', 'Daily'], ['KDEN', 'Daily'], ['KLAX', 'Tue Thu Sat'], ['KSAN', 'Wed Sat'], ['KDFW', 'Mon Wed Fri']]
  let genFn = 550
  for (const [dest, days] of genDests) {
    const block = estBlock('KGEG', dest)
    routes.push([genFn++, 'KGEG', dest, block, days])
    routes.push([genFn++, dest, 'KGEG', block + 5, days])
  }
  for (const route of routes) {
    await pool.query(`INSERT INTO airdash.routes (flight_number, origin, destination, block_minutes, days)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (flight_number) DO NOTHING`, route)
  }
}

export async function audit(actor, action, entityType, entityId, details = {}) {
  await pool.query(`INSERT INTO airdash.audit_events (actor_discord_id, action, entity_type, entity_id, details)
    VALUES ($1,$2,$3,$4,$5)`, [actor, action, entityType, String(entityId), details])
}

export async function publishOrgUpdate({ kind = "GENERAL", title, body, pilotDiscordId = null, aircraftRegistration = null, createdBy = null,
  isPublic = false, slug = null, summary = "", heroImageUrl = null, authorName = "Staff Writer", publishedAt = null }, executor = pool) {
  if (!title || !body) return null
  const result = await executor.query(`INSERT INTO airdash.org_updates
    (kind,title,body,pilot_discord_id,aircraft_registration,created_by,is_public,slug,summary,hero_image_url,author_name,published_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [kind,title,body,pilotDiscordId,aircraftRegistration,createdBy,isPublic,slug,summary,heroImageUrl,authorName,publishedAt])
  return result.rows[0]
}
