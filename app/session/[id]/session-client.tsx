"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { createWidget, type SoundCloudWidgetApi } from "@/lib/soundcloud";
import type { SessionPublic } from "@/lib/types";

type Props = {
  sessionId: string;
};

type SyncReason = "initial" | "realtime" | "periodic";
type HostAction = "PLAY" | "PAUSE" | "SEEK" | "HEARTBEAT";

function hostStorageKey(sessionId: string): string {
  return `scradio:host-secret:${sessionId}`;
}

function clampMs(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms));
}

function parseHostFromHash(hash: string): string | null {
  if (!hash) return null;
  const parsed = new URLSearchParams(hash.replace(/^#/, ""));
  const host = parsed.get("host");
  return host?.trim() || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function SessionClient({ sessionId }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const widgetRef = useRef<SoundCloudWidgetApi | null>(null);
  const readyRef = useRef(false);
  const serverOffsetRef = useRef(0);
  const latestStateRef = useRef<SessionPublic | null>(null);
  const pendingStateRef = useRef<SessionPublic | null>(null);
  const hostSecretRef = useRef<string | null>(null);
  const hostPlayingRef = useRef(false);
  const widgetStartedRef = useRef(false);
  const hostProgressPostAtRef = useRef(0);
  const autoplayCheckedRef = useRef(false);

  const [session, setSession] = useState<SessionPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isHost, setIsHost] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [manuallyStarted, setManuallyStarted] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  const getServerNowMs = useCallback(() => Date.now() + serverOffsetRef.current, []);

  const getTargetMs = useCallback(
    (state: SessionPublic): number => {
      const base = clampMs(state.position_ms);
      if (!state.playing) {
        return base;
      }
      const updatedMs = new Date(state.state_updated_at).getTime();
      const delta = getServerNowMs() - updatedMs;
      return clampMs(base + Math.max(0, delta));
    },
    [getServerNowMs]
  );

  const hostOffline = useMemo(() => {
    if (!session) return false;
    return getServerNowMs() > new Date(session.host_lease_expires_at).getTime();
  }, [getServerNowMs, nowTick, session]);

  const statusLabel = useMemo(() => {
    if (!session) return "";
    if (hostOffline) return "HOST OFFLINE";
    return session.playing ? "LIVE" : "PAUSED";
  }, [hostOffline, session]);

  const statusClass = useMemo(() => {
    if (!session) return "badge";
    if (hostOffline) return "badge offline";
    return session.playing ? "badge live" : "badge paused";
  }, [hostOffline, session]);

  const iframeSrc = useMemo(() => {
    if (!session) return "";
    const src = new URL("https://w.soundcloud.com/player/");
    src.searchParams.set("url", session.track_url);
    src.searchParams.set("auto_play", "false");
    src.searchParams.set("hide_related", "true");
    src.searchParams.set("show_comments", "false");
    src.searchParams.set("show_teaser", "false");
    src.searchParams.set("show_reposts", "false");
    src.searchParams.set("visual", "false");
    return src.toString();
  }, [session]);

  const fetchSession = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error("Session not found");
    }
    return (await res.json()) as SessionPublic;
  }, [sessionId]);

  const updateServerOffset = useCallback(async () => {
    const started = Date.now();
    const res = await fetch("/api/time", { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as { server_time?: string };
    if (!body.server_time) return;

    const arrived = Date.now();
    const roundtrip = arrived - started;
    const serverMs = new Date(body.server_time).getTime();
    const estimatedNowAtReceive = serverMs + roundtrip / 2;
    serverOffsetRef.current = estimatedNowAtReceive - arrived;
  }, []);

  const applyListenerState = useCallback(
    async (next: SessionPublic, reason: SyncReason) => {
      latestStateRef.current = next;
      if (!readyRef.current || !widgetRef.current) {
        pendingStateRef.current = next;
        return;
      }

      const widget = widgetRef.current;
      const target = getTargetMs(next);
      const current = await widget.getPosition();

      const threshold = reason === "periodic" ? 1_800 : 700;
      const drift = Math.abs(current - target);
      const leaseExpired = getServerNowMs() > new Date(next.host_lease_expires_at).getTime();
      const canAggressiveSeek = !leaseExpired || reason === "periodic";

      if (drift > threshold && canAggressiveSeek) {
        await widget.seekTo(target);
      }

      if (!next.playing) {
        await widget.pause();
        return;
      }

      if (autoplayBlocked && !manuallyStarted) {
        return;
      }

      await widget.play();

      if (reason !== "periodic" && !manuallyStarted && !autoplayCheckedRef.current) {
        autoplayCheckedRef.current = true;
        const before = await widget.getPosition();
        await sleep(1_200);
        const after = await widget.getPosition();

        if (after - before < 200) {
          setAutoplayBlocked(true);
        } else {
          setAutoplayBlocked(false);
        }
      }
    },
    [autoplayBlocked, getServerNowMs, getTargetMs, manuallyStarted]
  );

  const postHostState = useCallback(
    async (action: HostAction, forcedPlaying?: boolean) => {
      if (!widgetRef.current || !hostSecretRef.current) {
        return;
      }

      try {
        const position = await widgetRef.current.getPosition();
        const playing = forcedPlaying ?? hostPlayingRef.current;

        const res = await fetch(`/api/sessions/${sessionId}/state`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${hostSecretRef.current}`
          },
          body: JSON.stringify({
            action,
            playing,
            position_ms: position,
            client_sent_at_ms: Date.now()
          })
        });

        if (!res.ok) {
          return;
        }

        const body = (await res.json().catch(() => null)) as { server_time?: string } | null;
        if (body?.server_time) {
          const serverMs = new Date(body.server_time).getTime();
          serverOffsetRef.current = serverMs - Date.now();
        }
      } catch {
        // Keep host resilient and silent on temporary state write failures.
      }
    },
    [sessionId]
  );

  useEffect(() => {
    const hashHost = parseHostFromHash(window.location.hash);
    const storageKey = hostStorageKey(sessionId);

    if (hashHost) {
      localStorage.setItem(storageKey, hashHost);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }

    const secret = hashHost ?? localStorage.getItem(storageKey);
    if (secret) {
      hostSecretRef.current = secret;
      setIsHost(true);
    }
  }, [sessionId]);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setLoading(true);
      setError(null);

      try {
        await updateServerOffset();
        const loaded = await fetchSession();
        if (!active) return;
        setSession(loaded);
        latestStateRef.current = loaded;
        hostPlayingRef.current = loaded.playing;
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load session");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [fetchSession, updateServerOffset]);

  useEffect(() => {
    if (!session) return;
    if (!iframeRef.current || widgetStartedRef.current) return;

    widgetStartedRef.current = true;

    let cancelled = false;

    async function setupWidget() {
      try {
        const widget = await createWidget(iframeRef.current!);
        widgetRef.current = widget;
        await widget.ready;

        if (cancelled) return;
        readyRef.current = true;

        if (isHost) {
          const onPlay = () => {
            hostPlayingRef.current = true;
            void postHostState("PLAY", true);
          };
          const onPause = () => {
            hostPlayingRef.current = false;
            void postHostState("PAUSE", false);
          };
          const onSeek = () => {
            void postHostState("SEEK");
            setTimeout(() => void postHostState("SEEK"), 350);
            setTimeout(() => void postHostState("SEEK"), 900);
          };
          const onProgress = () => {
            const now = Date.now();
            if (now - hostProgressPostAtRef.current < 1_200) {
              return;
            }
            hostProgressPostAtRef.current = now;
            void postHostState("HEARTBEAT", true);
          };

          widget.bind("PLAY", onPlay);
          widget.bind("PAUSE", onPause);
          widget.bind("SEEK", onSeek);
          widget.bind("FINISH", onPause);
          widget.bind("PLAY_PROGRESS", onProgress);
        } else {
          const state = pendingStateRef.current ?? latestStateRef.current;
          if (state) {
            void applyListenerState(state, "initial");
            pendingStateRef.current = null;
          }
        }
      } catch (err) {
        if (!cancelled) {
          setWidgetError(err instanceof Error ? err.message : "Widget failed to load");
        }
      }
    }

    void setupWidget();

    return () => {
      cancelled = true;
    };
  }, [applyListenerState, isHost, postHostState, session]);

  useEffect(() => {
    if (isHost) return;

    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(`session-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `id=eq.${sessionId}`
        },
        (payload) => {
          const next = payload.new as SessionPublic;
          latestStateRef.current = next;
          setSession(next);
          void applyListenerState(next, "realtime");
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [applyListenerState, isHost, sessionId]);

  useEffect(() => {
    if (!isHost) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      await postHostState("HEARTBEAT");
      const delay = hostPlayingRef.current ? 1_500 : 10_000;
      timer = setTimeout(() => void tick(), delay);
    };

    timer = setTimeout(() => void tick(), hostPlayingRef.current ? 1_500 : 10_000);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [isHost, postHostState]);

  useEffect(() => {
    if (isHost) return;

    const interval = setInterval(() => {
      const state = latestStateRef.current;
      if (!state) return;
      void applyListenerState(state, "periodic");
    }, 9_000);

    return () => clearInterval(interval);
  }, [applyListenerState, isHost]);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  async function onTapStart() {
    const widget = widgetRef.current;
    const state = latestStateRef.current;
    if (!widget || !state) {
      return;
    }

    const target = getTargetMs(state);
    await widget.seekTo(target);
    await widget.play();
    setManuallyStarted(true);
    setAutoplayBlocked(false);
  }

  return (
    <main>
      <section className="card">
        <div className="topLine">
          <h1>CS-Radio Session</h1>
          {session ? <span className={statusClass}>{statusLabel}</span> : null}
        </div>

        {loading ? <p>Loading session...</p> : null}
        {error ? <div className="status error">{error}</div> : null}
        {widgetError ? <div className="status error">{widgetError}</div> : null}

        {session ? (
          <>
            <p className="hint">Track: {session.track_url}</p>
            <p className="hint">Mode: {isHost ? "Host" : "Listener"}</p>
            {isHost ? <p className="hint">Multiple host tabs may cause drift.</p> : null}

            <div className="playerWrap">
              <iframe
                ref={iframeRef}
                title="SoundCloud widget"
                allow="autoplay"
                src={iframeSrc}
                loading="eager"
              />
              {!isHost ? <div className="listenerPlayGuard" aria-hidden="true" /> : null}
            </div>

            {!isHost && autoplayBlocked ? (
              <button type="button" style={{ marginTop: 12 }} onClick={onTapStart}>
                Start listening live
              </button>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
