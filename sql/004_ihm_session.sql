-- ihm_session — singleton row holding the current IHM session cookies.
-- Replaces the .env.local IHM_SESSION_COOKIE variable so Charlie can refresh
-- cookies from the admin UI without a code deploy.
--
-- The `id = 1` CHECK enforces a single row. All five cookie slots are
-- optional so you can update individual values (e.g., only cf_clearance when
-- it rotates). An 'extra' slot is included for any additional cookie IHM
-- might start requiring without needing a schema change.

CREATE TABLE IF NOT EXISTS ihm_session (
  id                    INT         PRIMARY KEY DEFAULT 1,
  cookie_ihm            TEXT,            -- value of `ihm` cookie (starts with st=...)
  cookie_aspnet_session TEXT,            -- value of `ASP.NET_SessionId`
  cookie_cf_clearance   TEXT,            -- Cloudflare clearance token
  cookie_email          TEXT,            -- value of `email` cookie
  cookie_extra          TEXT,            -- any additional `name=value; ...` snippet
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_test_at          TIMESTAMPTZ,
  last_test_ok          BOOLEAN,
  last_test_error       TEXT,
  CONSTRAINT ihm_session_single_row CHECK (id = 1)
);

-- Seed the singleton row if missing so UPSERTs from the app can always hit it.
INSERT INTO ihm_session (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
