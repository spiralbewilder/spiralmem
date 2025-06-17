// Video processing core exports
export { VideoValidator } from './VideoValidator.js';
export type { VideoValidationResult, VideoFileInfo, ValidationOptions } from './VideoValidator.js';

export { MetadataExtractor } from './MetadataExtractor.js';
export type { VideoMetadata, VideoChapter, FFprobeOutput } from './MetadataExtractor.js';

export { AudioExtractor } from './AudioExtractor.js';
export type { AudioExtractionOptions, AudioExtractionResult, AudioValidationResult } from './AudioExtractor.js';

export { TranscriptionEngine } from './TranscriptionEngine.js';
export type { TranscriptionOptions, TranscriptionResult, TranscriptionSegment, WhisperSystemInfo } from './TranscriptionEngine.js';

export { VideoProcessor } from './VideoProcessor.js';
export type { VideoProcessingOptions, VideoProcessingResult, BatchProcessingResult } from './VideoProcessor.js';

export { ProcessingQueue } from './ProcessingQueue.js';
export type { ProcessingJob, QueueStats, ProcessingQueueOptions } from './ProcessingQueue.js';

export { JobManager } from './JobManager.js';
export type { JobManagerOptions, ScheduledJob, JobHistory } from './JobManager.js';

export { FrameSampler } from './FrameSampler.js';
export type { FrameSamplingOptions, FrameSamplingResult, FrameInfo, ThumbnailOptions, ThumbnailResult } from './FrameSampler.js';