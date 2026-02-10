function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRole() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get secretPepper() {
    return process.env.SECRET_PEPPER ?? "";
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL ?? "";
  }
};
