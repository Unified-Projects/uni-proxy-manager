CREATE TABLE IF NOT EXISTS analytics_events (
  -- Identity
  analytics_config_id LowCardinality(String),

  -- Event type
  event_type Enum8('pageview' = 1, 'event' = 2, 'session_end' = 3),
  event_name LowCardinality(String) DEFAULT '',
  event_meta Map(String, String),

  -- Page data
  pathname String,
  referrer String DEFAULT '',
  referrer_domain LowCardinality(String) DEFAULT '',

  -- UTM parameters
  utm_source LowCardinality(String) DEFAULT '',
  utm_medium LowCardinality(String) DEFAULT '',
  utm_campaign LowCardinality(String) DEFAULT '',
  utm_term String DEFAULT '',
  utm_content String DEFAULT '',

  -- Visitor identification (privacy-first)
  is_unique UInt8 DEFAULT 0,

  -- Session identification
  session_id String DEFAULT '',
  is_bounce UInt8 DEFAULT 0,
  is_entry UInt8 DEFAULT 0,
  is_exit UInt8 DEFAULT 0,

  -- Device/browser (parsed from User-Agent server-side)
  browser LowCardinality(String) DEFAULT 'Unknown',
  browser_version LowCardinality(String) DEFAULT '',
  os LowCardinality(String) DEFAULT 'Unknown',
  device_type LowCardinality(String) DEFAULT 'other',

  screen_width UInt16 DEFAULT 0,
  screen_height UInt16 DEFAULT 0,

  -- Geography (derived from browser timezone, not GeoIP)
  country_code LowCardinality(String) DEFAULT 'Unknown',
  tz LowCardinality(String) DEFAULT '',

  -- Session data (set on session_end events)
  session_duration_ms UInt64 DEFAULT 0,
  scroll_depth_pct UInt8 DEFAULT 0,

  -- Source
  source LowCardinality(String) DEFAULT 'js',

  -- Timestamp
  timestamp DateTime DEFAULT now() CODEC(Delta, ZSTD(1))
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (analytics_config_id, timestamp)
TTL timestamp + INTERVAL 90 DAY
SETTINGS index_granularity = 8192
