Here are the contents for the `src/components/CalendarIntegration.tsx` file:

import React, { useEffect } from 'react';
import { gapi } from 'gapi-script';

const CalendarIntegration = () => {
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

  const handleGoogleLogin = () => {
    gapi.auth2.getAuthInstance().signIn();
  };

  const handleGoogleLogout = () => {
    gapi.auth2.getAuthInstance().signOut();
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

  const syncWithOutlookCalendar = async () => {
    // Implement Outlook calendar integration logic here
  };

  return (
    <div>
      <h2>Calendar Integration</h2>
      <button onClick={handleGoogleLogin}>Login with Google</button>
      <button onClick={handleGoogleLogout}>Logout from Google</button>
      <button onClick={syncWithGoogleCalendar}>Sync with Google Calendar</button>
      <button onClick={syncWithOutlookCalendar}>Sync with Outlook Calendar</button>
    </div>
  );
};

export default CalendarIntegration;