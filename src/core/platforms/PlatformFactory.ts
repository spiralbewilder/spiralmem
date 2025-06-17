import { PlatformConnector } from './PlatformConnector.js';

// Import platform-specific connectors
import { YouTubeConnector } from './connectors/YouTubeConnector.js';
// import { SpotifyConnector } from './connectors/SpotifyConnector.js';
// import { ZoomConnector } from './connectors/ZoomConnector.js';
// import { TeamsConnector } from './connectors/TeamsConnector.js';
// import { VimeoConnector } from './connectors/VimeoConnector.js';

export interface PlatformConfig {
  platform: string;
  enabled: boolean;
  credentials?: Record<string, any>;
  rateLimits?: {
    requestsPerMinute?: number;
    requestsPerHour?: number;
    requestsPerDay?: number;
  };
  options?: Record<string, any>;
}

export interface PlatformRegistry {
  [platform: string]: {
    connectorClass: new (credentials?: Record<string, any>) => PlatformConnector;
    defaultConfig: PlatformConfig;
    urlPatterns: RegExp[];
  };
}

/**
 * Factory class for creating and managing platform connectors
 * Provides centralized platform detection, connector creation, and configuration management
 */
export class PlatformFactory {
  private static instance: PlatformFactory;
  private registry: PlatformRegistry = {};
  private activeConnectors: Map<string, PlatformConnector> = new Map();
  private platformConfigs: Map<string, PlatformConfig> = new Map();

  private constructor() {
    this.initializeRegistry();
  }

  public static getInstance(): PlatformFactory {
    if (!PlatformFactory.instance) {
      PlatformFactory.instance = new PlatformFactory();
    }
    return PlatformFactory.instance;
  }

  /**
   * Initialize the platform registry with available connectors
   */
  private initializeRegistry(): void {
    // YouTube configuration
    this.registry.youtube = {
      connectorClass: YouTubeConnector,
      defaultConfig: {
        platform: 'youtube',
        enabled: true,
        rateLimits: {
          requestsPerMinute: 100,
          requestsPerHour: 10000,
          requestsPerDay: 1000000
        }
      },
      urlPatterns: [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/
      ]
    };

    // Spotify configuration
    this.registry.spotify = {
      connectorClass: null as any,
      defaultConfig: {
        platform: 'spotify',
        enabled: false, // Disabled by default until implemented
        rateLimits: {
          requestsPerMinute: 100,
          requestsPerHour: 1000,
          requestsPerDay: 10000
        }
      },
      urlPatterns: [
        /spotify\.com\/.+\/([a-zA-Z0-9]{22})/
      ]
    };

    // Zoom configuration
    this.registry.zoom = {
      connectorClass: null as any,
      defaultConfig: {
        platform: 'zoom',
        enabled: false,
        rateLimits: {
          requestsPerMinute: 10,
          requestsPerHour: 100,
          requestsPerDay: 1000
        }
      },
      urlPatterns: [
        /zoom\.us\/rec\/share\/([a-zA-Z0-9_-]+)/
      ]
    };

    // Teams configuration
    this.registry.teams = {
      connectorClass: null as any,
      defaultConfig: {
        platform: 'teams',
        enabled: false,
        rateLimits: {
          requestsPerMinute: 10,
          requestsPerHour: 100,
          requestsPerDay: 1000
        }
      },
      urlPatterns: [
        /teams\.microsoft\.com.+\/([a-zA-Z0-9_-]+)/
      ]
    };

    // Vimeo configuration
    this.registry.vimeo = {
      connectorClass: null as any,
      defaultConfig: {
        platform: 'vimeo',
        enabled: false,
        rateLimits: {
          requestsPerMinute: 30,
          requestsPerHour: 1000,
          requestsPerDay: 5000
        }
      },
      urlPatterns: [
        /vimeo\.com\/(\d+)/
      ]
    };
  }

  /**
   * Detect platform from URL
   */
  detectPlatform(url: string): string | null {
    for (const [platform, config] of Object.entries(this.registry)) {
      for (const pattern of config.urlPatterns) {
        if (pattern.test(url)) {
          return platform;
        }
      }
    }
    return null;
  }

  /**
   * Validate if a URL is supported by any platform
   */
  isUrlSupported(url: string): boolean {
    return this.detectPlatform(url) !== null;
  }

  /**
   * Get all supported platforms
   */
  getSupportedPlatforms(): string[] {
    return Object.keys(this.registry);
  }

  /**
   * Get enabled platforms
   */
  getEnabledPlatforms(): string[] {
    return Array.from(this.platformConfigs.entries())
      .filter(([, config]) => config.enabled)
      .map(([platform]) => platform);
  }

  /**
   * Create or get existing connector for a platform
   */
  async createConnector(platform: string, credentials?: Record<string, any>): Promise<PlatformConnector> {
    const platformLower = platform.toLowerCase();
    
    if (!this.registry[platformLower]) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    const config = this.getPlatformConfig(platformLower);
    if (!config.enabled) {
      throw new Error(`Platform ${platform} is disabled`);
    }

    // Check if we already have an active connector
    const existingConnector = this.activeConnectors.get(platformLower);
    if (existingConnector && !credentials) {
      return existingConnector;
    }

    // Create new connector
    const ConnectorClass = this.registry[platformLower].connectorClass;
    if (!ConnectorClass) {
      throw new Error(`Connector for platform ${platform} is not implemented yet`);
    }

    const finalCredentials = credentials || config.credentials || {};
    const connector = new ConnectorClass(finalCredentials);

    // Apply rate limits from config
    if (config.rateLimits) {
      connector.updateRateLimits({
        requestsPerMinute: config.rateLimits.requestsPerMinute || 60,
        requestsPerHour: config.rateLimits.requestsPerHour || 1000,
        requestsPerDay: config.rateLimits.requestsPerDay || 10000,
        currentMinuteUsage: 0,
        currentHourUsage: 0,
        currentDayUsage: 0,
        resetTimes: {
          nextMinute: new Date(Date.now() + 60000),
          nextHour: new Date(Date.now() + 3600000),
          nextDay: new Date(Date.now() + 86400000),
        }
      });
    }

    this.activeConnectors.set(platformLower, connector);
    return connector;
  }

  /**
   * Create connector from URL (auto-detect platform)
   */
  async createConnectorFromUrl(url: string, credentials?: Record<string, any>): Promise<PlatformConnector> {
    const platform = this.detectPlatform(url);
    if (!platform) {
      throw new Error(`No supported platform detected for URL: ${url}`);
    }
    return this.createConnector(platform, credentials);
  }

  /**
   * Configure a platform
   */
  configurePlatform(platform: string, config: Partial<PlatformConfig>): void {
    const platformLower = platform.toLowerCase();
    
    if (!this.registry[platformLower]) {
      throw new Error(`Unknown platform: ${platform}`);
    }

    const currentConfig = this.getPlatformConfig(platformLower);
    const newConfig: PlatformConfig = {
      ...currentConfig,
      ...config,
      platform: platformLower
    };

    this.platformConfigs.set(platformLower, newConfig);

    // Update active connector if exists
    const activeConnector = this.activeConnectors.get(platformLower);
    if (activeConnector) {
      if (config.credentials) {
        activeConnector.updateCredentials(config.credentials);
      }
      if (config.rateLimits) {
        activeConnector.updateRateLimits({
          requestsPerMinute: config.rateLimits.requestsPerMinute || 60,
          requestsPerHour: config.rateLimits.requestsPerHour || 1000,
          requestsPerDay: config.rateLimits.requestsPerDay || 10000,
          currentMinuteUsage: 0,
          currentHourUsage: 0,
          currentDayUsage: 0,
          resetTimes: {
            nextMinute: new Date(Date.now() + 60000),
            nextHour: new Date(Date.now() + 3600000),
            nextDay: new Date(Date.now() + 86400000),
          }
        });
      }
    }
  }

  /**
   * Get platform configuration
   */
  getPlatformConfig(platform: string): PlatformConfig {
    const platformLower = platform.toLowerCase();
    return this.platformConfigs.get(platformLower) || this.registry[platformLower]?.defaultConfig || {
      platform: platformLower,
      enabled: false
    };
  }

  /**
   * Enable/disable a platform
   */
  setPlatformEnabled(platform: string, enabled: boolean): void {
    this.configurePlatform(platform, { enabled });
  }

  /**
   * Get platform capabilities
   */
  getPlatformCapabilities(platform: string): any {
    const platformLower = platform.toLowerCase();
    const connector = this.activeConnectors.get(platformLower);
    return connector?.capabilities || null;
  }

  /**
   * Health check for all active connectors
   */
  async healthCheckAll(): Promise<Record<string, any>> {
    const results: Record<string, any> = {};
    
    for (const [platform, connector] of this.activeConnectors) {
      try {
        results[platform] = await connector.healthCheck();
      } catch (error) {
        results[platform] = {
          platform,
          isHealthy: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    return results;
  }

  /**
   * Close all active connectors
   */
  async closeAll(): Promise<void> {
    // Close any platform-specific resources
    this.activeConnectors.clear();
  }

  /**
   * Register a new platform connector (for extensibility)
   */
  registerPlatform(
    platform: string, 
    connectorClass: new (credentials?: Record<string, any>) => PlatformConnector,
    config: PlatformConfig,
    urlPatterns: RegExp[]
  ): void {
    const platformLower = platform.toLowerCase();
    
    this.registry[platformLower] = {
      connectorClass,
      defaultConfig: config,
      urlPatterns
    };

    // Set default configuration
    this.platformConfigs.set(platformLower, config);
  }

  /**
   * Extract video ID from URL using appropriate platform connector
   */
  extractVideoId(url: string): string {
    const platform = this.detectPlatform(url);
    if (!platform) {
      throw new Error(`No supported platform detected for URL: ${url}`);
    }

    const config = this.registry[platform];
    for (const pattern of config.urlPatterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    throw new Error(`Could not extract video ID from URL: ${url}`);
  }

  /**
   * Validate URL format for a specific platform
   */
  validateUrl(url: string, platform?: string): boolean {
    if (platform) {
      const platformLower = platform.toLowerCase();
      const config = this.registry[platformLower];
      if (!config) return false;
      
      return config.urlPatterns.some(pattern => pattern.test(url));
    }

    return this.isUrlSupported(url);
  }

  /**
   * Get statistics about platform usage
   */
  getStatistics(): {
    supportedPlatforms: number;
    enabledPlatforms: number;
    activeConnectors: number;
    platformBreakdown: Record<string, { enabled: boolean; active: boolean }>;
  } {
    const platformBreakdown: Record<string, { enabled: boolean; active: boolean }> = {};
    
    for (const platform of this.getSupportedPlatforms()) {
      const config = this.getPlatformConfig(platform);
      platformBreakdown[platform] = {
        enabled: config.enabled,
        active: this.activeConnectors.has(platform)
      };
    }

    return {
      supportedPlatforms: this.getSupportedPlatforms().length,
      enabledPlatforms: this.getEnabledPlatforms().length,
      activeConnectors: this.activeConnectors.size,
      platformBreakdown
    };
  }
}