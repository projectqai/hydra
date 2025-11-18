import { createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { TimelineService as TimelineServiceDef } from '../proto/timeline_connect';
import { GetTimelineRequest, GetTimelineResponse, MoveTimelineRequest } from '../proto/timeline_pb';
import { Timestamp } from '@bufbuild/protobuf';

export class TimelineService {
  private client: any;
  private watchController: AbortController | null = null;
  private currentWatchPromise: Promise<void> | null = null;
  private shouldReconnect: boolean = false;
  private lastOnTimelineUpdate: ((timeline: GetTimelineResponse) => void) | null = null;
  private lastOnError: ((error: Error) => void) | undefined;
  private isStarting: boolean = false;

  constructor(baseUrl: string = import.meta.env.DEV ? 'http://localhost:50051' : window.location.origin) {
    const transport = createConnectTransport({
      baseUrl,
      useBinaryFormat: false,
      useHttpGet: false,
    });

    this.client = createPromiseClient(TimelineServiceDef, transport);
  }

  async startWatchingTimeline(
    onTimelineUpdate: (timeline: GetTimelineResponse) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    // Prevent concurrent starts
    if (this.isStarting) {
      return;
    }

    this.isStarting = true;

    try {
      // Wait for any existing watch to fully stop before starting a new one
      if (this.currentWatchPromise) {
        this.stopWatchingTimeline();
        await this.currentWatchPromise;
      }

      // Store for reconnection
      this.shouldReconnect = true;
      this.lastOnTimelineUpdate = onTimelineUpdate;
      this.lastOnError = onError;
    } finally {
      this.isStarting = false;
    }

    this.watchController = new AbortController();
    const controller = this.watchController;

    // Store the promise so we can await it when stopping
    this.currentWatchPromise = (async () => {
      let connected = false;
      try {
        const request = new GetTimelineRequest();

        const stream = this.client.getTimeline(
          request,
          { signal: controller.signal }
        );

        // Handle incoming timeline updates
        for await (const timeline of stream) {
          if (!connected) {
            console.log('Timeline connected');
            connected = true;
          }
          onTimelineUpdate(timeline);
        }
      } catch (error) {
        const errorMsg = (error as any)?.message || '';
        const errorCode = (error as any)?.code || '';
        const isAbortError = (error as any)?.name === 'AbortError' ||
                            errorCode === 'canceled' ||
                            errorMsg.includes('aborted') ||
                            errorMsg.includes('canceled');

        // Ignore abort errors as they're expected when stopping
        if (!isAbortError) {
          console.error('Timeline stream error:', error);
          if (onError) {
            onError(error as Error);
          }

          // Reconnect if we should
          if (this.shouldReconnect && this.lastOnTimelineUpdate) {
            console.log('Timeline reconnecting...');
            // Clear current promise so startWatching can proceed
            this.watchController = null;
            this.currentWatchPromise = null;
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (this.shouldReconnect && this.lastOnTimelineUpdate) {
              await this.startWatchingTimeline(this.lastOnTimelineUpdate, this.lastOnError);
            }
          }
        }
      } finally {
        if (!this.shouldReconnect) {
          this.watchController = null;
          this.currentWatchPromise = null;
        }
      }
    })();

    return this.currentWatchPromise;
  }

  stopWatchingTimeline(): void {
    this.shouldReconnect = false;
    if (this.watchController) {
      this.watchController.abort();
      this.watchController = null;
    }
  }

  async moveTimeline(freeze: boolean, at?: Timestamp): Promise<void> {
    try {
      const request = new MoveTimelineRequest({
        freeze,
        at
      });
      
      await this.client.moveTimeline(request);
    } catch (error) {
      console.error('Error moving timeline:', error);
      throw error;
    }
  }
}