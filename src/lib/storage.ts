import { createClient, SupabaseClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import { prisma } from './prisma.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fpufcxgwayrmyrfqtwvp.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const BUCKET_NAME = process.env.SUPABASE_BUCKET || 'erp-uploads';

let supabaseClient: SupabaseClient | null = null;
let bucketChecked = false;

export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_KEY) {
    return null;
  }
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
  }
  return supabaseClient;
}

async function ensureBucket(supabase: SupabaseClient) {
  if (bucketChecked) return;
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === BUCKET_NAME);
    if (!exists) {
      const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
        public: true,
        fileSizeLimit: 52428800, // 50MB
      });
      if (error && !error.message?.includes('already exists')) {
        console.warn('[Supabase Storage] Create bucket warning:', error.message);
      }
    }
    bucketChecked = true;
  } catch (err: any) {
    console.warn('[Supabase Storage] Bucket check skipped:', err?.message || err);
  }
}

export async function uploadToStorage(
  file: Express.Multer.File,
  folder: 'avatars' | 'documents'
): Promise<string> {
  const rawExt = path.extname(file.originalname).toLowerCase();
  const fallbackExt = folder === 'avatars' ? '.jpg' : '.pdf';
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${rawExt || fallbackExt}`;
  const filePath = `${folder}/${filename}`;

  const fileBuffer = file.buffer || (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path) : null);
  if (!fileBuffer) {
    throw new Error('Unable to read uploaded file data');
  }

  const supabase = getSupabase();
  if (supabase) {
    try {
      await ensureBucket(supabase);
      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, fileBuffer, {
          contentType: file.mimetype || 'application/octet-stream',
          upsert: true,
        });

      if (!error) {
        const { data: publicUrlData } = supabase.storage
          .from(BUCKET_NAME)
          .getPublicUrl(filePath);

        return publicUrlData.publicUrl;
      }
      console.error('[Supabase Storage Upload Error]', error);
    } catch (sbErr) {
      console.error('[Supabase Storage Exception]', sbErr);
    }
  }

  // Fallback to database persistence if Supabase key is not yet configured
  await prisma.uploadedFile.upsert({
    where: { filename: filePath },
    create: {
      filename: filePath,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size || fileBuffer.length,
      data: fileBuffer,
    },
    update: {
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size || fileBuffer.length,
      data: fileBuffer,
    },
  });

  return `/uploads/${filePath}`;
}
