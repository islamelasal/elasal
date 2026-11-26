import {SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY} from './supabase-config.js';

export const db = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {persistSession: false, autoRefreshToken: true, detectSessionInUrl: false}
});

export function unwrap({data, error}) {
  if (error) throw error;
  return data;
}

export function authFeedback(error) {
  if (error?.code === 'invalid_credentials') return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if (error?.code === 'email_not_confirmed') return 'أكّد البريد الإلكتروني أولًا.';
  if (error?.code === 'over_request_rate_limit') return 'محاولات كثيرة. انتظر قليلًا وأعد المحاولة.';
  if (error?.code === 'PGRST202' || error?.code === '42P01') return 'إعداد قاعدة البيانات مطلوب. شغّل ملف SQL في مشروع Supabase.';
  return error?.message || 'تعذر الاتصال بخدمة تسجيل الدخول.';
}
