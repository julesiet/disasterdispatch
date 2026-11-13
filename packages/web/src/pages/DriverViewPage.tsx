import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const DRIVER_PROFILE_STORAGE_KEY = 'disasterdispatch.driverId';

type Driver = {
  id: string;
  name: string;
  phone: string;
  available: boolean;
  lat: number;
  lng: number;
};

type TransportRequest = {
  id: string;
  status: 'waiting' | 'assigned' | 'completed' | 'cancelled';
  tier: 'approaching' | 'imminent';
  priority: number;
  created_at: string;
  resident_id: string;
  resident_name: string;
  resident_phone: string;
  lat: number;
  lng: number;
  distance_m: number;
  dispatch_status: 'pending' | 'accepted' | 'declined' | 'completed' | null;
  pending_for_driver: boolean;
  assigned_to_driver: boolean;
};

type SmsMessage = {
  id: string;
  to_phone: string;
  body: string;
  direction: 'inbound' | 'outbound';
  created_at: string;
};

type RequestFeed = { driver: Driver; radius_m: number; requests: TransportRequest[] };

function miles(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function requestStatus(request: TransportRequest, driverAvailable?: boolean): string {
  if (request.status === 'completed') return 'COMPLETED';
  if (request.assigned_to_driver) return 'ASSIGNED TO YOU';
  if (request.pending_for_driver) return 'OFFERED TO YOU';
  if (request.dispatch_status === 'pending') return 'OFFERED TO ANOTHER DRIVER';
  if (request.status === 'waiting' && driverAvailable === false) return 'SET AVAILABLE TO ACCEPT';
  return 'OPEN REQUEST';
}

export default function DriverViewPage() {
  const [driverId, setDriverId] = useState<string | null>(() =>
    window.localStorage.getItem(DRIVER_PROFILE_STORAGE_KEY),
  );
  const [driver, setDriver] = useState<Driver | null>(null);
  const [radiusM, setRadiusM] = useState(25 * 1609.344);
  const [requests, setRequests] = useState<TransportRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [phoneInput, setPhoneInput] = useState('');
  const [replyInput, setReplyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedId) ?? null,
    [requests, selectedId],
  );

  const refreshRequests = useCallback(async () => {
    if (!driverId) return;
    try {
      const response = await fetch(`/api/v1/driver-view/${driverId}/requests`);
      const result = (await response.json()) as RequestFeed | { error?: string };
      if (!response.ok || !('requests' in result)) {
        throw new Error(('error' in result && result.error) || 'Could not load nearby requests.');
      }
      setDriver(result.driver);
      setRadiusM(result.radius_m);
      setRequests(result.requests);
      setError('');
      setSelectedId((current) => {
        const stillAccessible = result.requests.find((request) => request.id === current);
        if (
          !stillAccessible ||
          (stillAccessible.dispatch_status === 'pending' && !stillAccessible.pending_for_driver)
        ) {
          return null;
        }
        return current;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load nearby requests.');
    } finally {
      setLoading(false);
    }
  }, [driverId]);

  useEffect(() => {
    if (!driverId) return;
    setLoading(true);
    void refreshRequests();
    const interval = window.setInterval(() => void refreshRequests(), 5000);
    return () => window.clearInterval(interval);
  }, [driverId, refreshRequests]);

  const identifyDriver = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/v1/driver-view/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput.trim() }),
      });
      const result = (await response.json()) as {
        driver?: Driver;
        radius_m?: number;
        error?: string;
      };
      if (!response.ok || !result.driver) {
        throw new Error(result.error ?? 'No driver profile found for that phone.');
      }
      window.localStorage.setItem(DRIVER_PROFILE_STORAGE_KEY, result.driver.id);
      setDriver(result.driver);
      setRadiusM(result.radius_m ?? 25 * 1609.344);
      setDriverId(result.driver.id);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not find the driver profile.');
    } finally {
      setLoading(false);
    }
  };

  const refreshMessages = useCallback(async () => {
    if (!driverId || !selectedRequest) {
      setMessages([]);
      return;
    }
    try {
      const response = await fetch(
        `/api/v1/driver-view/${driverId}/requests/${selectedRequest.id}/messages`,
      );
      const result = (await response.json()) as { messages?: SmsMessage[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not load this conversation.');
      setMessages(result.messages ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load this conversation.');
    }
  }, [driverId, selectedRequest]);

  useEffect(() => {
    if (!selectedRequest) {
      setMessages([]);
      return;
    }
    void refreshMessages();
    const interval = window.setInterval(() => void refreshMessages(), 5000);
    return () => window.clearInterval(interval);
  }, [refreshMessages, selectedRequest]);

  const respondToRequest = async (request: TransportRequest, responseText: 'ACCEPT' | 'DECLINE') => {
    if (!driverId) return;
    setError('');
    setNotice('');
    try {
      const response = await fetch(
        `/api/v1/driver-view/${driverId}/requests/${request.id}/respond`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response: responseText }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not update this request.');
      setNotice(responseText === 'ACCEPT' ? `You accepted ${request.resident_name}'s request.` : 'Request declined and returned to dispatch.');
      await refreshRequests();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update this request.');
    }
  };

  const updateAvailability = async () => {
    if (!driver) return;
    setError('');
    try {
      const response = await fetch(`/api/v1/drivers/${driver.id}/availability`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available: !driver.available }),
      });
      const result = (await response.json()) as Driver & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not update availability.');
      setDriver(result);
      await refreshRequests();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update availability.');
    }
  };

  const sendMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!driverId || !selectedRequest || !replyInput.trim()) return;
    setSending(true);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/driver-view/${driverId}/requests/${selectedRequest.id}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: replyInput.trim() }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not send the message.');
      setReplyInput('');
      await refreshMessages();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send the message.');
    } finally {
      setSending(false);
    }
  };

  const switchDriver = () => {
    window.localStorage.removeItem(DRIVER_PROFILE_STORAGE_KEY);
    setDriverId(null);
    setDriver(null);
    setRequests([]);
    setSelectedId(null);
    setPhoneInput('');
  };

  if (!driverId) {
    return (
      <main className="page-shell driver-view driver-view--connect">
        <div className="driver-connect-card">
          <p className="eyebrow">Driver network</p>
          <h1 className="page-title">Open your driver view</h1>
          <p className="page-description">
            Enter the phone number on your driver profile to see nearby transport requests and
            resident messages.
          </p>
          <form className="driver-connect-form" onSubmit={identifyDriver}>
            <label htmlFor="driver-phone">Driver phone number</label>
            <input
              autoComplete="tel"
              id="driver-phone"
              onChange={(event) => setPhoneInput(event.target.value)}
              pattern="^\\+[1-9]\\d{1,14}$"
              placeholder="+15551234567"
              required
              type="tel"
              value={phoneInput}
            />
            <button className="primary-button" disabled={loading} type="submit">
              {loading ? 'Finding profile…' : 'Continue to driver view'}
            </button>
          </form>
          {error && <p className="form-feedback form-feedback--error" role="alert">{error}</p>}
          <p className="driver-connect-card__footer">
            New to the network? <Link to="/register/driver">Register a driver profile</Link>
          </p>
        </div>
      </main>
    );
  }

  const radiusMiles = Math.round(radiusM / 1609.344);
  const openCount = requests.filter((request) => request.status === 'waiting').length;
  const assignedCount = requests.filter((request) => request.assigned_to_driver).length;

  return (
    <main className="page-shell driver-view">
      <header className="driver-view__header">
        <div>
          <p className="eyebrow">Local transport network</p>
          <h1 className="page-title">Driver view</h1>
          <p className="page-description">
            Requests within {radiusMiles} miles of your registered location.
          </p>
        </div>
        <div className="driver-profile-card">
          <div>
            <strong>{driver?.name ?? 'Loading driver profile…'}</strong>
            <span>{driver?.phone}</span>
            {driver && (
              <span className={`driver-availability${driver.available ? ' is-available' : ''}`}>
                {driver.available ? 'Available for requests' : 'Not currently available'}
              </span>
            )}
          </div>
          {driver && (
            <div className="driver-profile-card__actions">
              <button className="driver-secondary-button" onClick={() => void updateAvailability()}>
                {driver.available ? 'Go unavailable' : 'Go available'}
              </button>
              <button className="driver-text-button" onClick={switchDriver}>Switch driver</button>
            </div>
          )}
        </div>
      </header>

      <div className="driver-stats" aria-label="Request totals">
        <div><strong>{requests.length}</strong><span>within radius</span></div>
        <div><strong>{openCount}</strong><span>need a driver</span></div>
        <div><strong>{assignedCount}</strong><span>assigned to you</span></div>
        <span className="driver-refresh-note">Refreshes automatically every 5 seconds</span>
      </div>

      {error && <p className="form-feedback form-feedback--error driver-feedback" role="alert">{error}</p>}
      {notice && <p className="form-feedback form-feedback--success driver-feedback" role="status">{notice}</p>}

      <div className="driver-workspace">
        <section className="request-board" aria-labelledby="request-board-title">
          <div className="driver-panel-heading">
            <h2 id="request-board-title">Nearby transport requests</h2>
            <span>{requests.length} REQUESTS</span>
          </div>
          {loading && requests.length === 0 ? (
            <p className="driver-empty">Loading requests…</p>
          ) : requests.length === 0 ? (
            <p className="driver-empty">
              No requests are currently within your {radiusMiles}-mile service radius.
            </p>
          ) : (
            <div className="request-list">
              {requests.map((request) => (
                <article
                  className={`request-card${request.id === selectedId ? ' is-selected' : ''}`}
                  key={request.id}
                >
                  <button
                    aria-pressed={request.id === selectedId}
                    className="request-card__select"
                  disabled={request.dispatch_status === 'pending' && !request.pending_for_driver}
                    onClick={() => setSelectedId(request.id)}
                  >
                    <span className="request-card__topline">
                      <strong>{request.resident_name}</strong>
                      <span className={`request-priority${request.priority === 1 ? ' is-urgent' : ''}`}>
                        {request.priority === 1 ? 'PRIORITY' : 'STANDARD'}
                      </span>
                    </span>
                    <span className="request-card__meta">
                      <span>{requestStatus(request, driver?.available)}</span>
                      <span>{miles(request.distance_m)} away</span>
                    </span>
                    <span className="request-card__details">
                      {request.tier.toUpperCase()} · {new Date(request.created_at).toLocaleString()}
                    </span>
                  </button>
                  <div className="request-card__actions">
                    <button
                      className="request-card__conversation"
                      disabled={request.dispatch_status === 'pending' && !request.pending_for_driver}
                      onClick={() => setSelectedId(request.id)}
                    >
                      {request.dispatch_status === 'pending' && !request.pending_for_driver
                        ? 'Offered to another driver'
                        : 'Resident history'}
                    </button>
                    {request.status === 'waiting' && (
                      <>
                        <button
                          className="request-card__accept"
                          disabled={
                            !request.pending_for_driver &&
                            (!driver?.available || request.dispatch_status === 'pending')
                          }
                          onClick={() => void respondToRequest(request, 'ACCEPT')}
                        >
                          Accept
                        </button>
                        {request.pending_for_driver && (
                          <button
                            className="request-card__decline"
                            onClick={() => void respondToRequest(request, 'DECLINE')}
                          >
                            Decline
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="resident-history" aria-labelledby="resident-history-title">
          {selectedRequest ? (
            <>
              <div className="driver-panel-heading resident-history__heading">
                <div>
                  <p className="eyebrow">Resident conversation</p>
                  <h2 id="resident-history-title">{selectedRequest.resident_name}</h2>
                  <span>{selectedRequest.resident_phone}</span>
                </div>
                  <span className="resident-history__status">
                    {requestStatus(selectedRequest, driver?.available)}
                  </span>
              </div>
              <div className="resident-history__messages" aria-live="polite">
                {messages.length === 0 ? (
                  <p className="driver-empty">No SMS history is logged for this resident yet.</p>
                ) : (
                  messages.map((message) => (
                    <article
                      className={`resident-message${message.direction === 'inbound' ? ' is-resident' : ''}`}
                      key={message.id}
                    >
                      <span>
                        {message.direction === 'inbound' ? 'RESIDENT' : 'OUTBOUND'} ·{' '}
                        {new Date(message.created_at).toLocaleString()}
                      </span>
                      <p>{message.body}</p>
                    </article>
                  ))
                )}
              </div>
              <form className="resident-message-form" onSubmit={sendMessage}>
                <input
                  aria-label={`Message ${selectedRequest.resident_name}`}
                  maxLength={500}
                  onChange={(event) => setReplyInput(event.target.value)}
                  placeholder="Message the resident…"
                  value={replyInput}
                />
                <button disabled={sending || !replyInput.trim()} type="submit">
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </form>
              <p className="resident-history__footnote">
                Messages use the local mock SMS service in this development build.
              </p>
            </>
          ) : (
            <div className="resident-history__empty">
              <p className="eyebrow">Resident conversation</p>
              <h2 id="resident-history-title">Select a request</h2>
              <p>Open a nearby request to review that resident’s SMS history and coordinate a response.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
