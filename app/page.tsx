"use client";

import { FormEvent, useMemo, useState } from "react";

type CreateResponse = {
  session_id: string;
  host_secret: string;
  session_url_host: string;
  session_url_listener: string;
};

function makeAbsolute(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${window.location.origin}${url}`;
}

export default function HomePage() {
  const [trackUrl, setTrackUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResponse | null>(null);

  const hostLink = useMemo(() => {
    if (!result) return "";
    return makeAbsolute(result.session_url_host);
  }, [result]);

  const listenerLink = useMemo(() => {
    if (!result) return "";
    return makeAbsolute(result.session_url_listener);
  }, [result]);

  async function copyValue(value: string) {
    await navigator.clipboard.writeText(value);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_url: trackUrl })
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to create session");
      }

      const body = (await res.json()) as CreateResponse;
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <section className="card">
        <h1>CS-Radio</h1>
        <p>Create a live SoundCloud session and share one listener URL.</p>

        <form onSubmit={handleSubmit} className="field">
          <label htmlFor="track_url">SoundCloud Track URL</label>
          <input
            id="track_url"
            type="url"
            required
            placeholder="https://soundcloud.com/artist/track"
            value={trackUrl}
            onChange={(e) => setTrackUrl(e.target.value)}
          />
          <button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Start Radio"}
          </button>
        </form>

        {error ? <div className="status error">{error}</div> : null}

        {result ? (
          <div className="links">
            <div className="status ok">Session created.</div>
            <div className="linkRow">
              <strong>Host link</strong>
              <code>{hostLink}</code>
              <button type="button" onClick={() => copyValue(hostLink)}>
                Copy host link
              </button>
            </div>
            <div className="linkRow">
              <strong>Listener link</strong>
              <code>{listenerLink}</code>
              <button type="button" onClick={() => copyValue(listenerLink)}>
                Copy listener link
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
