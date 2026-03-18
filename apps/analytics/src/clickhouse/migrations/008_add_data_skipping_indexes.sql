ALTER TABLE analytics_events ADD INDEX IF NOT EXISTS idx_pathname pathname TYPE bloom_filter(0.01) GRANULARITY 4;
ALTER TABLE analytics_events ADD INDEX IF NOT EXISTS idx_event_type event_type TYPE set(3) GRANULARITY 1;
ALTER TABLE analytics_events ADD INDEX IF NOT EXISTS idx_event_name event_name TYPE bloom_filter(0.01) GRANULARITY 4;
