CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_events_to_day_mv
TO analytics_agg_day
AS SELECT
  analytics_config_id,
  toDate(timestamp) AS bucket,

  countIf(event_type = 'pageview') AS page_views,
  sumIf(is_unique, event_type = 'pageview') AS unique_visitors,
  uniqStateIf(session_id, session_id != '') AS sessions,
  countIf(event_type = 'session_end' AND is_bounce = 1) AS bounces,
  countIf(event_type = 'event') AS custom_events,

  sumIf(session_duration_ms, event_type = 'session_end') AS total_session_duration_ms,
  countIf(event_type = 'session_end' AND session_duration_ms > 0) AS session_count,
  sumIf(scroll_depth_pct, event_type = 'session_end') AS total_scroll_depth,
  countIf(event_type = 'session_end' AND scroll_depth_pct > 0) AS scroll_count,

  sumMap(map(pathname, toUInt64(1))) AS top_paths,
  sumMap(map(if(referrer_domain = '', '(direct)', referrer_domain), toUInt64(1))) AS top_referrers,
  sumMap(map(country_code, toUInt64(1))) AS geo_data,
  sumMap(map(device_type, toUInt64(1))) AS devices,
  sumMap(map(browser, toUInt64(1))) AS browsers,
  sumMap(map(os, toUInt64(1))) AS os_data,
  sumMap(map(if(utm_source = '', '(none)', utm_source), toUInt64(1))) AS utm_sources,
  sumMap(map(if(utm_medium = '', '(none)', utm_medium), toUInt64(1))) AS utm_mediums,
  sumMap(map(if(utm_campaign = '', '(none)', utm_campaign), toUInt64(1))) AS utm_campaigns,
  sumMap(map(if(is_entry = 1, pathname, ''), toUInt64(if(is_entry = 1, 1, 0)))) AS entry_pages,
  sumMap(map(if(is_exit = 1, pathname, ''), toUInt64(if(is_exit = 1, 1, 0)))) AS exit_pages
FROM analytics_events
WHERE event_type IN ('pageview', 'event', 'session_end')
GROUP BY analytics_config_id, bucket
