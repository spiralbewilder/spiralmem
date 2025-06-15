# MCP Server Integration for Local Supermemory

## MCP Server Overview

The Model Context Protocol (MCP) server will expose supermemory functionality as tools that can be used by Claude and other AI assistants. This creates a powerful local memory system accessible through standardized protocols.

## Server Architecture

```typescript
// MCP Server Structure
interface SupermemoryMCPServer {
  tools: {
    memory: MemoryTools;
    video: VideoTools;
    search: SearchTools;
    analytics: AnalyticsTools;
    admin: AdminTools;
  };
  resources: {
    memories: MemoryResource[];
    videos: VideoResource[];
    spaces: SpaceResource[];
  };
}
```

## Tool Categories

### 1. Memory Management Tools

#### add_content
```typescript
{
  name: "add_content",
  description: "Add content to supermemory for future retrieval",
  inputSchema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "Content to add to memory"
      },
      source: {
        type: "string", 
        description: "Source of the content (url, file, manual)"
      },
      title: {
        type: "string",
        description: "Optional title for the content"
      },
      space: {
        type: "string",
        description: "Memory space to add content to",
        default: "default"
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags to associate with content"
      },
      metadata: {
        type: "object",
        description: "Additional metadata"
      }
    },
    required: ["content"]
  }
}
```

#### search_memory
```typescript
{
  name: "search_memory",
  description: "Search through stored memories using semantic search",
  inputSchema: {
    type: "object", 
    properties: {
      query: {
        type: "string",
        description: "Search query"
      },
      space: {
        type: "string",
        description: "Memory space to search in"
      },
      limit: {
        type: "number",
        description: "Maximum number of results",
        default: 10
      },
      filters: {
        type: "object",
        description: "Additional filters",
        properties: {
          dateRange: {
            type: "object",
            properties: {
              start: { type: "string", format: "date" },
              end: { type: "string", format: "date" }
            }
          },
          tags: {
            type: "array",
            items: { type: "string" }
          },
          contentType: {
            type: "string",
            enum: ["text", "video", "url", "document"]
          }
        }
      }
    },
    required: ["query"]
  }
}
```

#### get_memory
```typescript
{
  name: "get_memory",
  description: "Retrieve a specific memory by ID",
  inputSchema: {
    type: "object",
    properties: {
      memoryId: {
        type: "string",
        description: "Unique identifier of the memory"
      },
      includeContext: {
        type: "boolean", 
        description: "Include surrounding context",
        default: false
      }
    },
    required: ["memoryId"]
  }
}
```

#### delete_memory
```typescript
{
  name: "delete_memory",
  description: "Delete a memory from the system",
  inputSchema: {
    type: "object",
    properties: {
      memoryId: {
        type: "string",
        description: "Unique identifier of the memory to delete"
      }
    },
    required: ["memoryId"]
  }
}
```

### 2. Video Processing Tools

#### ingest_video
```typescript
{
  name: "ingest_video", 
  description: "Process and ingest a video file into memory",
  inputSchema: {
    type: "object",
    properties: {
      videoPath: {
        type: "string",
        description: "Path to the video file"
      },
      title: {
        type: "string",
        description: "Optional title for the video"
      },
      space: {
        type: "string", 
        description: "Memory space to add video to",
        default: "default"
      },
      options: {
        type: "object",
        description: "Processing options",
        properties: {
          transcriptionModel: {
            type: "string",
            enum: ["base", "small", "medium", "large"],
            default: "base"
          },
          extractFrames: {
            type: "boolean",
            default: true
          },
          frameInterval: {
            type: "number",
            description: "Frame extraction interval in seconds",
            default: 30
          },
          enableSpeakerDiarization: {
            type: "boolean",
            default: false
          }
        }
      },
      tags: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["videoPath"]
  }
}
```

#### search_video_content
```typescript
{
  name: "search_video_content",
  description: "Search within video transcripts and visual content",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string", 
        description: "Search query"
      },
      videoId: {
        type: "string",
        description: "Specific video ID to search within (optional)"
      },
      searchType: {
        type: "string",
        enum: ["transcript", "visual", "both"],
        default: "both"
      },
      timeRange: {
        type: "object",
        properties: {
          start: { type: "number" },
          end: { type: "number" }
        }
      }
    },
    required: ["query"]
  }
}
```

#### get_video_segment
```typescript
{
  name: "get_video_segment",
  description: "Retrieve a specific segment of video content",
  inputSchema: {
    type: "object",
    properties: {
      videoId: {
        type: "string",
        description: "Video ID"
      },
      startTime: {
        type: "number",
        description: "Start time in seconds"
      },
      endTime: {
        type: "number", 
        description: "End time in seconds"
      },
      includeTranscript: {
        type: "boolean",
        default: true
      },
      includeFrames: {
        type: "boolean",
        default: false
      }
    },
    required: ["videoId", "startTime", "endTime"]
  }
}
```

#### get_processing_status
```typescript
{
  name: "get_processing_status",
  description: "Check the status of video processing jobs",
  inputSchema: {
    type: "object",
    properties: {
      jobId: {
        type: "string",
        description: "Processing job ID (optional)"
      }
    }
  }
}
```

### 3. Advanced Search Tools

#### semantic_search
```typescript
{
  name: "semantic_search",
  description: "Advanced semantic search across all content types",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language search query"
      },
      searchMode: {
        type: "string",
        enum: ["semantic", "keyword", "hybrid"],
        default: "hybrid"
      },
      spaces: {
        type: "array", 
        items: { type: "string" },
        description: "Memory spaces to search"
      },
      contentTypes: {
        type: "array",
        items: { 
          type: "string",
          enum: ["text", "video", "url", "document", "image"]
        }
      },
      similarityThreshold: {
        type: "number",
        minimum: 0,
        maximum: 1,
        default: 0.7
      },
      maxResults: {
        type: "number",
        default: 20
      },
      includeContext: {
        type: "boolean",
        default: true
      }
    },
    required: ["query"]
  }
}
```

#### find_related_content
```typescript
{
  name: "find_related_content", 
  description: "Find content related to a specific memory or concept",
  inputSchema: {
    type: "object",
    properties: {
      referenceId: {
        type: "string",
        description: "ID of reference content"
      },
      concept: {
        type: "string",
        description: "Concept to find related content for"
      },
      relationshipType: {
        type: "string",
        enum: ["similar", "contrasting", "causal", "temporal"],
        default: "similar"
      },
      maxResults: {
        type: "number",
        default: 10  
      }
    }
  }
}
```

### 4. Tool Execution Framework

#### execute_code_against_memory
```typescript
{
  name: "execute_code_against_memory",
  description: "Execute code tools against stored memory content",
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "Code to execute"
      },
      language: {
        type: "string", 
        enum: ["python", "javascript", "sql"],
        default: "python"
      },
      memoryQuery: {
        type: "string",
        description: "Query to select relevant memories"
      },
      timeout: {
        type: "number",
        description: "Execution timeout in seconds",
        default: 30
      }
    },
    required: ["code", "memoryQuery"]
  }
}
```

#### analyze_content_trends
```typescript
{
  name: "analyze_content_trends",
  description: "Analyze trends and patterns in stored content",
  inputSchema: {
    type: "object",
    properties: {
      analysisType: {
        type: "string",
        enum: ["temporal", "topical", "sentiment", "frequency"],
        default: "topical"
      },
      timeframe: {
        type: "object",
        properties: {
          start: { type: "string", format: "date" },
          end: { type: "string", format: "date" }
        }
      },
      groupBy: {
        type: "string",
        enum: ["day", "week", "month", "tag", "space"]
      },
      filters: {
        type: "object"
      }
    },
    required: ["analysisType"]
  }
}
```

### 5. Space Management Tools

#### create_space
```typescript
{
  name: "create_space",
  description: "Create a new memory space for organizing content",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the memory space"
      },
      description: {
        type: "string",
        description: "Description of the space purpose"
      },
      settings: {
        type: "object",
        properties: {
          retentionPolicy: { type: "string" },
          embeddingModel: { type: "string" },
          autoTagging: { type: "boolean" }
        }
      }
    },
    required: ["name"]
  }
}
```

#### list_spaces
```typescript
{
  name: "list_spaces",
  description: "List all available memory spaces",
  inputSchema: {
    type: "object",
    properties: {
      includeStats: {
        type: "boolean",
        default: true
      }
    }
  }
}
```

### 6. Analytics & Monitoring Tools

#### get_memory_stats
```typescript
{
  name: "get_memory_stats",
  description: "Get statistics about memory usage and performance",
  inputSchema: {
    type: "object",
    properties: {
      space: {
        type: "string",
        description: "Specific space to get stats for"
      },
      timeframe: {
        type: "string",
        enum: ["day", "week", "month", "all"],
        default: "all"
      }
    }
  }
}
```

#### export_memories
```typescript
{
  name: "export_memories",
  description: "Export memories in various formats",
  inputSchema: {
    type: "object", 
    properties: {
      format: {
        type: "string",
        enum: ["json", "csv", "markdown"],
        default: "json"
      },
      space: {
        type: "string"
      },
      filters: {
        type: "object"
      },
      includeEmbeddings: {
        type: "boolean",
        default: false
      }
    },
    required: ["format"]
  }
}
```

## Server Implementation

### Core Server Class
```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

class SupermemoryMCPServer {
  private server: Server;
  private memoryEngine: MemoryEngine;
  private videoProcessor: VideoProcessor;
  
  constructor() {
    this.server = new Server(
      {
        name: "supermemory-local",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );
    
    this.setupTools();
    this.setupResources();
  }
  
  private setupTools() {
    // Memory tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // All tool definitions from above
      ],
    }));
    
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case "add_content":
          return await this.handleAddContent(request.params.arguments);
        case "search_memory":
          return await this.handleSearchMemory(request.params.arguments);
        case "ingest_video":
          return await this.handleIngestVideo(request.params.arguments);
        // ... other tool handlers
        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    });
  }
  
  private async handleAddContent(args: any) {
    const { content, source, title, space, tags, metadata } = args;
    
    try {
      const memoryId = await this.memoryEngine.addContent({
        content,
        source,
        title,
        space: space || 'default',
        tags: tags || [],
        metadata: metadata || {}
      });
      
      return {
        content: [{
          type: "text",
          text: `Content added successfully. Memory ID: ${memoryId}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text", 
          text: `Error adding content: ${error.message}`
        }],
        isError: true
      };
    }
  }
  
  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
```

### Resource Definitions

#### Memory Resources
```typescript
{
  uri: "memory://spaces",
  mimeType: "application/json",
  name: "Memory Spaces",
  description: "Available memory spaces"
}

{
  uri: "memory://recent", 
  mimeType: "application/json",
  name: "Recent Memories",
  description: "Recently added memories"
}

{
  uri: "memory://videos",
  mimeType: "application/json", 
  name: "Video Memories",
  description: "Processed video content"
}
```

## Configuration

### Server Configuration
```typescript
interface ServerConfig {
  database: {
    path: string;
    vectorStore: 'sqlite-vss' | 'chroma';
  };
  video: {
    processingQueue: {
      maxConcurrent: number;
      maxRetries: number;
    };
    whisper: {
      model: 'base' | 'small' | 'medium' | 'large';
      device: 'cpu' | 'gpu';
    };
  };
  embeddings: {
    model: string;
    dimensions: number;
    batchSize: number;
  };
  server: {
    name: string;
    version: string;
    maxMemoryMB: number;
  };
}
```

## Usage Examples

### Adding Content
```typescript
// Via MCP tool call
{
  "name": "add_content",
  "arguments": {
    "content": "Important meeting notes about Q4 planning",
    "title": "Q4 Planning Meeting",
    "space": "work",
    "tags": ["meeting", "planning", "q4"],
    "source": "manual"
  }
}
```

### Video Processing
```typescript
// Ingest video
{
  "name": "ingest_video",
  "arguments": {
    "videoPath": "/path/to/meeting.mp4",
    "title": "Team Standup - Dec 15",
    "space": "meetings",
    "options": {
      "transcriptionModel": "small",
      "frameInterval": 60
    }
  }
}
```

### Advanced Search
```typescript
// Semantic search
{
  "name": "semantic_search", 
  "arguments": {
    "query": "What did we discuss about the new product launch?",
    "searchMode": "hybrid",
    "contentTypes": ["video", "text"],
    "maxResults": 15
  }
}
```

## Security & Privacy

### Local-First Security
- All data stays on local machine
- No external API calls for core functionality
- Configurable data retention policies
- Optional encryption at rest

### Access Control
- Space-based access control
- Tool-level permissions
- Resource access restrictions
- Audit logging capabilities

## Performance Optimizations

### Caching Strategy
- In-memory cache for frequent queries
- Disk-based cache for embeddings
- Smart prefetching based on usage patterns

### Resource Management
- Memory usage monitoring
- Processing queue prioritization
- Automatic cleanup of temporary files
- Configurable resource limits

This MCP server design provides comprehensive access to supermemory functionality while maintaining the local-first, privacy-focused approach.