import { createClient } from "@/lib/supabase/server";

export async function signedImageMap(paths: string[]) {
  const supabase = await createClient();
  const unique = [...new Set(paths.filter((p) => p && !p.startsWith("demo/")))];
  const map: Record<string, string> = {};
  await Promise.all(
    unique.map(async (path) => {
      const { data } = await supabase.storage.from("pothole-images").createSignedUrl(path, 3600);
      if (data?.signedUrl) map[path] = data.signedUrl;
    }),
  );
  return map;
}
