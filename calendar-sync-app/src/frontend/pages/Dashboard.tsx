Here are the contents for the `src/components/CalendarIntegration.tsx` file, which provides functionality for integrating with external calendar services like Google Calendar and Outlook:

import React, { useEffect } from 'react';
import { gapi } from 'gapi-script';

const CalendarIntegration: React.FC = () => {
  useEffect(() => {
    const initClient = async () => {
      await gapi.client.init({
        apiKey: process.env.REACT_APP_GOOGLE_API_KEY,
        clientId: process.env.REACT_APP_GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/calendar',
        discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
      });
    };

    gapi.load('client:auth2', initClient);
  }, []);

  const handleLogin = async () => {
    try {
      await gapi.auth2.getAuthInstance().signIn();
      console.log('User signed in');
    } catch (error) {
      console.error('Error signing in', error);
    }
  };

  const handleLogout = async () => {
    try {
      await gapi.auth2.getAuthInstance().signOut();
      console.log('User signed out');
    } catch (error) {
      console.error('Error signing out', error);
    }
  };

  const syncWithGoogleCalendar = async () => {
    const response = await gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.result.items;
    console.log('Upcoming events:', events);
  };

  return (
    <div>
      <h2>Calendar Integration</h2>
      <button onClick={handleLogin}>Login with Google</button>
      <button onClick={handleLogout}>Logout</button>
      <button onClick={syncWithGoogleCalendar}>Sync with Google Calendar</button>
    </div>
  );
};

export default CalendarIntegration;