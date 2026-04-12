Here are the contents for the `src/components/CalendarIntegration.tsx` file:

import React, { useEffect } from 'react';
import { gapi } from 'gapi-script';

const CalendarIntegration: React.FC = () => {
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
      // Logic to sync tasks with Google Calendar
    } catch (error) {
      console.error('Error logging in to Google Calendar', error);
    }
  };

  const handleOutlookLogin = async () => {
    // Logic for Outlook authentication and syncing tasks
  };

  return (
    <div>
      <h2>Calendar Integration</h2>
      <button onClick={handleGoogleLogin}>Connect to Google Calendar</button>
      <button onClick={handleOutlookLogin}>Connect to Outlook Calendar</button>
    </div>
  );
};

export default CalendarIntegration;