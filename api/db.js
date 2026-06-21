const { createClient } = require('@supabase/supabase-js');
const rawTimeZoneOffset = Number(process.env.APP_TIME_ZONE_OFFSET_MINUTES);
const APP_TIME_ZONE_OFFSET_MINUTES = Number.isFinite(rawTimeZoneOffset) ? rawTimeZoneOffset : 420;
const CLICK_DEDUP_WINDOW_MS = 30000;

let _client = null;

function getDayWindowUtc(date = new Date(), offsetMinutes = APP_TIME_ZONE_OFFSET_MINUTES) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  const startUtcMs = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    0, 0, 0, 0,
  ) - offsetMinutes * 60 * 1000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000 - 1;
  return {
    start: new Date(startUtcMs).toISOString(),
    end: new Date(endUtcMs).toISOString(),
  };
}

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

    async updateUserName(userId, name) {
      const { error } = await sb.from('users').update({ name: name || null }).eq('id', userId);
      check(error);
    },

    async updateUserProfile(userId, profile = {}) {
      const payload = {
        name: profile.name || null,
        phone: profile.phone || null,
        avatar_url: profile.avatar_url || null,
      };
      const { error } = await sb.from('users').update(payload).eq('id', userId);
      check(error);
    },

    async updateUserTwoFactor(userId, state = {}) {
      const payload = {};
      if (Object.prototype.hasOwnProperty.call(state, 'two_factor_enabled')) {
        payload.two_factor_enabled = !!state.two_factor_enabled;
      }
      if (Object.prototype.hasOwnProperty.call(state, 'two_factor_secret')) {
        payload.two_factor_secret = state.two_factor_secret || null;
      }
      if (Object.prototype.hasOwnProperty.call(state, 'two_factor_pending_secret')) {
        payload.two_factor_pending_secret = state.two_factor_pending_secret || null;
      }
      if (Object.prototype.hasOwnProperty.call(state, 'two_factor_enabled_at')) {
        payload.two_factor_enabled_at = state.two_factor_enabled_at || null;
      }
      if (!Object.keys(payload).length) return;
      const { error } = await sb.from('users').update(payload).eq('id', userId);
      check(error);
    },

    async deleteUser(userId) {
      const { error } = await sb.from('users').delete().eq('id', userId);
      check(error);
    },

    async deleteUsers(userIds) {
      const ids = Array.isArray(userIds)
        ? [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
        : [];
      if (!ids.length) return;
      const { error } = await sb.from('users').delete().in('id', ids);
      check(error);
    },

    async getBioProfileByUserId(userId) {
      const { data } = await sb
        .from('bio_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      return data;
    },

    async getBioProfileBySlug(slug) {
      if (!slug) return null;
      const { data } = await sb
        .from('bio_profiles')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();
      return data;
    },

    async upsertBioProfile(userId, profile) {
      const payload = {
        user_id: userId,
        slug: profile.slug,
        title: profile.title || null,
        subtitle: profile.subtitle || null,
        avatar: profile.avatar || null,
        accent: profile.accent || '#3b82f6',
        link_count: Number(profile.link_count || 5),
        link_source: profile.link_source || 'recent',
        is_published: profile.is_published !== false,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await sb
        .from('bio_profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .single();
      check(error, 'bio');
      return data;
    },

    async getAllUsers() {
      const { data, error } = await sb
        .from('users')
        .select('id,email,name,plan,role,created_at')
        .order('created_at', { ascending: false });
      check(error);
      return data || [];
    },

    async createPaymentRequest(payload) {
      const { data, error } = await sb
        .from('payment_requests')
        .insert(payload)
        .select('*')
        .single();
      check(error, 'payment_request');
      return data;
    },

    async updatePaymentRequest(requestId, patch = {}) {
      const { data, error } = await sb
        .from('payment_requests')
        .update(patch)
        .eq('id', requestId)
        .select('*')
        .single();
      check(error, 'payment_request_update');
      return data;
    },

    async getPaymentRequestById(requestId) {
      const { data, error } = await sb
        .from('payment_requests')
        .select('*')
        .eq('id', requestId)
        .maybeSingle();
      check(error, 'payment_request_get');
      return data;
    },

    async listPaymentRequestsByUser(userId, limit = 20) {
      const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
      const { data, error } = await sb
        .from('payment_requests')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(safeLimit);
      check(error, 'payment_request_user_list');
      return data || [];
    },

    async getLatestActivePaymentRequestByUser(userId) {
      const { data, error } = await sb
        .from('payment_requests')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['awaiting_payment', 'submitted'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      check(error, 'payment_request_active_latest');
      return data || null;
    },

    async listPaymentRequests(limit = 200) {
      const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
      const { data, error } = await sb
        .from('payment_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(safeLimit);
      check(error, 'payment_request_list');
      return data || [];
    },

    async getWorkspaceByOwnerUserId(ownerUserId) {
      if (!ownerUserId) return null;
      const { data, error } = await sb
        .from('workspaces')
        .select('*')
        .eq('owner_user_id', ownerUserId)
        .maybeSingle();
      check(error, 'workspace_owner');
      return data;
    },

    async getWorkspaceById(workspaceId) {
      if (!workspaceId) return null;
      const { data, error } = await sb
        .from('workspaces')
        .select('*')
        .eq('id', workspaceId)
        .maybeSingle();
      check(error, 'workspace_id');
      return data;
    },

    async createWorkspace(ownerUserId, name) {
      const payload = {
        owner_user_id: ownerUserId,
        name: name || 'Workspace',
      };
      const { data, error } = await sb
        .from('workspaces')
        .insert(payload)
        .select('*')
        .single();
      check(error, 'workspace_create');
      return data;
    },

    async updateWorkspace(workspaceId, fields = {}) {
      const updates = {};
      if (Object.prototype.hasOwnProperty.call(fields, 'name')) {
        updates.name = fields.name || 'Workspace';
      }
      if (!Object.keys(updates).length) return null;
      updates.updated_at = new Date().toISOString();
      const { data, error } = await sb
        .from('workspaces')
        .update(updates)
        .eq('id', workspaceId)
        .select('*')
        .single();
      check(error, 'workspace_update');
      return data;
    },

    async listWorkspaceMembershipsForIdentity(userId, email) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      let query = sb
        .from('workspace_members')
        .select('*, workspaces(*)')
        .order('created_at', { ascending: true });
      if (userId && normalizedEmail) {
        query = query.or(`user_id.eq.${userId},email.eq.${normalizedEmail}`);
      } else if (userId) {
        query = query.eq('user_id', userId);
      } else if (normalizedEmail) {
        query = query.eq('email', normalizedEmail);
      } else {
        return [];
      }
      const { data, error } = await query;
      check(error, 'workspace_memberships_identity');
      return data || [];
    },

    async getWorkspaceMemberById(memberId) {
      if (!memberId) return null;
      const { data, error } = await sb
        .from('workspace_members')
        .select('*')
        .eq('id', memberId)
        .maybeSingle();
      check(error, 'workspace_member_id');
      return data;
    },

    async getWorkspaceMemberByWorkspaceAndEmail(workspaceId, email) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!workspaceId || !normalizedEmail) return null;
      const { data, error } = await sb
        .from('workspace_members')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('email', normalizedEmail)
        .maybeSingle();
      check(error, 'workspace_member_email');
      return data;
    },

    async listWorkspaceMembers(workspaceId) {
      if (!workspaceId) return [];
      const { data, error } = await sb
        .from('workspace_members')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true });
      check(error, 'workspace_member_list');
      return data || [];
    },

    async upsertWorkspaceMember(workspaceId, payload = {}) {
      const insertPayload = {
        workspace_id: workspaceId,
        user_id: payload.user_id || null,
        email: String(payload.email || '').trim().toLowerCase(),
        display_name: payload.display_name || null,
        role: payload.role || 'editor',
        status: payload.status || 'pending',
        invited_by: payload.invited_by || null,
        joined_at: payload.joined_at || null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await sb
        .from('workspace_members')
        .upsert(insertPayload, { onConflict: 'workspace_id,email' })
        .select('*')
        .single();
      check(error, 'workspace_member_upsert');
      return data;
    },

    async updateWorkspaceMember(memberId, fields = {}) {
      const updates = {};
      const allowed = ['user_id', 'display_name', 'role', 'status', 'joined_at'];
      for (const [key, value] of Object.entries(fields)) {
        if (allowed.includes(key)) {
          updates[key] = value ?? null;
        }
      }
      if (!Object.keys(updates).length) return null;
      updates.updated_at = new Date().toISOString();
      const { data, error } = await sb
        .from('workspace_members')
        .update(updates)
        .eq('id', memberId)
        .select('*')
        .single();
      check(error, 'workspace_member_update');
      return data;
    },

    async deleteWorkspaceMember(memberId) {
      const { error } = await sb
        .from('workspace_members')
        .delete()
        .eq('id', memberId);
      check(error, 'workspace_member_delete');
    },

    async listWorkspaceTemplates(workspaceId) {
      if (!workspaceId) return [];
      const { data, error } = await sb
        .from('workspace_link_templates')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });
      check(error, 'workspace_template_list');
      return data || [];
    },

    async getWorkspaceTemplateById(templateId) {
      if (!templateId) return null;
      const { data, error } = await sb
        .from('workspace_link_templates')
        .select('*')
        .eq('id', templateId)
        .maybeSingle();
      check(error, 'workspace_template_id');
      return data;
    },

    async createWorkspaceTemplate(payload = {}) {
      const insertPayload = {
        workspace_id: payload.workspace_id,
        created_by_user_id: payload.created_by_user_id || null,
        source_link_id: payload.source_link_id || null,
        name: payload.name || 'Template',
        og_title: payload.og_title || null,
        og_desc: payload.og_desc || null,
        og_image: payload.og_image || null,
        link_type: payload.link_type || 'direct',
        video_url: payload.video_url || null,
        video_overlay_text: payload.video_overlay_text || null,
        domain_hostname: payload.domain_hostname || null,
      };
      const { data, error } = await sb
        .from('workspace_link_templates')
        .insert(insertPayload)
        .select('*')
        .single();
      check(error, 'workspace_template_create');
      return data;
    },

    async countUsers() {
      const { count, error } = await sb.from('users').select('*', { count: 'exact', head: true });
      check(error);
      return count || 0;
    },

    async recordLoginEvent({
      userId,
      deviceFingerprint,
      deviceLabel,
      browserName,
      osName,
      deviceType,
      ip,
      userAgent,
    }) {
      if (!userId || !deviceFingerprint) return null;

      const [{ data: knownDevices, error: knownDevicesError }, { count: priorCount, error: priorCountError }] =
        await Promise.all([
          sb
            .from('login_events')
            .select('*')
            .eq('user_id', userId)
            .eq('device_fingerprint', deviceFingerprint)
            .limit(1),
          sb.from('login_events').select('*', { count: 'exact', head: true }).eq('user_id', userId),
        ]);
      if (
        knownDevicesError &&
        /login_events|relation .*login_events|schema cache/i.test(knownDevicesError.message || '')
      ) {
        return null;
      }
      if (
        priorCountError &&
        /login_events|relation .*login_events|schema cache/i.test(priorCountError.message || '')
      ) {
        return null;
      }
      check(knownDevicesError);
      check(priorCountError);

      const isNewDevice = !((knownDevices || []).length) && (priorCount || 0) > 0;
      const existingDevice = (knownDevices || [])[0] || null;
      const payload = {
        user_id: userId,
        device_fingerprint: deviceFingerprint,
        device_label: deviceLabel || null,
        browser_name: browserName || null,
        os_name: osName || null,
        device_type: deviceType || null,
        ip: ip || null,
        user_agent: userAgent || null,
        is_new_device: isNewDevice,
      };
      let data = null;
      let error = null;
      if (existingDevice?.id) {
        const result = await sb
          .from('login_events')
          .update({
            device_label: deviceLabel || existingDevice.device_label || null,
            browser_name: browserName || existingDevice.browser_name || null,
            os_name: osName || existingDevice.os_name || null,
            device_type: deviceType || existingDevice.device_type || null,
            ip: ip || existingDevice.ip || null,
            user_agent: userAgent || existingDevice.user_agent || null,
            occurred_at: new Date().toISOString(),
          })
          .eq('id', existingDevice.id)
          .select()
          .single();
        data = result.data;
        error = result.error;
      } else {
        const result = await sb.from('login_events').insert(payload).select().single();
        data = result.data;
        error = result.error;
      }
      if (error && /login_events|relation .*login_events|schema cache/i.test(error.message || '')) {
        return null;
      }
      check(error, 'login_event');
      return data;
    },

    async getLatestLoginEvent(userId) {
      if (!userId) return null;
      const { data, error } = await sb
        .from('login_events')
        .select('*')
        .eq('user_id', userId)
        .order('occurred_at', { ascending: false })
        .limit(1);
      if (error && /login_events|relation .*login_events|schema cache/i.test(error.message || '')) {
        return null;
      }
      check(error, 'login_event_latest');
      return (data || [])[0] || null;
    },

    async listLoginEvents(userId, limit = 20) {
      if (!userId) return [];
      const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
      const { data, error } = await sb
        .from('login_events')
        .select('*')
        .eq('user_id', userId)
        .order('occurred_at', { ascending: false })
        .limit(safeLimit);
      if (error && /login_events|relation .*login_events|schema cache/i.test(error.message || '')) {
        return [];
      }
      check(error, 'login_event_list');
      const seenFingerprints = new Set();
      return (data || [])
        .filter((event) => {
          const key = String(event?.device_fingerprint || event?.id || '');
          if (!key || seenFingerprints.has(key)) return false;
          seenFingerprints.add(key);
          return true;
        })
        .slice(0, safeLimit);
    },

    // ── Links ──────────────────────────────────────────────────────────
    async createLink(shortCode, originalUrl, alias, ogTitle, ogDesc, ogImage, userId, linkType, videoUrl, videoOverlayText, guestSessionId, domainHostname, extra = {}) {
      const payload = {
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
        guest_session_id: guestSessionId || null,
        clicks: 0,
      };
      if (domainHostname) {
        payload.domain_hostname = domainHostname;
      }
      if (extra.workspace_id) {
        payload.workspace_id = extra.workspace_id;
      }
      if (extra.template_id) {
        payload.template_id = extra.template_id;
      }
      if (Object.prototype.hasOwnProperty.call(extra, 'created_from_template')) {
        payload.created_from_template = !!extra.created_from_template;
      }

      let result = await sb.from('links').insert(payload).select().single();
      if (
        result.error &&
        /domain_hostname|workspace_id|template_id|created_from_template|schema cache/i.test(result.error.message || '')
      ) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.domain_hostname;
        delete fallbackPayload.workspace_id;
        delete fallbackPayload.template_id;
        delete fallbackPayload.created_from_template;
        result = await sb.from('links').insert(fallbackPayload).select().single();
      }
      check(result.error, 'link');
      return result.data;
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

    async getLinkByUrl(url, userId, guestSessionId) {
      let query = sb.from('links').select('*').eq('original_url', url);
      if (userId) {
        query = query.eq('user_id', userId);
      } else if (guestSessionId) {
        query = query.eq('guest_session_id', guestSessionId);
      } else {
        query = query.is('user_id', null).is('guest_session_id', null);
      }
      const { data } = await query.maybeSingle();
      return data;
    },

    async getLinkById(id) {
      const { data } = await sb.from('links').select('*').eq('id', id).maybeSingle();
      return data;
    },

    async recordClick(linkId, ip, ua, ref, meta = {}) {
      const normalizedIp = String(ip || '').trim();
      const normalizedUa = String(ua || '').trim();
      if (linkId && normalizedIp && normalizedUa) {
        const duplicateSince = new Date(Date.now() - CLICK_DEDUP_WINDOW_MS).toISOString();
        const { count, error: duplicateError } = await sb
          .from('clicks')
          .select('*', { count: 'exact', head: true })
          .eq('link_id', linkId)
          .eq('ip', normalizedIp)
          .eq('user_agent', normalizedUa)
          .gte('clicked_at', duplicateSince);
        check(duplicateError, 'click_dedup');
        if ((count || 0) > 0) {
          return { counted: false, deduped: true };
        }
      }
      // Tăng click counter
      await sb.rpc('increment_clicks', { link_id: linkId });
      // Ghi click log
      const payload = {
        link_id: linkId,
        ip: normalizedIp,
        user_agent: normalizedUa,
        referrer: ref || '',
      };
      if (meta.country_code) payload.country_code = meta.country_code;
      if (meta.country_name) payload.country_name = meta.country_name;
      if (meta.city) payload.city = meta.city;
      let result = await sb.from('clicks').insert(payload);
      if (
        result.error &&
        /country_code|country_name|city|schema cache/i.test(result.error.message || '')
      ) {
        const fallbackPayload = {
          link_id: linkId,
          ip: normalizedIp,
          user_agent: normalizedUa,
          referrer: ref || '',
        };
        result = await sb.from('clicks').insert(fallbackPayload);
      }
      check(result.error, 'click');
      return { counted: true, deduped: false };
    },

    async getRecentLinks(userId, guestSessionId) {
      let query = sb.from('links').select('*').order('created_at', { ascending: false });
      if (userId) {
        query = query.eq('user_id', userId).limit(100);
      } else if (guestSessionId) {
        query = query.eq('guest_session_id', guestSessionId).limit(100);
      } else {
        query = query.is('user_id', null).is('guest_session_id', null).limit(20);
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

    async deleteLinks(linkIds) {
      const ids = Array.isArray(linkIds)
        ? [...new Set(linkIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
        : [];
      if (!ids.length) return;
      const { error } = await sb.from('links').delete().in('id', ids);
      check(error);
    },

    async updateLink(linkId, fields) {
      const allowed = ['original_url','alias','og_title','og_desc','og_image',
                       'link_type','video_url','video_overlay_text','domain_hostname'];
      const updates = {};
      for (const [k, v] of Object.entries(fields)) {
        if (allowed.includes(k)) updates[k] = v ?? null;
      }
      if (!Object.keys(updates).length) return;
      const { error } = await sb.from('links').update(updates).eq('id', linkId);
      check(error);
    },

    async getTotals(userId, guestSessionId) {
      let q1 = sb.from('links').select('*', { count: 'exact', head: true });
      let q2 = sb.from('links').select('clicks');
      if (userId) {
        q1 = q1.eq('user_id', userId);
        q2 = q2.eq('user_id', userId);
      } else if (guestSessionId) {
        q1 = q1.eq('guest_session_id', guestSessionId);
        q2 = q2.eq('guest_session_id', guestSessionId);
      } else {
        q1 = q1.is('user_id', null).is('guest_session_id', null);
        q2 = q2.is('user_id', null).is('guest_session_id', null);
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

    async countTodayLinks(userId, guestSessionId) {
      const { start, end } = getDayWindowUtc();
      let q = sb.from('links')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', start)
        .lt('created_at',  end);
      if (userId) q = q.eq('user_id', userId);
      else if (guestSessionId) q = q.eq('guest_session_id', guestSessionId);
      else q = q.is('user_id', null).is('guest_session_id', null);
      const { count } = await q;
      return count || 0;
    },

    async getTodayStats(userId, guestSessionId) {
      const { start, end } = getDayWindowUtc();
      // Links today
      let q1 = sb.from('links')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', start)
        .lt('created_at',  end);
      if (userId) q1 = q1.eq('user_id', userId);
      else if (guestSessionId) q1 = q1.eq('guest_session_id', guestSessionId);
      else q1 = q1.is('user_id', null).is('guest_session_id', null);

      // Clicks today
      let q2 = sb.from('clicks')
        .select('*', { count: 'exact', head: true })
        .gte('clicked_at', start)
        .lt('clicked_at',  end);
      if (userId) {
        // join qua link
        q2 = sb.from('clicks')
          .select('links!inner(user_id)', { count: 'exact', head: true })
          .eq('links.user_id', userId)
          .gte('clicked_at', start)
          .lt('clicked_at',  end);
      } else if (guestSessionId) {
        q2 = sb.from('clicks')
          .select('links!inner(guest_session_id)', { count: 'exact', head: true })
          .eq('links.guest_session_id', guestSessionId)
          .gte('clicked_at', start)
          .lt('clicked_at',  end);
      } else {
        q2 = sb.from('clicks')
          .select('*', { count: 'exact', head: true })
          .eq('link_id', -1)
          .gte('clicked_at', start)
          .lt('clicked_at',  end);
      }

      const [{ count: linksToday }, { count: clicksToday }] = await Promise.all([q1, q2]);
      return { linksToday: linksToday || 0, clicksToday: clicksToday || 0 };
    },

    async getAdminTodayStats() {
      const { start, end } = getDayWindowUtc();
      const [
        { count: usersToday },
        { count: linksToday },
        { count: clicksToday },
      ] = await Promise.all([
        sb.from('users')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', start)
          .lt('created_at', end),
        sb.from('links')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', start)
          .lt('created_at', end),
        sb.from('clicks')
          .select('*', { count: 'exact', head: true })
          .gte('clicked_at', start)
          .lt('clicked_at', end),
      ]);
      return {
        usersToday: usersToday || 0,
        linksToday: linksToday || 0,
        clicksToday: clicksToday || 0,
      };
    },

    async getClickAnalytics(userId, guestSessionId, limit = 5000) {
      const buildQuery = (selectExpr) => {
        let q = sb
          .from('clicks')
          .select(selectExpr)
          .order('clicked_at', { ascending: false })
          .limit(limit);
        if (userId) q = q.eq('links.user_id', userId);
        else if (guestSessionId) q = q.eq('links.guest_session_id', guestSessionId);
        else q = q.is('links.user_id', null).is('links.guest_session_id', null);
        return q;
      };

      let result = await buildQuery(
        'id,link_id,ip,user_agent,referrer,clicked_at,country_code,country_name,city,links!inner(id,original_url,link_type,user_id,guest_session_id)',
      );
      if (
        result.error &&
        /country_code|country_name|city|schema cache/i.test(result.error.message || '')
      ) {
        result = await buildQuery(
          'id,link_id,ip,user_agent,referrer,clicked_at,links!inner(id,original_url,link_type,user_id,guest_session_id)',
        );
      }
      check(result.error, 'click_analytics');
      return (result.data || []).map((row) => ({
        ...row,
        link: row.links || null,
        links: undefined,
      }));
    },

    async getAdminClickAnalytics(limit = 5000) {
      const buildQuery = (selectExpr) =>
        sb
          .from('clicks')
          .select(selectExpr)
          .order('clicked_at', { ascending: false })
          .limit(limit);

      let result = await buildQuery(
        'id,link_id,ip,user_agent,referrer,clicked_at,country_code,country_name,city,links!inner(id,original_url,link_type,user_id,guest_session_id)',
      );
      if (
        result.error &&
        /country_code|country_name|city|schema cache/i.test(result.error.message || '')
      ) {
        result = await buildQuery(
          'id,link_id,ip,user_agent,referrer,clicked_at,links!inner(id,original_url,link_type,user_id,guest_session_id)',
        );
      }
      check(result.error, 'admin_click_analytics');
      return (result.data || []).map((row) => ({
        ...row,
        link: row.links || null,
        links: undefined,
      }));
    },

    async claimGuestLinks(guestSessionId, userId) {
      if (!guestSessionId || !userId) return;
      const { error } = await sb
        .from('links')
        .update({ user_id: userId, guest_session_id: null })
        .eq('guest_session_id', guestSessionId);
      check(error);
    },

    async getDomains() {
      const { data, error } = await sb
        .from('domains')
        .select('*')
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false });
      check(error);
      return data || [];
    },

    async getActiveDomains() {
      const { data, error } = await sb
        .from('domains')
        .select('*')
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false });
      check(error);
      return data || [];
    },

    async getPrimaryDomain() {
      const { data } = await sb
        .from('domains')
        .select('*')
        .eq('is_active', true)
        .eq('is_primary', true)
        .maybeSingle();
      return data;
    },

    async addDomain({
      hostname,
      label,
      isPrimary = false,
      verificationStatus = 'verified',
      expiresAt = null,
    }) {
      const payload = {
        hostname,
        label: label || null,
        is_primary: !!isPrimary,
        is_active: true,
        verification_status: verificationStatus || 'verified',
        expires_at: expiresAt || null,
      };
      let result = await sb.from('domains').insert(payload).select().single();
      if (
        result.error &&
        /verification_status|expires_at|schema cache/i.test(result.error.message || '')
      ) {
        const fallbackPayload = {
          hostname,
          label: label || null,
          is_primary: !!isPrimary,
          is_active: true,
        };
        result = await sb.from('domains').insert(fallbackPayload).select().single();
      }
      check(result.error);
      return result.data;
    },

    async setPrimaryDomain(domainId) {
      const { data: current } = await sb
        .from('domains')
        .select('id')
        .eq('id', domainId)
        .maybeSingle();
      if (!current) return null;
      const { error: clearError } = await sb
        .from('domains')
        .update({ is_primary: false })
        .eq('is_primary', true);
      check(clearError);
      const { data, error } = await sb
        .from('domains')
        .update({ is_primary: true, is_active: true })
        .eq('id', domainId)
        .select()
        .single();
      check(error);
      return data;
    },

    async updateDomain(domainId, fields) {
      const allowed = ['hostname', 'label', 'is_primary', 'is_active', 'verification_status', 'expires_at'];
      const updates = {};
      for (const [k, v] of Object.entries(fields || {})) {
        if (allowed.includes(k)) updates[k] = v;
      }
      if (!Object.keys(updates).length) return null;
      if (updates.is_primary) {
        await sb.from('domains').update({ is_primary: false }).eq('is_primary', true);
      }
      let result = await sb
        .from('domains')
        .update(updates)
        .eq('id', domainId)
        .select()
        .single();
      if (
        result.error &&
        /verification_status|expires_at|schema cache/i.test(result.error.message || '')
      ) {
        const fallbackUpdates = { ...updates };
        delete fallbackUpdates.verification_status;
        delete fallbackUpdates.expires_at;
        if (!Object.keys(fallbackUpdates).length) {
          result = await sb.from('domains').select('*').eq('id', domainId).maybeSingle();
        } else {
          result = await sb
            .from('domains')
            .update(fallbackUpdates)
            .eq('id', domainId)
            .select()
            .single();
        }
      }
      check(result.error);
      return result.data;
    },

    async deleteDomain(domainId) {
      const { error } = await sb.from('domains').delete().eq('id', domainId);
      check(error);
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
