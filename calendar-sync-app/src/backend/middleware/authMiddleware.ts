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

  const handleGoogleLogin = async () => {
    try {
      await gapi.auth2.getAuthInstance().signIn();
      console.log('Google Calendar connected');
    } catch (error) {
      console.error('Error connecting to Google Calendar', error);
    }
  };

  const handleGoogleLogout = async () => {
    try {
      await gapi.auth2.getAuthInstance().signOut();
      console.log('Google Calendar disconnected');
    } catch (error) {
      console.error('Error disconnecting from Google Calendar', error);
    }
  };

  const syncWithGoogleCalendar = async () => {
    // Logic to sync tasks with Google Calendar
  };

  const syncWithOutlookCalendar = async () => {
    // Logic to sync tasks with Outlook Calendar
  };

  return (
    <div>
      <h2>Calendar Integration</h2>
      <button onClick={handleGoogleLogin}>Connect to Google Calendar</button>
      <button onClick={handleGoogleLogout}>Disconnect from Google Calendar</button>
      <button onClick={syncWithGoogleCalendar}>Sync with Google Calendar</button>
      <button onClick={syncWithOutlookCalendar}>Sync with Outlook Calendar</button>
    </div>
  );
};

export default CalendarIntegration;