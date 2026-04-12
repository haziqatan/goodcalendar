Here are the contents for the `src/components/CalendarIntegration.tsx` file:

import React, { useEffect } from 'react';
import { gapi } from 'gapi-script';
import { useAuth } from '../hooks/useAuth'; // Custom hook for authentication

const CalendarIntegration = () => {
  const { user, signIn, signOut } = useAuth();

  useEffect(() => {
    const initClient = () => {
      gapi.client.init({
        apiKey: process.env.REACT_APP_GOOGLE_API_KEY,
        clientId: process.env.REACT_APP_GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/calendar',
        discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
      });
    };

    gapi.load('client:auth2', initClient);
  }, []);

  const handleSignIn = () => {
    signIn();
  };

  const handleSignOut = () => {
    signOut();
  };

  const syncWithGoogleCalendar = async () => {
    if (!user) return;

    const response = await gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.result.items;
    // Process events and sync with local tasks
  };

  return (
    <div>
      <h2>Calendar Integration</h2>
      {user ? (
        <div>
          <p>Welcome, {user.name}</p>
          <button onClick={handleSignOut}>Sign Out</button>
          <button onClick={syncWithGoogleCalendar}>Sync with Google Calendar</button>
        </div>
      ) : (
        <button onClick={handleSignIn}>Sign In with Google</button>
      )}
    </div>
  );
};

export default CalendarIntegration;