import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { YouTubeClient } from './google.js';

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function cleanVideo(video: any) {
  return {
    id: video.id,
    title: video.snippet?.title,
    publishedAt: video.snippet?.publishedAt,
    privacyStatus: video.status?.privacyStatus,
    duration: video.contentDetails?.duration,
    views: video.statistics?.viewCount,
    likes: video.statistics?.likeCount,
    comments: video.statistics?.commentCount
  };
}

export function createMcpServer(client: YouTubeClient) {
  const server = new McpServer({ name: 'youtube-channel-manager', version: '0.1.0' });

  server.registerTool('youtube_channel_summary', {
    title: 'Get YouTube channel summary',
    description: 'Read the authorized channel identity, status, subscriber count, view count, video count, and uploads playlist.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  }, async () => {
    const channel = await client.ownChannel();
    return result({
      id: channel.id,
      title: channel.snippet?.title,
      description: channel.snippet?.description,
      customUrl: channel.snippet?.customUrl,
      country: channel.snippet?.country,
      subscribers: channel.statistics?.subscriberCount,
      views: channel.statistics?.viewCount,
      videos: channel.statistics?.videoCount,
      privacyStatus: channel.status?.privacyStatus,
      madeForKids: channel.status?.madeForKids
    });
  });

  server.registerTool('youtube_recent_videos', {
    title: 'List recent YouTube videos',
    description: 'Read recent uploads with visibility and basic performance statistics.',
    inputSchema: z.object({ maxResults: z.number().int().min(1).max(50).default(20) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  }, async ({ maxResults }) => result((await client.listRecentVideos(maxResults)).map(cleanVideo)));

  server.registerTool('youtube_channel_analytics', {
    title: 'Get channel analytics',
    description: 'Read channel views, watch time, average view duration, and subscriber gains/losses for a date range.',
    inputSchema: z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  }, async ({ startDate, endDate }) => {
    const response = await client.analytics().reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost'
    });
    return result({ columnHeaders: response.data.columnHeaders, rows: response.data.rows ?? [] });
  });

  server.registerTool('youtube_top_content', {
    title: 'Get top YouTube content',
    description: 'Read top videos or Shorts for a date range, ranked by views with watch-time and subscriber metrics.',
    inputSchema: z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      maxResults: z.number().int().min(1).max(50).default(20)
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  }, async ({ startDate, endDate, maxResults }) => {
    const response = await client.analytics().reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      dimensions: 'video',
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained',
      sort: '-views',
      maxResults
    });
    return result({ columnHeaders: response.data.columnHeaders, rows: response.data.rows ?? [] });
  });

  server.registerTool('youtube_search_terms', {
    title: 'Get YouTube search terms',
    description: 'Read YouTube Search phrases that generated views during a date range. Use absolute views with percentages to avoid overfitting small samples.',
    inputSchema: z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      maxResults: z.number().int().min(1).max(50).default(25)
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  }, async ({ startDate, endDate, maxResults }) => {
    const response = await client.analytics().reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      dimensions: 'insightTrafficSourceDetail',
      filters: 'insightTrafficSourceType==YT_SEARCH',
      metrics: 'views,estimatedMinutesWatched',
      sort: '-views',
      maxResults
    });
    return result({ columnHeaders: response.data.columnHeaders, rows: response.data.rows ?? [] });
  });

  server.registerTool('youtube_update_metadata', {
    title: 'Update video metadata',
    description: 'Update an existing video title, description, or tags. Call only after the owner explicitly approves the exact change.',
    inputSchema: z.object({
      videoId: z.string().min(6).max(32),
      title: z.string().min(1).max(100).optional(),
      description: z.string().max(5000).optional(),
      tags: z.array(z.string().max(100)).max(30).optional(),
      approvalPhrase: z.literal('I APPROVE THIS YOUTUBE CHANGE')
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  }, async ({ videoId, title, description, tags, approvalPhrase }) => {
    client.assertMutationAllowed(approvalPhrase);
    const youtube = client.youtube();
    const current = await youtube.videos.list({ id: [videoId], part: ['snippet'] });
    const video = current.data.items?.[0];
    if (!video?.snippet) throw new Error('Video not found');
    const updated = await youtube.videos.update({
      part: ['snippet'],
      requestBody: {
        id: videoId,
        snippet: {
          ...video.snippet,
          title: title ?? video.snippet.title,
          description: description ?? video.snippet.description,
          tags: tags ?? video.snippet.tags
        }
      }
    });
    return result(cleanVideo(updated.data));
  });

  server.registerTool('youtube_upload_private_video', {
    title: 'Upload private YouTube video',
    description: 'Upload a staged local video as private or unlisted. Public publishing is intentionally not supported by this tool. Call only after exact owner approval.',
    inputSchema: z.object({
      filePath: z.string().min(1).max(500),
      title: z.string().min(1).max(100),
      description: z.string().max(5000).default(''),
      tags: z.array(z.string().max(100)).max(30).optional(),
      categoryId: z.string().regex(/^\d+$/).default('10'),
      privacyStatus: z.enum(['private', 'unlisted']).default('private'),
      madeForKids: z.boolean().default(false),
      approvalPhrase: z.literal('I APPROVE THIS YOUTUBE CHANGE')
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  }, async ({ approvalPhrase, ...args }) => {
    client.assertMutationAllowed(approvalPhrase);
    const uploaded = await client.uploadVideo(args);
    return result(cleanVideo(uploaded.data));
  });

  server.registerTool('youtube_set_thumbnail', {
    title: 'Set YouTube thumbnail',
    description: 'Upload a staged local image as a video thumbnail. Call only after exact owner approval.',
    inputSchema: z.object({
      videoId: z.string().min(6).max(32),
      filePath: z.string().min(1).max(500),
      approvalPhrase: z.literal('I APPROVE THIS YOUTUBE CHANGE')
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  }, async ({ videoId, filePath, approvalPhrase }) => {
    client.assertMutationAllowed(approvalPhrase);
    const resolved = client.resolveUploadPath(filePath);
    const response = await client.youtube().thumbnails.set({ videoId, media: { body: fs.createReadStream(resolved) } });
    return result(response.data);
  });

  return server;
}
