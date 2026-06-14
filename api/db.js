const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY chưa được set');
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  console.log('[db] Supabase connected:', url.substring(0, 40));
  return _client;
}

// ── Helper: ném lỗi nếu Supabase trả error ──────────────────────────────────
function check(error, context='') {
  if (!error) return;
  // Unique violation
  if (error.code === '23505') {
    if (context === 'user') throw new Error('EMAIL_EXISTS');
    throw new Error('SHORT_CODE_EXISTS');
  }
  throw new Error(error.message || JSON.stringify(error));
}

async function init() {
  const sb = getClient();

  // Supabase dùng PostgreSQL – tạo bảng qua SQL Editor hoặc migration
  // Không cần tự CREATE TABLE ở đây vì Supabase có UI migration
  // Xem file supabase/schema.sql để tạo bảng

  return {
    // ── Users ──────────────────────────────────────────────────────────
    async createUser(email, hashedPwd, name, role = 'user') {
      const { data, error } = await sb
        .from('users')
        .insert({ email, password: hashedPwd, name: name || null, role })
        .select()
        .single();
      check(error, 'user');
      return data;
    },

    async getUserByEmail(email) {
      const { data } = await sb.from('users').select('*').eq('email', email).maybeSingle();
      return data;
    },

    async getUserById(id) {
      const { data } = await sb.from('users').select('*').eq('id', id).maybeSingle();
      return data;
    },

    async updateUserPlan(userId, plan) {
      const { error } = await sb.from('users').update({ plan }).eq('id', userId);
      check(error);
    },

    async updateUserRole(userId, role) {
      const { error } = await sb.from('users').update({ role }).eq('id', userId);
      check(error);
    },

    async deleteUser(userId) {
      const { error } = await sb.from('users').delete().eq('id', userId);
      check(error);
    },

    async getAllUsers() {
      const { data, error } = await sb
        .from('users')
        .select('id,email,name,plan,role,created_at')
        .order('created_at', { ascending: false });
      check(error);
      return data || [];
    },

    async countUsers() {
      const { count, error } = await sb.from('users').select('*', { count: 'exact', head: true });
      check(error);
      return count || 0;
    },

    // ── Links ──────────────────────────────────────────────────────────
    async createLink(shortCode, originalUrl, alias, ogTitle, ogDesc, ogImage, userId, linkType, videoUrl, videoOverlayText) {
      const { data, error } = await sb
        .from('links')
        .insert({
          short_code: shortCode,
          original_url: originalUrl,
          alias: alias || null,
          og_title: ogTitle || null,
          og_desc: ogDesc || null,
          og_image: ogImage || null,
          user_id: userId || null,
          link_type: linkType || 'direct',
          video_url: videoUrl || null,
          video_overlay_text: videoOverlayText || null,
          clicks: 0,
        })
        .select()
        .single();
      check(error, 'link');
      return data;
    },

    async getLinkByCode(code) {
      const { data } = await sb.from('links').select('*').eq('short_code', code).maybeSingle();
      return data;
    },

    async getLinkByAlias(alias) {
      if (!alias) return null;
      const { data } = await sb.from('links').select('*').eq('alias', alias).maybeSingle();
      return data;
    },

    async getLinkByUrl(url) {
      const { data } = await sb.from('links').select('*').eq('original_url', url).maybeSingle();
      return data;
    },

    async getLinkById(id) {
      const { data } = await sb.from('links').select('*').eq('id', id).maybeSingle();
      return data;
    },

    async recordClick(linkId, ip, ua, ref) {
      // Tăng click counter
      await sb.rpc('increment_clicks', { link_id: linkId });
      // Ghi click log
      await sb.from('clicks').insert({
        link_id: linkId,
        ip: ip || '',
        user_agent: ua || '',
        referrer: ref || '',
      });
    },

    async getRecentLinks(userId) {
      let query = sb.from('links').select('*').order('created_at', { ascending: false });
      if (userId) {
        query = query.eq('user_id', userId).limit(100);
      } else {
        query = query.limit(20);
      }
      const { data, error } = await query;
      check(error);
      return data || [];
    },

    async getAllLinks() {
      const { data, error } = await sb
        .from('links')
        .select('*, users(email)')
        .order('created_at', { ascending: false })
        .limit(200);
      check(error);
      // Flatten user email
      return (data || []).map(l => ({
        ...l,
        user_email: l.users?.email || null,
        users: undefined,
      }));
    },

    async deleteLink(linkId) {
      const { error } = await sb.from('links').delete().eq('id', linkId);
      check(error);
    },

    async updateLink(linkId, fields) {
      const allowed = ['original_url','alias','og_title','og_desc','og_image',
                       'link_type','video_url','video_overlay_text'];
      const updates = {};
      for (const [k, v] of Object.entries(fields)) {
        if (allowed.includes(k)) updates[k] = v ?? null;
      }
      if (!Object.keys(updates).length) return;
      const { error } = await sb.from('links').update(updates).eq('id', linkId);
      check(error);
    },

    async getTotals(userId) {
      let q1 = sb.from('links').select('*', { count: 'exact', head: true });
      let q2 = sb.from('links').select('clicks');
      if (userId) {
        q1 = q1.eq('user_id', userId);
        q2 = q2.eq('user_id', userId);
      }
      const [{ count }, { data: clickData }] = await Promise.all([q1, q2]);
      const totalClicks = (clickData || []).reduce((s, l) => s + (l.clicks || 0), 0);
      return { totalLinks: count || 0, totalClicks };
    },

    async getAdminTotals() {
      const [
        { count: totalLinks },
        { data: clickData },
        { count: totalUsers },
      ] = await Promise.all([
        sb.from('links').select('*', { count: 'exact', head: true }),
        sb.from('links').select('clicks'),
        sb.from('users').select('*', { count: 'exact', head: true }),
      ]);
      const totalClicks = (clickData || []).reduce((s, l) => s + (l.clicks || 0), 0);
      return { totalLinks: totalLinks || 0, totalClicks, totalUsers: totalUsers || 0 };
    },

    async countTodayLinks(userId) {
      const today = new Date().toISOString().slice(0, 10);
      let q = sb.from('links')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today + 'T00:00:00.000Z')
        .lt('created_at',  today + 'T23:59:59.999Z');
      if (userId) q = q.eq('user_id', userId);
      else        q = q.is('user_id', null);
      const { count } = await q;
      return count || 0;
    },

    async getTodayStats(userId) {
      const today = new Date().toISOString().slice(0, 10);
      // Links today
      let q1 = sb.from('links')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today + 'T00:00:00.000Z')
        .lt('created_at',  today + 'T23:59:59.999Z');
      if (userId) q1 = q1.eq('user_id', userId);

      // Clicks today
      let q2 = sb.from('clicks')
        .select('*', { count: 'exact', head: true })
        .gte('clicked_at', today + 'T00:00:00.000Z')
        .lt('clicked_at',  today + 'T23:59:59.999Z');
      if (userId) {
        // join qua link
        q2 = sb.from('clicks')
          .select('links!inner(user_id)', { count: 'exact', head: true })
          .eq('links.user_id', userId)
          .gte('clicked_at', today + 'T00:00:00.000Z')
          .lt('clicked_at',  today + 'T23:59:59.999Z');
      }

      const [{ count: linksToday }, { count: clicksToday }] = await Promise.all([q1, q2]);
      return { linksToday: linksToday || 0, clicksToday: clicksToday || 0 };
    },

    // ── Upload dedup ────────────────────────────────────────────────────────
    async getUploadByHash(hash) {
      const { data } = await sb.from('uploads').select('*').eq('hash', hash).maybeSingle();
      return data;
    },

    async saveUpload(hash, url, thumb, resource_type, public_id) {
      const { error } = await sb.from('uploads').upsert({
        hash, url, thumb: thumb || null,
        resource_type: resource_type || 'video',
        public_id: public_id || null,
      }, { onConflict: 'hash', ignoreDuplicates: true });
      if (error && !/duplicate|unique/i.test(error.message)) check(error);
    },
  };
}

module.exports = { init };
