import { createServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("loads")
    .select("*", { count: "exact", head: true });

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>DJRJC Logistics</h1>
      {error ? (
        <p>Supabase connection failed: {error.message}</p>
      ) : (
        <p>Connected to Supabase. Loads in database: {count}</p>
      )}
    </main>
  );
}
