export type WidgetEvent = "READY" | "PLAY" | "PAUSE" | "SEEK" | "FINISH";

type WidgetLike = {
  bind: (eventName: string, cb: () => void) => void;
  unbind: (eventName: string, cb: () => void) => void;
  getPosition: (cb: (position: number) => void) => void;
  seekTo: (ms: number) => void;
  play: () => void;
  pause: () => void;
};

declare global {
  interface Window {
    SC?: {
      Widget: {
        (iframe: HTMLIFrameElement): WidgetLike;
        Events: Record<WidgetEvent, string>;
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("SoundCloud widget can only load in browser"));
  }

  if (window.SC?.Widget) {
    return Promise.resolve();
  }

  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://w.soundcloud.com/player/api.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load SoundCloud widget script"));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

function normalizeMs(ms: number): number {
  if (!Number.isFinite(ms)) {
    return 0;
  }
  return Math.max(0, Math.floor(ms));
}

export type SoundCloudWidgetApi = {
  ready: Promise<void>;
  bind: (event: WidgetEvent, cb: () => void) => void;
  unbind: (event: WidgetEvent, cb: () => void) => void;
  getPosition: () => Promise<number>;
  seekTo: (ms: number) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
};

export async function createWidget(
  iframe: HTMLIFrameElement,
  readyTimeoutMs = 15_000
): Promise<SoundCloudWidgetApi> {
  await loadScript();

  if (!window.SC?.Widget) {
    throw new Error("SoundCloud widget unavailable");
  }

  const raw = window.SC.Widget(iframe);

  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const eventName = window.SC.Widget.Events.READY;

  const onReady = () => {
    clearTimeout(timer);
    raw.unbind(eventName, onReady);
    resolveReady();
  };

  const timer = setTimeout(() => {
    raw.unbind(eventName, onReady);
    rejectReady(new Error("Track can't be embedded or failed to load"));
  }, readyTimeoutMs);

  raw.bind(eventName, onReady);

  return {
    ready,
    bind(event, cb) {
      raw.bind(window.SC!.Widget.Events[event], cb);
    },
    unbind(event, cb) {
      raw.unbind(window.SC!.Widget.Events[event], cb);
    },
    async getPosition() {
      return await new Promise<number>((resolve) => {
        raw.getPosition((position) => resolve(normalizeMs(position)));
      });
    },
    async seekTo(ms) {
      raw.seekTo(normalizeMs(ms));
    },
    async play() {
      raw.play();
    },
    async pause() {
      raw.pause();
    }
  };
}
