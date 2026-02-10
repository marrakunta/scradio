export type SessionRow = {
  id: string;
  track_url: string;
  track_sc_id: string | null;
  created_at: string;
  playing: boolean;
  position_ms: number;
  state_updated_at: string;
  host_lease_expires_at: string;
  last_error: string | null;
  updated_at: string;
};

export type SessionPublic = Omit<SessionRow, "updated_at">;
