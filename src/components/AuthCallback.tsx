import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { calendarSyncService } from '../lib/calendarSync';

export const AuthCallback: React.FC = () => {
  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        if (!supabase) {
          window.location.replace('/');
          return;
        }

        const { data, error } = await supabase.auth.getSession();

        if (error || !data.session) {
          console.error('Auth callback error:', error);
          window.location.replace('/');
          return;
        }

        const providerToken = data.session.provider_token;
        if (providerToken) {
          // Detect provider from the session and import calendars
          const provider = (data.session.user?.app_metadata?.provider ?? '') as string;
          try {
            if (provider === 'google') {
              const cals = await calendarSyncService.fetchGoogleCalendars(providerToken);
              for (const cal of cals) {
                try { await calendarSyncService.addCalendar(cal); } catch { /* already exists */ }
              }
            } else if (provider === 'azure') {
              const cals = await calendarSyncService.fetchOutlookCalendars(providerToken);
              for (const cal of cals) {
                try { await calendarSyncService.addCalendar(cal); } catch { /* already exists */ }
              }
            }
          } catch (err) {
            console.error('Failed to import calendars after auth:', err);
          }
        }

        window.location.replace('/?calendarConnected=true');
      } catch (err) {
        console.error('Auth callback failed:', err);
        window.location.replace('/');
      }
    };

    handleAuthCallback();
  }, []);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '4px solid #f3f3f3',
          borderTop: '4px solid #4285f4',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 20px'
        }} />
        <p>Connecting your calendar…</p>
      </div>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
