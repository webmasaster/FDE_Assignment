import { createClient } from "@supabase/supabase-js";

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase storage is not configured");
  return createClient(url, key);
}

export async function uploadPdf(buffer: Buffer, key: string) {
  const supabase = getSupabase();
  const bucket = process.env.SUPABASE_BUCKET || "po-pdfs";
  const { error } = await supabase.storage.from(bucket).upload(key, buffer, {
    contentType: "application/pdf",
    upsert: false
  });
  if (error) throw new Error(`PDF upload failed: ${error.message}`);
  return key;
}

export async function getPdfUrl(key: string) {
  const supabase = getSupabase();
  const bucket = process.env.SUPABASE_BUCKET || "po-pdfs";
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(key, 15 * 60);
  if (error) throw new Error(`Could not open PDF: ${error.message}`);
  return data.signedUrl;
}
