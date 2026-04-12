import { supabase } from './supabase';
import type { CalendarProvider, ExternalCalendar, ExternalEvent, TaskItem } from '../types';

export class CalendarSyncService {
  private static instance: CalendarSyncService;

  static getInstance(): CalendarSyncService {
    if (!CalendarSyncService.instance) {
      CalendarSyncService.instance = new CalendarSyncService();
    }
    return CalendarSyncService.instance;
  }

  // OAuth and authentication methods
  async authenticateWithGoogle(): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
        redirectTo: `${window.location.origin}/auth/callback`
      }
    });

    if (error) {
      throw new Error(`Google authentication failed: ${error.message}`);
    }
  }

  async authenticateWithOutlook(): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'Calendars.Read Calendars.ReadWrite',
        redirectTo: `${window.location.origin}/auth/callback`
      }
    });

    if (error) {
      throw new Error(`Outlook authentication failed: ${error.message}`);
    }
  }

  // Fetch calendars from external providers
  async fetchGoogleCalendars(accessToken: string): Promise<Omit<ExternalCalendar, 'id' | 'user_id' | 'created_at' | 'updated_at'>[]> {
    const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Google Calendar API error: ${response.status}`);
    }

    const data = await response.json();
    return data.items.map((cal: any) => ({
      provider: 'google' as const,
      calendar_id: cal.id,
      calendar_name: cal.summary,
      calendar_description: cal.description,
      color: cal.backgroundColor,
      primary_calendar: cal.primary || false,
      sync_enabled: true,
      last_sync_at: null,
      sync_token: null
    }));
  }

  async fetchOutlookCalendars(accessToken: string): Promise<Omit<ExternalCalendar, 'id' | 'user_id' | 'created_at' | 'updated_at'>[]> {
    // Microsoft Graph API for Outlook calendars
    const response = await fetch('https://graph.microsoft.com/v1.0/me/calendars', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Microsoft Graph API error: ${response.status}`);
    }

    const data = await response.json();
    return data.value.map((cal: any) => ({
      provider: 'outlook' as const,
      calendar_id: cal.id,
      calendar_name: cal.name,
      calendar_description: cal.description,
      color: cal.color,
      primary_calendar: cal.isDefaultCalendar || false,
      sync_enabled: true,
      last_sync_at: null,
      sync_token: null
    }));
  }

  // Calendar management
  async getCalendars(): Promise<ExternalCalendar[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('external_calendars')
      .select('*')
      .order('created_at');

    if (error) {
      throw new Error(`Failed to fetch calendars: ${error.message}`);
    }

    return data || [];
  }

  async addCalendar(calendar: Omit<ExternalCalendar, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<ExternalCalendar> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('external_calendars')
      .insert([calendar])
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add calendar: ${error.message}`);
    }

    return data;
  }

  async updateCalendar(id: string, updates: Partial<ExternalCalendar>): Promise<ExternalCalendar> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('external_calendars')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update calendar: ${error.message}`);
    }

    return data;
  }

  async removeCalendar(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('external_calendars')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to remove calendar: ${error.message}`);
    }
  }

  /**
   * Pushes a local task to an external calendar as a new event.
   */
  async pushTaskToExternal(calendarId: string, task: TaskItem): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const calendar = await this.getCalendarById(calendarId);
    if (!calendar) throw new Error('Calendar not found');

    const { data: { session } } = await supabase.auth.getSession();
    const providerToken = session?.provider_token;
    if (!providerToken) throw new Error('No provider access token available');

    // Convert local schedule to ISO dates
    const start = new Date(`${task.scheduled_date}T00:00:00`);
    start.setMinutes(task.start_minutes);
    const end = new Date(start.getTime() + (task.duration * 60000));

    if (calendar.provider === 'google') {
      const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.calendar_id)}/events`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${providerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          summary: task.title,
          description: task.description,
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() }
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`Google API error: ${data.error?.message || response.status}`);
      return data.id;
    } else {
      const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendars/${calendar.calendar_id}/events`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${providerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subject: task.title,
          body: { contentType: 'HTML', content: task.description || '' },
          start: { 
            dateTime: start.toISOString(), 
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone 
          },
          end: { 
            dateTime: end.toISOString(), 
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone 
          }
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`Outlook API error: ${data.error?.message || response.status}`);
      return data.id;
    }
  }

  // Event synchronization
  async syncCalendar(calendarId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const calendar = await this.getCalendarById(calendarId);
    if (!calendar) {
      throw new Error('Calendar not found');
    }

    // Get access token from Supabase auth
    const { data: { session } } = await supabase.auth.getSession();
    const providerToken = session?.provider_token;
    if (!providerToken) {
      throw new Error('No provider access token available. Please re-authenticate.');
    }

    try {
      if (calendar.provider === 'google') {
        await this.syncGoogleCalendar(calendar, providerToken);
      } else if (calendar.provider === 'outlook') {
        await this.syncOutlookCalendar(calendar, providerToken);
      }

      // Update last sync timestamp
      await this.updateCalendar(calendarId, {
        last_sync_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
    }
  }

  private async syncGoogleCalendar(calendar: ExternalCalendar, accessToken: string): Promise<void> {
    const syncToken = calendar.sync_token;
    const url = syncToken
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.calendar_id)}/events?syncToken=${syncToken}`
      : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.calendar_id)}/events?singleEvents=true&orderBy=startTime`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Google Calendar API error: ${response.status}`);
    }

    const data = await response.json();
    const newSyncToken = data.nextSyncToken;

    // Process events
    const events: Omit<ExternalEvent, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = data.items
      .filter((event: any) => event.status !== 'cancelled')
      .map((event: any) => ({
        external_calendar_id: calendar.id,
        external_event_id: event.id,
        title: event.summary || 'Untitled Event',
        description: event.description,
        location: event.location,
        start_at: event.start.dateTime || event.start.date,
        end_at: event.end.dateTime || event.end.date,
        all_day: !event.start.dateTime,
        recurring: !!event.recurrence,
        recurrence_rule: event.recurrence?.[0],
        status: event.status,
        attendees: event.attendees,
        last_modified: event.updated
      }));

    // Upsert events
    if (events.length > 0) {
      const { error } = await supabase!
        .from('external_events')
        .upsert(events, {
          onConflict: 'external_calendar_id,external_event_id'
        });

      if (error) {
        throw new Error(`Failed to upsert events: ${error.message}`);
      }
    }

    // Update sync token
    if (newSyncToken) {
      await this.updateCalendar(calendar.id, { sync_token: newSyncToken });
    }
  }

  private async syncOutlookCalendar(calendar: ExternalCalendar, accessToken: string): Promise<void> {
    const url = `https://graph.microsoft.com/v1.0/me/calendars/${calendar.calendar_id}/events`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Prefer': 'outlook.body-content-type="text"'
      }
    });

    if (!response.ok) {
      throw new Error(`Microsoft Graph API error: ${response.status}`);
    }

    const data = await response.json();
    
    const events: Omit<ExternalEvent, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = data.value.map((event: any) => ({
      external_calendar_id: calendar.id,
      external_event_id: event.id,
      title: event.subject || 'Untitled Event',
      description: event.bodyPreview,
      location: event.location?.displayName,
      start_at: event.start.dateTime,
      end_at: event.end.dateTime,
      all_day: event.isAllDay,
      recurring: event.type === 'seriesMaster' || !!event.recurrence,
      recurrence_rule: JSON.stringify(event.recurrence),
      status: 'confirmed',
      attendees: event.attendees,
      last_modified: event.lastModifiedDateTime
    }));

    if (events.length > 0) {
      const { error } = await supabase!
        .from('external_events')
        .upsert(events, {
          onConflict: 'external_calendar_id,external_event_id'
        });

      if (error) {
        throw new Error(`Failed to upsert Outlook events: ${error.message}`);
      }
    }

    // Microsoft Graph uses Delta queries for sync tokens. 
    // For now, we update the last sync time.
    await this.updateCalendar(calendar.id, { 
      last_sync_at: new Date().toISOString() 
    });
  }

  private async getCalendarById(id: string): Promise<ExternalCalendar | null> {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('external_calendars')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  // Get events for a date range
  async getEvents(startDate: string, endDate: string): Promise<ExternalEvent[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('external_events')
      .select(`
        *,
        external_calendars!inner(sync_enabled)
      `)
      .gte('start_at', startDate)
      .lte('end_at', endDate)
      .eq('external_calendars.sync_enabled', true);

    if (error) {
      throw new Error(`Failed to fetch events: ${error.message}`);
    }

    return data || [];
  }
}

export const calendarSyncService = CalendarSyncService.getInstance();