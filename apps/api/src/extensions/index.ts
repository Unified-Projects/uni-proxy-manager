/**
 * Extension Registry
 *
 * Manages optional extensions - auto-detects based on service availability
 * rather than requiring explicit environment variables.
 */

export interface ExtensionStatus {
  /** Sites extension - deploy and host web applications */
  sites: boolean;
  /** Pomerium extension - identity-aware access control */
  pomerium: boolean;
  /** Analytics extension - privacy-first web analytics */
  analytics: boolean;
}

export interface ExtensionConfig {
  sites: {
    executorEndpoint?: string;
    executorSecret?: string;
    s3Endpoint?: string;
    s3Bucket?: string;
    s3Region?: string;
    githubAppId?: string;
    githubConfigured: boolean;
    s3Configured: boolean;
    executorConfigured: boolean;
  };
  pomerium: {
    enabled: boolean;
    internalUrl?: string;
    authenticateUrl?: string;
  };
  analytics: {
    enabled: boolean;
    endpoint?: string;
  };
}

/**
 * Check if Sites extension has all required services configured
 * Auto-detects based on presence of required configuration
 */
function isSitesExtensionAvailable(): boolean {
  // Sites extension is available if executor is configured
  // S3 and GitHub are optional but enhance functionality
  const hasExecutor = !!(
    process.env.SITES_EXECUTOR_ENDPOINT &&
    process.env.SITES_EXECUTOR_SECRET
  );

  const hasS3 = !!(
    process.env.SITES_S3_ENDPOINT &&
    process.env.SITES_S3_BUCKET &&
    process.env.SITES_S3_ACCESS_KEY &&
    process.env.SITES_S3_SECRET_KEY
  );

  // Sites extension is enabled if we have executor OR S3 configured
  // This allows for gradual setup
  return hasExecutor || hasS3;
}

/**
 * Check if Pomerium extension is available
 * Auto-detects based on presence of POMERIUM_INTERNAL_URL
 */
function isPomeriumExtensionAvailable(): boolean {
  return !!process.env.POMERIUM_INTERNAL_URL;
}

/**
 * Check if Analytics extension is available
 * Auto-detects based on presence of UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT
 */
function isAnalyticsExtensionAvailable(): boolean {
  return !!process.env.UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT;
}

/**
 * Get the current status of all extensions
 * Auto-detects based on service availability
 */
export function getExtensionStatus(): ExtensionStatus {
  return {
    sites: isSitesExtensionAvailable(),
    pomerium: isPomeriumExtensionAvailable(),
    analytics: isAnalyticsExtensionAvailable(),
  };
}

/**
 * Check if a specific extension is enabled
 */
export function isExtensionEnabled(extension: keyof ExtensionStatus): boolean {
  const status = getExtensionStatus();
  return status[extension];
}

/**
 * Get detailed configuration for extensions
 */
export function getExtensionConfig(): ExtensionConfig {
  return {
    sites: {
      executorEndpoint: process.env.SITES_EXECUTOR_ENDPOINT,
      executorSecret: process.env.SITES_EXECUTOR_SECRET
        ? "[CONFIGURED]"
        : undefined,
      s3Endpoint: process.env.SITES_S3_ENDPOINT,
      s3Bucket: process.env.SITES_S3_BUCKET,
      s3Region: process.env.SITES_S3_REGION,
      githubAppId: process.env.UNI_PROXY_MANAGER_GITHUB_APP_ID,
      githubConfigured: !!(
        process.env.UNI_PROXY_MANAGER_GITHUB_APP_ID &&
        process.env.UNI_PROXY_MANAGER_GITHUB_APP_PRIVATE_KEY
      ),
      s3Configured: !!(
        process.env.SITES_S3_ENDPOINT &&
        process.env.SITES_S3_BUCKET &&
        process.env.SITES_S3_ACCESS_KEY &&
        process.env.SITES_S3_SECRET_KEY
      ),
      executorConfigured: !!(
        process.env.SITES_EXECUTOR_ENDPOINT &&
        process.env.SITES_EXECUTOR_SECRET
      ),
    },
    pomerium: {
      enabled: isPomeriumExtensionAvailable(),
      internalUrl: process.env.POMERIUM_INTERNAL_URL,
      authenticateUrl: process.env.POMERIUM_AUTHENTICATE_URL,
    },
    analytics: {
      enabled: isAnalyticsExtensionAvailable(),
      endpoint: process.env.UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT,
    },
  };
}

/**
 * Validate that required configuration is present for an extension
 */
export function validateExtensionConfig(
  extension: keyof ExtensionStatus
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (extension === "sites") {
    const config = getExtensionConfig();

    if (!config.sites.executorConfigured && !config.sites.s3Configured) {
      errors.push(
        "Sites extension requires either executor or S3 storage to be configured"
      );
    }
  }

  if (extension === "pomerium") {
    const config = getExtensionConfig();

    if (!config.pomerium.internalUrl) {
      errors.push(
        "Pomerium extension requires POMERIUM_INTERNAL_URL to be configured"
      );
    }
  }

  if (extension === "analytics") {
    const config = getExtensionConfig();

    if (!config.analytics.endpoint) {
      errors.push(
        "Analytics extension requires UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT to be configured"
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
