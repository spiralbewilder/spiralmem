import { z } from 'zod';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration schema
const ConfigSchema = z.object({
  database: z.object({
    path: z.string().default('./data/spiralmem.db'),
    vectorStore: z.enum(['sqlite-vss']).default('sqlite-vss'),
    backup: z.object({
      enabled: z.boolean().default(true),
      interval: z.string().default('24h'),
      retention: z.string().default('30d'),
    }),
  }),
  
  video: z.object({
    processing: z.object({
      maxConcurrent: z.number().default(2),
      maxFileSize: z.string().default('2GB'),
      tempDir: z.string().default('./data/temp'),
    }),
    whisper: z.object({
      model: z.enum(['base', 'small', 'medium', 'large']).default('base'),
      device: z.enum(['cpu', 'gpu']).default('cpu'),
      language: z.string().default('auto'),
    }),
    frames: z.object({
      extractionInterval: z.number().default(30),
      format: z.enum(['jpg', 'png']).default('jpg'),
      quality: z.number().min(1).max(100).default(85),
    }),
  }),
  
  embeddings: z.object({
    model: z.string().default('all-MiniLM-L6-v2'),
    dimensions: z.number().default(384),
    device: z.enum(['cpu', 'gpu']).default('cpu'),
    batchSize: z.number().default(32),
  }),
  
  server: z.object({
    mcp: z.object({
      enabled: z.boolean().default(true),
      name: z.string().default('spiralmem-local'),
      port: z.number().optional(),
    }),
    api: z.object({
      enabled: z.boolean().default(false),
      port: z.number().default(3000),
      host: z.string().default('localhost'),
    }),
  }),
  
  storage: z.object({
    maxMemoryMB: z.number().default(1024),
    cacheSize: z.number().default(100),
    tempRetention: z.string().default('7d'),
  }),
  
  logging: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    file: z.string().default('./logs/spiralmem.log'),
    maxFiles: z.number().default(10),
    maxSize: z.string().default('10MB'),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigManager {
  private static instance: ConfigManager;
  private config: Config;
  
  private constructor() {
    this.config = this.loadConfig();
  }
  
  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }
  
  private loadConfig(): Config {
    const configPaths = [
      process.env.SPIRALMEM_CONFIG,
      './config.yaml',
      './config/config.yaml',
      path.join(__dirname, '../../config/config.yaml'),
    ].filter(Boolean);
    
    // Try to load from file
    for (const configPath of configPaths) {
      if (configPath && fs.existsSync(configPath)) {
        try {
          const fileContent = fs.readFileSync(configPath, 'utf8');
          const yamlConfig = yaml.load(fileContent) as any;
          return ConfigSchema.parse(yamlConfig);
        } catch (error) {
          console.warn(`Failed to load config from ${configPath}:`, error);
        }
      }
    }
    
    // Fall back to defaults with environment variable overrides
    const envConfig = this.loadFromEnvironment();
    return ConfigSchema.parse(envConfig);
  }
  
  private loadFromEnvironment(): Partial<Config> {
    // For now, return minimal environment overrides
    // The defaults from defaultConfig will handle the rest
    return {};
  }
  
  public get(): Config {
    return this.config;
  }
  
  public reload(): Config {
    this.config = this.loadConfig();
    return this.config;
  }
  
  public validate(): boolean {
    try {
      ConfigSchema.parse(this.config);
      return true;
    } catch (error) {
      console.error('Configuration validation failed:', error);
      return false;
    }
  }
  
  // Helper methods for commonly accessed config values
  public getDatabasePath(): string {
    return path.resolve(this.config.database.path);
  }
  
  public getDataDir(): string {
    return path.dirname(this.getDatabasePath());
  }
  
  public getTempDir(): string {
    return path.resolve(this.config.video.processing.tempDir);
  }
  
  public getLogFile(): string {
    return path.resolve(this.config.logging.file);
  }
}

// Export singleton instance
export const config = ConfigManager.getInstance();

// Export convenience function for CLI usage
export function loadConfig(configPath?: string): Config {
  if (configPath) {
    process.env.SPIRALMEM_CONFIG = configPath;
  }
  return ConfigManager.getInstance().reload();
}