#!/usr/bin/env node

import { Command } from 'commander';
import { MemoryEngine } from '../core/MemoryEngine.js';
import { VideoWorkflow } from '../core/workflow/VideoWorkflow.js';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const program = new Command();

// Package information
program
  .name('spiralmem')
  .description('Spiralmem Video Memory System - Transform videos into searchable memories')
  .version('1.0.0');

// Global options
program
  .option('-c, --config <path>', 'Configuration file path')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-q, --quiet', 'Suppress non-error output');

// Initialize command
program
  .command('init')
  .description('Initialize Spiralmem system and database')
  .option('--test-mode', 'Initialize in test mode')
  .option('--force', 'Force re-initialization')
  .action(async (options) => {
    try {
      const config = loadConfig(program.opts().config);
      
      if (!program.opts().quiet) {
        console.log('🎬 Initializing Spiralmem Video Memory System...');
      }
      
      const engine = new MemoryEngine();
      await engine.initialize();
      
      // Create default space if it doesn't exist
      const spaces = await engine.listSpaces();
      if (spaces.length === 0) {
        await engine.createSpace('default', { description: 'Default memory space' });
        if (!program.opts().quiet) {
          console.log('✅ Created default memory space');
        }
      }
      
      if (!program.opts().quiet) {
        console.log('✅ Spiralmem system initialized successfully');
        console.log('');
        console.log('Next steps:');
        console.log('  spiralmem add-video path/to/video.mp4  # Add your first video');
        console.log('  spiralmem search "your query"          # Search your content');
        console.log('  spiralmem --help                       # See all commands');
      }
      
    } catch (error) {
      console.error('❌ Initialization failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Add video command
program
  .command('add-video <path>')
  .description('Process and add a video file to memory')
  .option('-s, --space <name>', 'Target space name', 'default')
  .option('-t, --title <title>', 'Custom title for the video')
  .option('--model <model>', 'Whisper model to use', 'base')
  .option('--no-transcription', 'Skip transcription')
  .action(async (videoPath, options) => {
    try {
      if (!program.opts().quiet) {
        console.log(`🎥 Processing video: ${path.basename(videoPath)}`);
      }
      
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const workflow = new VideoWorkflow();
      
      const result = await workflow.processVideo(videoPath, options.space, {
        enableTranscription: options.transcription
      });
      
      if (!program.opts().quiet) {
        console.log('✅ Video processed successfully');
        console.log(`   Memory ID: ${result.memoryId}`);
        console.log(`   Processing time: ${result.processingTime}ms`);
        if (result.outputs.chunksGenerated) {
          console.log(`   Chunks generated: ${result.outputs.chunksGenerated}`);
        }
      }
      
    } catch (error) {
      console.error('❌ Video processing failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Search command
program
  .command('search <query>')
  .description('Search across all memories')
  .option('-s, --space <name>', 'Search within specific space')
  .option('-l, --limit <number>', 'Maximum number of results', '10')
  .option('--json', 'Output results as JSON')
  .action(async (query, options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const searchQuery = {
        query: query,
        spaceId: options.space,
        limit: parseInt(options.limit)
      };
      
      const results = await engine.searchMemories(searchQuery);
      
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log('🔍 No results found for:', query);
        } else {
          console.log(`🔍 Found ${results.length} result(s) for: ${query}`);
          console.log('');
          
          results.forEach((result, index) => {
            console.log(`${index + 1}. ${result.memory.title || 'Untitled'}`);
            console.log(`   Type: ${result.memory.contentType}`);
            console.log(`   Space: ${result.memory.spaceId}`);
            console.log(`   Source: ${result.memory.source}`);
            if (result.chunk) {
              console.log(`   Match: "${result.chunk.chunkText.substring(0, 100)}..."`);
            }
            console.log('');
          });
        }
      }
      
    } catch (error) {
      console.error('❌ Search failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// List spaces command
program
  .command('spaces')
  .description('List all memory spaces')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const spaces = await engine.listSpaces();
      
      if (options.json) {
        console.log(JSON.stringify(spaces, null, 2));
      } else {
        if (spaces.length === 0) {
          console.log('📁 No spaces found. Create one with: spiralmem create-space <name>');
        } else {
          console.log('📁 Memory Spaces:');
          console.log('');
          spaces.forEach(space => {
            console.log(`  ${space.name}`);
            if (space.description) {
              console.log(`    ${space.description}`);
            }
            console.log(`    Created: ${space.createdAt}`);
            console.log('');
          });
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to list spaces:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Create space command
program
  .command('create-space <name>')
  .description('Create a new memory space')
  .option('-d, --description <text>', 'Space description')
  .action(async (name, options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const spaceId = await engine.createSpace(name, {
        description: options.description
      });
      
      if (!program.opts().quiet) {
        console.log(`✅ Created space: ${name}`);
        console.log(`   Space ID: ${spaceId}`);
      }
      
    } catch (error) {
      console.error('❌ Failed to create space:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Stats command
program
  .command('stats')
  .description('Show system statistics')
  .option('-s, --space <name>', 'Statistics for specific space')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const stats = await engine.getStats(options.space);
      
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log('📊 Spiralmem Statistics');
        console.log('');
        console.log(`Total Memories: ${stats.totalMemories}`);
        console.log(`Total Chunks: ${stats.totalChunks}`);
        console.log(`Total Spaces: ${stats.totalSpaces}`);
        
        if (stats.contentTypeBreakdown) {
          console.log('');
          console.log('Content Types:');
          Object.entries(stats.contentTypeBreakdown).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
          });
        }
        
        console.log('');
        console.log('Recent Activity:');
        console.log(`  Memories added: ${stats.recentActivity.memoriesAdded}`);
        console.log(`  Videos processed: ${stats.recentActivity.videosProcessed}`);
        console.log(`  Searches performed: ${stats.recentActivity.searchesPerformed}`);
      }
      
    } catch (error) {
      console.error('❌ Failed to get statistics:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Export command
program
  .command('export <path>')
  .description('Export memories to file')
  .option('-s, --space <name>', 'Export specific space only')
  .option('-f, --format <format>', 'Export format (json, csv)', 'json')
  .action(async (exportPath, options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      if (!program.opts().quiet) {
        console.log('📤 Exporting memories...');
      }
      
      const exportData = await engine.exportData({
        spaceId: options.space,
        format: options.format
      });
      
      await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2));
      
      if (!program.opts().quiet) {
        console.log(`✅ Exported ${exportData.memories.length} memories to ${exportPath}`);
      }
      
    } catch (error) {
      console.error('❌ Export failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Serve MCP command
program
  .command('serve-mcp')
  .description('Start MCP server for AI assistant integration')
  .option('-p, --port <port>', 'Server port', '8080')
  .option('--host <host>', 'Server host', 'localhost')
  .action(async (options) => {
    try {
      if (!program.opts().quiet) {
        console.log(`🤖 Starting MCP server on ${options.host}:${options.port}...`);
      }
      
      // Start the MCP server
      const mcpProcess = spawn('node', ['dist/mcp/server.js'], {
        stdio: 'inherit',
        env: {
          ...process.env,
          PORT: options.port,
          HOST: options.host
        }
      });
      
      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down MCP server...');
        mcpProcess.kill('SIGINT');
        process.exit(0);
      });
      
      mcpProcess.on('exit', (code) => {
        if (code !== 0) {
          console.error(`❌ MCP server exited with code ${code}`);
          process.exit(1);
        }
      });
      
    } catch (error) {
      console.error('❌ Failed to start MCP server:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// System check command
program
  .command('check')
  .description('Check system health and dependencies')
  .action(async () => {
    try {
      console.log('🔧 Checking Spiralmem system health...');
      console.log('');
      
      const checks = [
        {
          name: 'Node.js',
          check: async () => {
            const version = process.version;
            const major = parseInt(version.slice(1).split('.')[0]);
            return { success: major >= 18, info: version };
          }
        },
        {
          name: 'Python',
          check: async () => {
            try {
              const { spawn } = await import('child_process');
              return new Promise((resolve) => {
                const proc = spawn('python3', ['--version']);
                let output = '';
                proc.stdout.on('data', (data) => output += data.toString());
                proc.stderr.on('data', (data) => output += data.toString());
                proc.on('close', (code) => {
                  resolve({ success: code === 0, info: output.trim() });
                });
              });
            } catch {
              return { success: false, info: 'Not found' };
            }
          }
        },
        {
          name: 'FFmpeg',
          check: async () => {
            try {
              const { spawn } = await import('child_process');
              return new Promise((resolve) => {
                const proc = spawn('ffmpeg', ['-version']);
                let output = '';
                proc.stdout.on('data', (data) => output += data.toString());
                proc.on('close', (code) => {
                  const version = output.split('\n')[0];
                  resolve({ success: code === 0, info: version });
                });
              });
            } catch {
              return { success: false, info: 'Not found' };
            }
          }
        },
        {
          name: 'faster_whisper',
          check: async () => {
            try {
              const { spawn } = await import('child_process');
              return new Promise((resolve) => {
                const proc = spawn('python3', ['-c', 'import faster_whisper; print("Available")']);
                let output = '';
                proc.stdout.on('data', (data) => output += data.toString());
                proc.stderr.on('data', (data) => output += data.toString());
                proc.on('close', (code) => {
                  const result = { success: code === 0, info: output.trim() || 'Available' };
                  resolve(result);
                });
              });
            } catch {
              return { success: false, info: 'Not installed' };
            }
          }
        },
        {
          name: 'Database',
          check: async () => {
            try {
              const engine = new MemoryEngine();
              await engine.initialize();
              return { success: true, info: 'Connected' };
            } catch (error) {
              return { success: false, info: error instanceof Error ? error.message : 'Failed' };
            }
          }
        }
      ];
      
      let allPassed = true;
      
      for (const check of checks) {
        const result = await check.check() as { success: boolean; info: string };
        const status = result.success ? '✅' : '❌';
        console.log(`${status} ${check.name}: ${result.info}`);
        if (!result.success) allPassed = false;
      }
      
      console.log('');
      if (allPassed) {
        console.log('✅ All system checks passed! Spiralmem is ready to use.');
      } else {
        console.log('❌ Some system checks failed. Please install missing dependencies.');
        process.exit(1);
      }
      
    } catch (error) {
      console.error('❌ System check failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Config validation command
program
  .command('config')
  .description('Validate and show configuration')
  .option('--validate', 'Validate configuration only')
  .action(async (options) => {
    try {
      const config = loadConfig(program.opts().config);
      
      if (options.validate) {
        console.log('✅ Configuration is valid');
      } else {
        console.log('📋 Current Configuration:');
        console.log('');
        console.log(JSON.stringify(config, null, 2));
      }
      
    } catch (error) {
      console.error('❌ Configuration error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Handle unknown commands
program.on('command:*', () => {
  console.error('❌ Unknown command:', program.args.join(' '));
  console.log('Run "spiralmem --help" for available commands');
  process.exit(1);
});

// Setup global error handling
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});

// Parse arguments and execute
if (require.main === module) {
  // Configure logging based on CLI options
  if (process.argv.includes('--verbose')) {
    logger.level = 'debug';
  } else if (process.argv.includes('--quiet')) {
    logger.level = 'error';
  }
  
  program.parse();
}

export { program };