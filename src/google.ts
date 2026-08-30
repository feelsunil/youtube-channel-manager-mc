import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { google, youtube_v3 } from 'googleapis';
import type { Credentials } from 'google-auth-library';
import type { Config } from './config.js';
import type { TokenStore } from './store.js';

const READ_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly'
];
const MANAGER_SCOPES = [
  ...READ_SCOPES,
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.upload'
];

export class YouTubeClient {
  constructor(private readonly config: Config, private readonly store: TokenStore) {}

  private oauth() {
    const oauth = new google.auth.OAuth2(
      this.config.GOOGLE_CLIENT_ID,
      this.config.GOOGLE_CLIENT_SECRET,
      this.config.googleRedirectUri
    );
    const token = this.store.getGoogleToken<Credentials>();
    if (token) oauth.setCredentials(token);
    oauth.on('tokens', newTokens => {
      const current = this.store.getGoogleToken<Credentials>() ?? {};
      this.store.saveGoogleToken({ ...current, ...newTokens });
    });
    return oauth;
  }

  beginAuthorization() {
    const state = crypto.randomBytes(32).toString('base64url');
    this.store.saveState(state, Date.now() + 10 * 60_000);
    return this.oauth().generateAuthUrl({
      access_type: 'offline',
      include_granted_scopes: true,
      prompt: 'consent',
      state,
      scope: this.config.YOUTUBE_MODE === 'manager' ? MANAGER_SCOPES : READ_SCOPES
    });
  }

  async finishAuthorization(code: string, state: string) {
    if (!this.store.consumeState(state)) throw new Error('OAuth state is invalid or expired');
    const oauth = this.oauth();
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token && !this.store.hasGoogleToken()) {
      throw new Error('Google did not return a refresh token; revoke prior consent and retry');
    }
    const current = this.store.getGoogleToken<Credentials>() ?? {};
    this.store.saveGoogleToken({ ...current, ...tokens });
  }

  private requireConnected() {
    if (!this.store.hasGoogleToken()) throw new Error('YouTube is not connected. Complete /auth/google/start first.');
  }

  youtube() {
    this.requireConnected();
    return google.youtube({ version: 'v3', auth: this.oauth() });
  }

  analytics() {
    this.requireConnected();
    return google.youtubeAnalytics({ version: 'v2', auth: this.oauth() });
  }

  assertMutationAllowed(approvalPhrase: string) {
    if (this.config.YOUTUBE_MODE !== 'manager' || !this.config.MUTATIONS_ENABLED) {
      throw new Error('Write tools are disabled. Set YOUTUBE_MODE=manager and MUTATIONS_ENABLED=true after verification.');
    }
    if (approvalPhrase !== 'I APPROVE THIS YOUTUBE CHANGE') {
      throw new Error('Exact owner approval phrase is required: I APPROVE THIS YOUTUBE CHANGE');
    }
  }

  resolveUploadPath(inputPath: string) {
    const resolved = path.resolve(this.config.uploadRoot, inputPath);
    const relative = path.relative(this.config.uploadRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('File must be inside UPLOAD_ROOT');
    if (!fs.statSync(resolved).isFile()) throw new Error('Upload file does not exist');
    return resolved;
  }

  async ownChannel() {
    const response = await this.youtube().channels.list({
      mine: true,
      part: ['snippet', 'statistics', 'status', 'contentDetails']
    });
    const channel = response.data.items?.[0];
    if (!channel) throw new Error('No YouTube channel found for the authorized account');
    return channel;
  }

  async uploadVideo(args: {
    filePath: string;
    title: string;
    description: string;
    tags?: string[];
    categoryId: string;
    privacyStatus: 'private' | 'unlisted';
    madeForKids: boolean;
  }) {
    const file = this.resolveUploadPath(args.filePath);
    return this.youtube().videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: args.title,
          description: args.description,
          tags: args.tags,
          categoryId: args.categoryId
        },
        status: {
          privacyStatus: args.privacyStatus,
          selfDeclaredMadeForKids: args.madeForKids
        }
      },
      media: { body: fs.createReadStream(file) }
    });
  }

  async listRecentVideos(maxResults: number): Promise<youtube_v3.Schema$Video[]> {
    const channel = await this.ownChannel();
    const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return [];
    const playlist = await this.youtube().playlistItems.list({
      playlistId: uploads,
      part: ['contentDetails'],
      maxResults
    });
    const ids = (playlist.data.items ?? []).map(x => x.contentDetails?.videoId).filter(Boolean) as string[];
    if (!ids.length) return [];
    const videos = await this.youtube().videos.list({
      id: ids,
      part: ['snippet', 'statistics', 'status', 'contentDetails']
    });
    return videos.data.items ?? [];
  }
}
