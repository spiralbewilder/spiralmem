import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';
import { ContentChunk } from './ContentChunker.js';

export interface EmbeddingOptions {
  model?: 'openai' | 'sentence-transformers' | 'all-MiniLM-L6-v2';
  batchSize?: number; // Process chunks in batches
  maxRetries?: number;
  timeout?: number; // ms
  apiKey?: string; // For OpenAI
  dimensions?: number; // Expected embedding dimensions
}

export interface EmbeddingResult {
  success: boolean;
  chunksProcessed: number;
  embeddings: ChunkEmbedding[];
  processingTime: number; // ms
  errors: string[];
  warnings: string[];
  
  // Performance metrics
  embeddingsPerSecond: number;
  totalTokensProcessed: number;
  averageEmbeddingTime: number;
}

export interface ChunkEmbedding {
  chunkId: string;
  embedding: number[];
  dimensions: number;
  model: string;
  processingTime: number; // ms for this specific embedding
}

/**
 * Embedding generation system for converting text chunks to vector embeddings
 * Supports multiple embedding models and batch processing
 */
export class EmbeddingGenerator {
  private static readonly DEFAULT_TIMEOUT = 120000; // 2 minutes
  private performanceMonitor: PerformanceMonitor;

  constructor() {
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Generate embeddings for content chunks
   */
  async generateEmbeddings(
    chunks: ContentChunk[],
    options: EmbeddingOptions = {}
  ): Promise<EmbeddingResult> {
    const operationId = `generateEmbeddings-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    const startTime = Date.now();

    const opts = this.getDefaultOptions(options);
    const result: EmbeddingResult = {
      success: false,
      chunksProcessed: 0,
      embeddings: [],
      processingTime: 0,
      errors: [],
      warnings: [],
      embeddingsPerSecond: 0,
      totalTokensProcessed: 0,
      averageEmbeddingTime: 0
    };

    try {
      logger.info(`Starting embedding generation for ${chunks.length} chunks using ${opts.model}`);

      // Step 1: Validate chunks
      if (chunks.length === 0) {
        result.errors.push('No chunks provided for embedding generation');
        return result;
      }

      // Step 2: Check model availability
      await this.validateModel(opts.model);

      // Step 3: Process chunks in batches
      const embeddings: ChunkEmbedding[] = [];
      const batches = this.createBatches(chunks, opts.batchSize);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Processing batch ${i + 1}/${batches.length} (${batch.length} chunks)`);

        try {
          const batchEmbeddings = await this.processBatch(batch, opts);
          embeddings.push(...batchEmbeddings);
          result.chunksProcessed += batch.length;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Batch processing error';
          result.errors.push(`Batch ${i + 1} failed: ${errorMsg}`);
          result.warnings.push(`Skipping ${batch.length} chunks due to batch failure`);
        }
      }

      result.embeddings = embeddings;
      result.processingTime = Date.now() - startTime;

      // Step 4: Calculate performance metrics
      this.calculateMetrics(result, chunks);

      result.success = embeddings.length > 0;

      logger.info(`Embedding generation completed: ${result.embeddings.length}/${chunks.length} successful`);

      // Record performance metrics
      this.performanceMonitor.recordMetric({
        name: 'embedding.generation.duration',
        value: result.processingTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: {
          model: opts.model,
          chunkCount: chunks.length.toString(),
          successCount: result.embeddings.length.toString(),
          success: result.success.toString()
        }
      });

      this.performanceMonitor.endOperation(operationId, 'embedding-generation', result.success);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown embedding error';
      result.errors.push(errorMsg);
      result.processingTime = Date.now() - startTime;

      logger.error('Embedding generation failed:', error);

      this.performanceMonitor.recordMetric({
        name: 'embedding.generation.error',
        value: 1,
        unit: 'count',
        timestamp: new Date(),
        tags: { error: errorMsg.substring(0, 50) }
      });

      this.performanceMonitor.endOperation(operationId, 'embedding-generation', false);
    }

    return result;
  }

  /**
   * Generate single embedding for text
   */
  async generateSingleEmbedding(
    text: string,
    options: EmbeddingOptions = {}
  ): Promise<number[] | null> {
    const opts = this.getDefaultOptions(options);

    try {
      switch (opts.model) {
        case 'sentence-transformers':
        case 'all-MiniLM-L6-v2':
          return await this.generateSentenceTransformersEmbedding(text, opts);
        case 'openai':
          return await this.generateOpenAIEmbedding(text, opts);
        default:
          throw new Error(`Unsupported embedding model: ${opts.model}`);
      }
    } catch (error) {
      logger.error(`Single embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  // Private methods

  private getDefaultOptions(options: EmbeddingOptions): Required<EmbeddingOptions> {
    return {
      model: 'all-MiniLM-L6-v2', // Local model by default
      batchSize: 32,
      maxRetries: 3,
      timeout: EmbeddingGenerator.DEFAULT_TIMEOUT,
      apiKey: '',
      dimensions: 384, // Default for all-MiniLM-L6-v2
      ...options
    };
  }

  private async validateModel(model: string): Promise<void> {
    switch (model) {
      case 'sentence-transformers':
      case 'all-MiniLM-L6-v2':
        await this.checkSentenceTransformers();
        break;
      case 'openai':
        // OpenAI validation would require API key check
        break;
      default:
        throw new Error(`Unknown embedding model: ${model}`);
    }
  }

  private async checkSentenceTransformers(): Promise<void> {
    try {
      const result = await this.runPythonCommand([
        '-c',
        'import sentence_transformers; print("sentence-transformers available")'
      ]);
      logger.info('sentence-transformers library confirmed available');
    } catch (error) {
      throw new Error('sentence-transformers library not available. Install with: pip install sentence-transformers');
    }
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private async processBatch(
    chunks: ContentChunk[],
    options: Required<EmbeddingOptions>
  ): Promise<ChunkEmbedding[]> {
    const texts = chunks.map(chunk => chunk.content);
    
    switch (options.model) {
      case 'sentence-transformers':
      case 'all-MiniLM-L6-v2':
        return await this.processSentenceTransformersBatch(chunks, texts, options);
      case 'openai':
        return await this.processOpenAIBatch(chunks, texts, options);
      default:
        throw new Error(`Unsupported model for batch processing: ${options.model}`);
    }
  }

  private async processSentenceTransformersBatch(
    chunks: ContentChunk[],
    texts: string[],
    options: Required<EmbeddingOptions>
  ): Promise<ChunkEmbedding[]> {
    const batchStartTime = Date.now();

    // Create Python script for batch processing
    const pythonScript = `
import sys
import json
from sentence_transformers import SentenceTransformer

def generate_embeddings(texts, model_name):
    try:
        model = SentenceTransformer('${options.model === 'sentence-transformers' ? 'all-MiniLM-L6-v2' : options.model}')
        embeddings = model.encode(texts)
        return embeddings.tolist()
    except Exception as e:
        raise Exception(f"Embedding generation failed: {e}")

if __name__ == "__main__":
    texts = json.loads(sys.argv[1])
    embeddings = generate_embeddings(texts, "${options.model}")
    print(json.dumps(embeddings))
`;

    // Write script to temp file
    const scriptPath = './temp/generate_embeddings.py';
    await fs.mkdir('./temp', { recursive: true });
    await fs.writeFile(scriptPath, pythonScript);

    try {
      // Run Python script with texts as JSON
      const textsJson = JSON.stringify(texts);
      const output = await this.runPythonCommand([scriptPath, textsJson], options.timeout);
      
      const embeddings = JSON.parse(output) as number[][];
      
      // Create ChunkEmbedding objects
      const result: ChunkEmbedding[] = [];
      const processingTime = Date.now() - batchStartTime;
      const avgTimePerChunk = processingTime / chunks.length;

      for (let i = 0; i < chunks.length; i++) {
        result.push({
          chunkId: chunks[i].id,
          embedding: embeddings[i],
          dimensions: embeddings[i].length,
          model: options.model,
          processingTime: avgTimePerChunk
        });
      }

      return result;

    } finally {
      // Cleanup
      try {
        await fs.unlink(scriptPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private async processOpenAIBatch(
    chunks: ContentChunk[],
    texts: string[],
    options: Required<EmbeddingOptions>
  ): Promise<ChunkEmbedding[]> {
    // OpenAI implementation would go here
    // For now, throw error since it requires API setup
    throw new Error('OpenAI embeddings not implemented - requires API key configuration');
  }

  private async generateSentenceTransformersEmbedding(
    text: string,
    options: Required<EmbeddingOptions>
  ): Promise<number[]> {
    const pythonScript = `
import json
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('${options.model === 'sentence-transformers' ? 'all-MiniLM-L6-v2' : options.model}')
embedding = model.encode("${text.replace(/"/g, '\\"')}")
print(json.dumps(embedding.tolist()))
`;

    const scriptPath = './temp/single_embedding.py';
    await fs.mkdir('./temp', { recursive: true });
    await fs.writeFile(scriptPath, pythonScript);

    try {
      const output = await this.runPythonCommand([scriptPath], options.timeout);
      return JSON.parse(output) as number[];
    } finally {
      try {
        await fs.unlink(scriptPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private async generateOpenAIEmbedding(
    text: string,
    options: Required<EmbeddingOptions>
  ): Promise<number[]> {
    // OpenAI implementation placeholder
    throw new Error('OpenAI embeddings not implemented');
  }

  private async runPythonCommand(args: string[], timeout?: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('python3', args);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Python process exited with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to run Python: ${error.message}`));
      });

      if (timeout) {
        setTimeout(() => {
          process.kill();
          reject(new Error(`Python process timed out after ${timeout}ms`));
        }, timeout);
      }
    });
  }

  private calculateMetrics(result: EmbeddingResult, chunks: ContentChunk[]): void {
    if (result.embeddings.length === 0) return;

    // Embeddings per second
    result.embeddingsPerSecond = (result.embeddings.length / result.processingTime) * 1000;

    // Total tokens processed
    result.totalTokensProcessed = chunks.reduce((sum, chunk) => 
      sum + Math.ceil(chunk.characterCount / 4), 0);

    // Average embedding time
    result.averageEmbeddingTime = result.embeddings.reduce((sum, emb) => 
      sum + emb.processingTime, 0) / result.embeddings.length;
  }
}