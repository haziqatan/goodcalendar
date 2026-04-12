Here are the contents for the `src/components/CalendarIntegration.tsx` file:

import React, { useEffect } from 'react';
import { gapi } from 'gapi-script';
import { useState } from 'react';

const CalendarIntegration = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [events, setEvents] = useState([]);

  const handleClientLoad = () => {
    gapi.load('client:auth2', initClient);
  };

  const initClient = () => {
    gapi.client.init({
      apiKey: process.env.REACT_APP_GOOGLE_API_KEY,
      clientId: process.env.REACT_APP_GOOGLE_CLIENT_ID,
      discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
      scope: 'https://www.googleapis.com/auth/calendar.events',
    }).then(() => {
      const authInstance = gapi.auth2.getAuthInstance();
      setIsAuthenticated(authInstance.isSignedIn.get());
      authInstance.isSignedIn.listen(setIsAuthenticated);
    });
  };

  const handleAuthClick = () => {
    gapi.auth2.getAuthInstance().signIn();
  };

  const handleSignoutClick = () => {
    gapi.auth2.getAuthInstance().signOut();
  };

  const fetchEvents = () => {
    gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    }).then(response => {
      const events = response.result.items;
      setEvents(events);
    });
  };

  useEffect(() => {
    handleClientLoad();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchEvents();
    }
  }, [isAuthenticated]);

  return (
    <div>
      <h2>Calendar Integration</h2>
      {isAuthenticated ? (
        <div>
          <button onClick={handleSignoutClick}>Sign Out</button>
          <h3>Your Events:</h3>
          <ul>
            {events.map(event => (
              <li key={event.id}>
                {event.summary} - {new Date(event.start.dateTime || event.start.date).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <button onClick={handleAuthClick}>Sign In with Google</button>
      )}
    </div>
  );
};

export default CalendarIntegration;