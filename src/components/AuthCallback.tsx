import { useEffect } from 'react';

/**
 * Handles OAuth redirects for both:
 *  1. Popup flow (direct Google/Outlook OAuth) — posts token back to opener then closes
 *  2. Full-page redirect flow (Supabase OAuth) — redirects to /?calendarConnected=true
 */
export const AuthCallback: React.FC = () => {
  useEffect(() => {
    // Extract token from URL hash (implicit / token flow)
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const token = params.get('access_token');
    const error = params.get('error');

    if (window.opener) {
      // We're in a popup — relay the result back to the parent window and close
      window.opener.postMessage(
        { type: 'oauth-token', token: token ?? null, error: error ?? null },
        window.location.origin
      );
      window.close();
      return;
    }

    // Full-page redirect fallback
    if (token) {
      window.location.replace('/?calendarConnected=true');
    } else {
      window.location.replace('/');
    }
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
