CREATE TABLE IF NOT EXISTS analytics_agg_hour (
  analytics_config_id LowCardinality(String),
  bucket DateTime,

  page_views SimpleAggregateFunction(sum, UInt64),
  unique_visitors SimpleAggregateFunction(sum, UInt64),
  sessions AggregateFunction(uniq, String),
  bounces SimpleAggregateFunction(sum, UInt64),
  custom_events SimpleAggregateFunction(sum, UInt64),

  total_session_duration_ms SimpleAggregateFunction(sum, UInt64),
  session_count SimpleAggregateFunction(sum, UInt64),
  total_scroll_depth SimpleAggregateFunction(sum, UInt64),
  scroll_count SimpleAggregateFunction(sum, UInt64),

  top_paths SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  top_referrers SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  geo_data SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  devices SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  browsers SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  os_data SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  utm_sources SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  utm_mediums SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  utm_campaigns SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  entry_pages SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  exit_pages SimpleAggregateFunction(sumMap, Map(String, UInt64))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (analytics_config_id, bucket)
TTL bucket + INTERVAL 180 DAY
SETTINGS index_granularity = 512
