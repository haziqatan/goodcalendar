import React, { useState, useEffect } from 'react';
import { Calendar, Trash2, RefreshCw } from 'lucide-react';
import { calendarSyncService } from '../lib/calendarSync';
import type { ExternalCalendar } from '../types';

interface CalendarIntegrationProps {
  onClose?: () => void;
}

export const CalendarIntegration: React.FC<CalendarIntegrationProps> = ({ onClose }) => {
  const [calendars, setCalendars] = useState<ExternalCalendar[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => {
    loadCalendars();
  }, []);

  const loadCalendars = async () => {
    try {
      const data = await calendarSyncService.getCalendars();
      setCalendars(data);
    } catch (error) {
      console.error('Failed to load calendars:', error);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      setLoading(true);
      await calendarSyncService.authenticateWithGoogle();
      // Note: The actual calendar fetching will happen after auth callback
    } catch (error) {
      console.error('Google auth failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOutlookAuth = async () => {
    try {
      setLoading(true);
      await calendarSyncService.authenticateWithOutlook();
      // Note: The actual calendar fetching will happen after auth callback
    } catch (error) {
      console.error('Outlook auth failed:', error);
    } finally {
      setLoading(false);
    }
  };


  const handleSync = async (calendarId: string) => {
    setSyncing(calendarId);
    try {
      await calendarSyncService.syncCalendar(calendarId);
      await loadCalendars(); // Refresh to show updated sync time
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncing(null);
    }
  };

  const handleToggleSync = async (calendar: ExternalCalendar) => {
    try {
      await calendarSyncService.updateCalendar(calendar.id, {
        sync_enabled: !calendar.sync_enabled
      });
      await loadCalendars();
    } catch (error) {
      console.error('Failed to toggle sync:', error);
    }
  };

  const handleRemoveCalendar = async (calendarId: string) => {
    if (!confirm('Are you sure you want to remove this calendar?')) return;

    try {
      await calendarSyncService.removeCalendar(calendarId);
      await loadCalendars();
    } catch (error) {
      console.error('Failed to remove calendar:', error);
    }
  };

  return (
    <div className="calendar-integration">
      <div className="integration-header">
        <h2>Calendar Integration</h2>
        <p>Sync with Google Calendar and Outlook</p>
      </div>

      <div className="auth-providers">
        <button
          onClick={handleGoogleAuth}
          className="auth-button google"
          disabled={loading}
        >
          <Calendar size={20} />
          Connect Google Calendar
        </button>

        <button
          onClick={handleOutlookAuth}
          className="auth-button outlook"
          disabled={loading}
        >
          <Calendar size={20} />
          Connect Outlook Calendar
        </button>
      </div>

      <div className="calendars-list">
        <h3>Your Calendars</h3>

        {calendars.length === 0 ? (
          <p className="no-calendars">No calendars connected yet. Connect a calendar above to get started.</p>
        ) : (
          calendars.map((calendar) => (
            <div key={calendar.id} className="calendar-item">
              <div className="calendar-info">
                <div
                  className="calendar-color"
                  style={{ backgroundColor: calendar.color || '#4285f4' }}
                />
                <div className="calendar-details">
                  <h4>{calendar.calendar_name}</h4>
                  <p>{calendar.provider === 'google' ? 'Google Calendar' : 'Outlook Calendar'}</p>
                  {calendar.last_sync_at && (
                    <small>Last synced: {new Date(calendar.last_sync_at).toLocaleString()}</small>
                  )}
                </div>
              </div>

              <div className="calendar-actions">
                <button
                  onClick={() => handleSync(calendar.id)}
                  disabled={syncing === calendar.id}
                  className="action-button sync"
                  title="Sync calendar"
                >
                  <RefreshCw size={16} className={syncing === calendar.id ? 'spinning' : ''} />
                </button>

                <button
                  onClick={() => handleToggleSync(calendar)}
                  className={`action-button toggle ${calendar.sync_enabled ? 'enabled' : 'disabled'}`}
                  title={calendar.sync_enabled ? 'Disable sync' : 'Enable sync'}
                >
                  {calendar.sync_enabled ? '✓' : '✗'}
                </button>

                <button
                  onClick={() => handleRemoveCalendar(calendar.id)}
                  className="action-button remove"
                  title="Remove calendar"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`
        .calendar-integration {
          padding: 20px;
          max-width: 600px;
          margin: 0 auto;
        }

        .integration-header {
          text-align: center;
          margin-bottom: 30px;
        }

        .integration-header h2 {
          margin: 0 0 10px 0;
          color: #333;
        }

        .integration-header p {
          margin: 0;
          color: #666;
        }

        .auth-providers {
          display: flex;
          gap: 15px;
          margin-bottom: 30px;
          justify-content: center;
        }

        .auth-button {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 20px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .auth-button.google {
          background: #4285f4;
          color: white;
        }

        .auth-button.google:hover {
          background: #3367d6;
        }

        .auth-button.outlook {
          background: #0078d4;
          color: white;
        }

        .auth-button.outlook:hover {
          background: #005a9e;
        }

        .auth-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .calendars-list h3 {
          margin: 0 0 15px 0;
          color: #333;
        }

        .no-calendars {
          text-align: center;
          color: #666;
          font-style: italic;
          padding: 40px 20px;
        }

        .calendar-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 15px;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          margin-bottom: 10px;
          background: white;
        }

        .calendar-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .calendar-color {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .calendar-details h4 {
          margin: 0 0 4px 0;
          font-size: 16px;
          font-weight: 500;
          color: #333;
        }

        .calendar-details p {
          margin: 0 0 4px 0;
          font-size: 14px;
          color: #666;
        }

        .calendar-details small {
          color: #888;
          font-size: 12px;
        }

        .calendar-actions {
          display: flex;
          gap: 8px;
        }

        .action-button {
          padding: 8px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .action-button.sync {
          background: #f0f8ff;
          color: #4285f4;
        }

        .action-button.sync:hover {
          background: #e0f0ff;
        }

        .action-button.toggle.enabled {
          background: #e8f5e8;
          color: #2e7d32;
        }

        .action-button.toggle.disabled {
          background: #ffebee;
          color: #c62828;
        }

        .action-button.remove {
          background: #fff5f5;
          color: #d32f2f;
        }

        .action-button.remove:hover {
          background: #ffeaea;
        }

        .action-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .spinning {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};