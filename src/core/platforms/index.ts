export { PlatformConnector } from './PlatformConnector.js';
export { PlatformFactory } from './PlatformFactory.js';
export type {
  RateLimitInfo,
  PlatformVideoMetadata,
  TranscriptData,
  PlatformCapabilities
} from './PlatformConnector.js';
export type {
  PlatformConfig,
  PlatformRegistry
} from './PlatformFactory.js';

// Platform-specific connectors
export { YouTubeConnector, YouTubeDeepLinkGenerator } from './connectors/index.js';
export type { YouTubeDeepLinkOptions, YouTubeTimestampRange } from './connectors/index.js';