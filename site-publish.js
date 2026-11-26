import {db, unwrap} from './supabase-client.js';
import {mediaKeys, validateContent} from './site-data.js';

export async function publishContent({revision, content: draft}) {
  const content = validateContent(draft, true);
  const uploaded = new Map();
  const storage = db.storage.from('academy-media');

  async function publishImage(picture) {
    if (!picture.src.startsWith('data:')) return;
    const encoded = picture.src.split(',')[1];
    if (!uploaded.has(encoded)) {
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') + '.webp';
      const {error} = await storage.upload(key, bytes, {contentType: 'image/webp', cacheControl: '31536000', upsert: false});
      if (error && ![error.statusCode, error.status, error.error, error.code].some(
        value => [409, '409', 'Duplicate', 'ResourceAlreadyExists', 'KeyAlreadyExists'].includes(value)
      )) throw error;
      uploaded.set(encoded, storage.getPublicUrl(key).data.publicUrl);
    }
    picture.src = uploaded.get(encoded);
  }

  for (const picture of [...mediaKeys.map(key => content.media[key]), ...content.gallery]) {
    await publishImage(picture);
  }
  const table = db.from('site_content');
  const publicContent = validateContent(content);
  let result;
  if (revision === null) {
    result = await table.insert({id: true, content: publicContent}).select('revision').single();
  } else {
    result = await table.update({content: publicContent, revision: revision + 1, updated_at: new Date().toISOString()})
      .eq('id', true).eq('revision', revision).select('revision').maybeSingle();
  }
  if (result.error?.code === '23505' || (!result.error && !result.data)) {
    throw Error('تم نشر نسخة أحدث. حمّل المحتوى المنشور وراجع مسودتك قبل إعادة النشر.');
  }
  const saved = unwrap(result);
  return {content: publicContent, revision: saved.revision};
}
