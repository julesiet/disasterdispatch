import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useHeatmapStream } from '../hooks/useHeatmapStream';
import AddressSearch from '../components/AddressSearch';

const MAP_CENTER: [number, number] = [34.05, -118.24];
const IMMINENT_DISTANCE_M = 2000;
const APPROACHING_DISTANCE_M = 10000;
const WELCOME_SESSION_KEY = 'disasterdispatch.liveMapWelcomeSeen';

type Location = { lat: number; lng: number; source: 'manual' | 'device' | 'test' };
type Position2D = [number, number];
type ZoneFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
type Incident = {
  feature: ZoneFeature;
  distanceM: number;
  id: string;
  severity: string;
  source: string;
};
type ChatMessage = { id: number; sender: 'desk' | 'you'; text: string; time: string };

function zoneRings(feature: ZoneFeature): Position2D[][][] {
  if (feature.geometry.type === 'Polygon') {
    return [feature.geometry.coordinates as Position2D[][]];
  }
  return feature.geometry.coordinates as Position2D[][][];
}

function pointInRing(lng: number, lat: number, ring: Position2D[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointToSegmentMeters(
  pointLng: number,
  pointLat: number,
  start: Position2D,
  end: Position2D,
): number {
  const metersPerDegreeY = 111_320;
  const metersPerDegreeX = metersPerDegreeY * Math.cos((pointLat * Math.PI) / 180);
  const px = 0;
  const py = 0;
  const ax = (start[0]! - pointLng) * metersPerDegreeX;
  const ay = (start[1]! - pointLat) * metersPerDegreeY;
  const bx = (end[0]! - pointLng) * metersPerDegreeX;
  const by = (end[1]! - pointLat) * metersPerDegreeY;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (-(ax * dx + ay * dy)) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToZoneMeters(lng: number, lat: number, feature: ZoneFeature): number {
  const polygons = zoneRings(feature);
  let nearest = Number.POSITIVE_INFINITY;
  for (const rings of polygons) {
    const outer = rings[0];
    if (!outer || outer.length < 3) continue;
    const insideOuter = pointInRing(lng, lat, outer);
    const insideHole = rings.slice(1).some((ring) => pointInRing(lng, lat, ring));
    if (insideOuter && !insideHole) return 0;

    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i += 1) {
        nearest = Math.min(nearest, pointToSegmentMeters(lng, lat, ring[i]!, ring[i + 1]!));
      }
    }
  }
  return nearest;
}

function getZoneCenter(feature: ZoneFeature): [number, number] | null {
  const outer = zoneRings(feature)[0]?.[0];
  if (!outer?.length) return null;
  const points = outer.slice(0, -1).length ? outer.slice(0, -1) : outer;
  const total = points.reduce(
    (sum, point) => [sum[0] + point[0]!, sum[1] + point[1]!] as [number, number],
    [0, 0] as [number, number],
  );
  return [total[0]! / points.length, total[1]! / points.length];
}

function formatDistance(distanceM: number): string {
  return distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(1)} km`;
}

function displayZoneName(incident: Incident): string {
  return incident.source === 'firms' ? 'NASA FIRMS hotspot' : 'Reported incident';
}

function zonePopupContent(incident: Incident, hasSelectedLocation: boolean): string {
  const distanceContext = hasSelectedLocation ? 'SELECTED LOCATION' : 'MAP CENTER';
  return (
    `<strong>${displayZoneName(incident)}</strong>` +
    `<br/>SOURCE: ${incident.source.toUpperCase()}` +
    `<br/>SEVERITY: ${incident.severity.toUpperCase()}` +
    `<br/>DISTANCE FROM ${distanceContext}: ${formatDistance(incident.distanceM)}`
  );
}

function makeDeskMessage(incident: Incident, tier: 'evacuate' | 'advisory'): string {
  const distance = formatDistance(incident.distanceM);
  if (tier === 'evacuate') {
    return `Your selected location is ${distance} from an active danger zone. Move away from the hazard if you can do so safely, and follow instructions from local emergency authorities. Do you need help understanding your options?`;
  }
  return `Your selected location is ${distance} from an active danger zone. Conditions may change. Keep monitoring official updates and be ready to leave if authorities advise it. What would you like to know?`;
}

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function HeatmapPage() {
  const { data, status } = useHeatmapStream();
  const [location, setLocation] = useState<Location | null>(null);
  const [locationError, setLocationError] = useState('');
  const [locating, setLocating] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [focusedZoneId, setFocusedZoneId] = useState<string | null>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [welcomeComplete, setWelcomeComplete] = useState(
    () => window.sessionStorage.getItem(WELCOME_SESSION_KEY) === 'true',
  );
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const gridLayerRef = useRef<L.LayerGroup | null>(null);
  const locationLayerRef = useRef<L.LayerGroup | null>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);

  const reference = location ?? { lat: MAP_CENTER[0], lng: MAP_CENTER[1] };
  const incidents = useMemo<Incident[]>(() => {
    return (data?.zones.features ?? [])
      .filter(
        (feature): feature is ZoneFeature =>
          feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon',
      )
      .map((feature) => {
        const properties = (feature.properties ?? {}) as Record<string, unknown>;
        return {
          feature,
          distanceM: distanceToZoneMeters(reference.lng, reference.lat, feature),
          id: String(properties['id'] ?? ''),
          severity: String(properties['severity'] ?? 'approaching'),
          source: String(properties['source'] ?? 'admin'),
        };
      })
      .filter((incident) => Number.isFinite(incident.distanceM))
      .sort((left, right) => left.distanceM - right.distanceM);
  }, [data, reference.lat, reference.lng]);

  const nearestIncident = incidents[0] ?? null;
  const riskTier = !location || !nearestIncident
    ? null
    : nearestIncident.distanceM <= IMMINENT_DISTANCE_M
      ? 'evacuate'
      : nearestIncident.distanceM <= APPROACHING_DISTANCE_M
        ? 'advisory'
        : null;
  const conversationKey = riskTier && nearestIncident ? `${nearestIncident.id}:${riskTier}` : '';

  const totals = useMemo(() => {
    const gridFeatures = data?.grid.features ?? [];
    const count = (feature: GeoJSON.Feature, key: string) => {
      const value = (feature.properties as Record<string, unknown> | null)?.[key];
      return typeof value === 'number' ? value : 0;
    };
    return gridFeatures.reduce(
      (result, feature) => ({
        helped: result.helped + count(feature, 'helped'),
        waiting: result.waiting + count(feature, 'waiting'),
        atRisk: result.atRisk + count(feature, 'at_risk'),
      }),
      { helped: 0, waiting: 0, atRisk: 0 },
    );
  }, [data]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, { zoomControl: true }).setView(MAP_CENTER, 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    const residentGridPane = map.createPane('residentGridPane');
    residentGridPane.style.zIndex = '350';
    zonesLayerRef.current = L.layerGroup().addTo(map);
    gridLayerRef.current = L.layerGroup().addTo(map);
    locationLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const resizeFrame = window.requestAnimationFrame(() => map.invalidateSize());

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      map.remove();
      mapRef.current = null;
      zonesLayerRef.current = null;
      gridLayerRef.current = null;
      locationLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const zonesLayer = zonesLayerRef.current;
    const gridLayer = gridLayerRef.current;
    const locationLayer = locationLayerRef.current;
    if (!map || !zonesLayer || !gridLayer || !locationLayer) return;

    zonesLayer.clearLayers();
    for (const incident of incidents) {
      if (incident.id === focusedZoneId) continue;
      const colour = incident.severity === 'imminent' ? '#d84a32' : '#e58a35';
      L.geoJSON(incident.feature, {
        style: {
          color: colour,
          fillColor: colour,
          fillOpacity: 0.2,
          weight: 2,
        },
      })
        .bindPopup(zonePopupContent(incident, location !== null))
        .addTo(zonesLayer);
    }

    const focusedIncident = incidents.find((incident) => incident.id === focusedZoneId);
    if (focusedIncident) {
      const colour = focusedIncident.severity === 'imminent' ? '#d84a32' : '#e58a35';
      L.geoJSON(focusedIncident.feature, {
        style: {
          color: '#141b16',
          fillColor: colour,
          fillOpacity: 0.16,
          opacity: 0.95,
          weight: 10,
        },
      }).addTo(zonesLayer);
      L.geoJSON(focusedIncident.feature, {
        style: {
          color: '#fff06a',
          fillColor: colour,
          fillOpacity: 0.26,
          opacity: 1,
          weight: 4,
          dashArray: '9 5',
        },
      })
        .bindPopup(zonePopupContent(focusedIncident, location !== null))
        .addTo(zonesLayer);
    }

    gridLayer.clearLayers();
    for (const feature of data?.grid.features ?? []) {
      if (feature.geometry?.type !== 'Polygon') continue;
      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      const helped = Number(properties['helped'] ?? 0);
      const waiting = Number(properties['waiting'] ?? 0);
      const atRisk = Number(properties['at_risk'] ?? 0);
      if (helped + waiting + atRisk === 0) continue;
      const ring = feature.geometry.coordinates[0];
      if (!ring || ring.length < 4) continue;
      const centerLng = (ring[0]![0]! + ring[2]![0]!) / 2;
      const centerLat = (ring[0]![1]! + ring[2]![1]!) / 2;
      const isInsideDangerZone = incidents.some(
        (incident) => distanceToZoneMeters(centerLng, centerLat, incident.feature) === 0,
      );
      if (isInsideDangerZone) continue;
      const color = atRisk > 0 ? '#e7593d' : waiting > 0 ? '#e5ab4b' : '#4d967c';
      const rect = L.rectangle(
        [
          [ring[0]![1]!, ring[0]![0]!],
          [ring[2]![1]!, ring[2]![0]!],
        ],
        {
          pane: 'residentGridPane',
          color,
          fillColor: color,
          fillOpacity: atRisk > 0 ? Math.min(0.72, 0.24 + atRisk * 0.1) : 0.3,
          weight: 0.6,
        },
      );
      rect
        .bindPopup(
          `<strong>Resident status</strong><br/>Helped: ${helped}<br/>Waiting: ${waiting}<br/>At risk: ${atRisk}`,
        )
        .addTo(gridLayer);
    }

    locationLayer.clearLayers();
    if (location) {
      L.circle([location.lat, location.lng], {
        radius: APPROACHING_DISTANCE_M,
        color: '#ed9a4c',
        dashArray: '7 9',
        fillColor: '#ed9a4c',
        fillOpacity: 0.025,
        weight: 2,
      }).addTo(locationLayer);
      L.circle([location.lat, location.lng], {
        radius: IMMINENT_DISTANCE_M,
        color: '#d84a32',
        dashArray: '7 7',
        fillColor: '#d84a32',
        fillOpacity: 0.045,
        weight: 2,
      }).addTo(locationLayer);
      L.circleMarker([location.lat, location.lng], {
        radius: 8,
        color: '#fff',
        weight: 3,
        fillColor: '#2578d5',
        fillOpacity: 1,
      })
        .bindPopup('Selected location')
        .addTo(locationLayer);
    }
  }, [data, focusedZoneId, incidents, location]);

  useEffect(() => {
    if (!location || !mapRef.current) return;
    mapRef.current.flyTo([location.lat, location.lng], Math.max(mapRef.current.getZoom(), 11), {
      duration: 0.6,
    });
  }, [location]);

  useEffect(() => {
    if (!conversationKey || !nearestIncident || !riskTier) {
      setChatMessages([]);
      return;
    }
    setChatMessages([
      {
        id: Date.now(),
        sender: 'desk',
        text: makeDeskMessage(nearestIncident, riskTier),
        time: nowLabel(),
      },
    ]);
  }, [conversationKey]);

  useEffect(() => {
    chatBodyRef.current?.scrollTo({ top: chatBodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages]);

  const applyLocation = useCallback(
    (source: Location['source'], lat: number, lng: number) => {
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        setLocationError('That search result did not have a valid map location.');
        return;
      }
      setLocationError('');
      setLocation({ lat, lng, source });
    },
    [],
  );

  const useDeviceLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Location access is not available in this browser. Search for an address or place instead.');
      return;
    }
    setLocating(true);
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        applyLocation('device', coords.latitude, coords.longitude);
      },
      () => {
        setLocating(false);
        setLocationError('Could not access your location. Allow location access or search for an address.');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const testNearIncident = () => {
    const center = nearestIncident && getZoneCenter(nearestIncident.feature);
    if (!center) return;
    applyLocation('test', center[1], center[0]);
  };

  const focusIncident = (incident: Incident) => {
    setFocusedZoneId(incident.id);
    const bounds = L.geoJSON(incident.feature).getBounds();
    mapRef.current?.fitBounds(bounds.pad(0.7), { maxZoom: 13, duration: 0.7 });
  };

  const sendChatMessage = (text = chatInput) => {
    const message = text.trim();
    if (!message || !riskTier || !nearestIncident) return;
    const reply = /transport|ride|pickup|evacuat/i.test(message)
      ? 'This preview can show your proximity to the incident, but it does not submit a transport request. Follow local emergency guidance if you need help leaving.'
      : 'I can show how close this location is to the reported incident. Keep checking official local alerts for current instructions.';
    setChatMessages((current) => [
      ...current,
      { id: Date.now(), sender: 'you', text: message, time: nowLabel() },
      { id: Date.now() + 1, sender: 'desk', text: reply, time: nowLabel() },
    ]);
    setChatInput('');
  };

  const enterLiveMap = () => {
    window.sessionStorage.setItem(WELCOME_SESSION_KEY, 'true');
    setWelcomeComplete(true);
  };

  const isNear = riskTier !== null;
  const connectionLabel = status === 'connected' ? 'ZONE FEED LIVE' : status === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING';
  const sourceLabel = location?.source === 'device' ? 'DEVICE LOCATION' : location?.source === 'test' ? 'TEST LOCATION' : location ? 'SELECTED LOCATION' : 'LOCATION NOT SET';
  const selectedZone = nearestIncident;

  return (
    <main className={`incident-console${isNear ? ' has-resident-alert' : ''}`}>
      {!leftPanelCollapsed ? (
      <aside className={`incident-sidebar${welcomeComplete ? '' : ' incident-sidebar--welcome'}`} aria-label="Current incident status">
        {!welcomeComplete ? (
          <section className="welcome-panel" aria-labelledby="welcome-title">
            <p className="welcome-panel__eyebrow">LIVE INCIDENT MAP // COMMUNITY VIEW</p>
            <h1 id="welcome-title">Welcome to DisasterDispatch</h1>
            <p className="welcome-panel__intro">
              Check nearby incident zones and understand how close a location is to reported danger.
            </p>
            <div className="welcome-panel__steps" aria-label="How to use the live map">
              <div><span>01</span><p>Search an address or use your current location.</p></div>
              <div><span>02</span><p>Review the nearest active incident and its distance.</p></div>
              <div><span>03</span><p>Choose a zone to highlight it on the map.</p></div>
            </div>
            <button className="console-button console-button--primary welcome-panel__button" onClick={enterLiveMap}>
              Explore live map
            </button>
            <p className="welcome-panel__note">Proximity estimates are informational. Follow local emergency instructions.</p>
          </section>
        ) : (
          <>
        <div className="sidebar-section-title">
          <span>current incident status</span>
          <div className="sidebar-section-title__actions">
            <span className="mono-small">N={incidents.length.toLocaleString()}</span>
            <button
              aria-label="Collapse incident panel"
              className="panel-collapse-button"
              onClick={() => setLeftPanelCollapsed(true)}
              type="button"
            >
              ‹
            </button>
          </div>
        </div>

        {selectedZone ? (
          <section className="lead-incident">
            <p className="serif-title">{displayZoneName(selectedZone)}</p>
            <p className="mono-line">SOURCE: {selectedZone.source.toUpperCase()}</p>
            <p className="mono-line">STATUS: {selectedZone.severity.toUpperCase()}</p>
            <p className="mono-line">
              DISTANCE: {location ? formatDistance(selectedZone.distanceM) : 'FROM MAP CENTER'}
            </p>
            {!location && <p className="mono-line">SET A LOCATION TO ASSESS YOUR PROXIMITY</p>}
          </section>
        ) : (
          <section className="lead-incident lead-incident--empty">
            <p className="serif-title">No active incidents</p>
            <p className="mono-line">LIVE ZONE FEED IS CLEAR</p>
          </section>
        )}

        <section className="location-control" aria-labelledby="location-title">
          <div className="section-rule-title" id="location-title">YOUR LOCATION</div>
          <AddressSearch
            id="map-address-search"
            label="ADDRESS OR PLACE"
            onSelect={({ lat, lng }) => applyLocation('manual', lat, lng)}
          />
          <div className="location-actions">
            <button className="console-button" disabled={locating} onClick={useDeviceLocation}>
              {locating ? 'Locating…' : 'Use my location'}
            </button>
            <button
              className="console-button"
              disabled={!nearestIncident}
              onClick={testNearIncident}
              title="Set a simulated location at the nearest active incident"
            >
              Test near incident
            </button>
          </div>
          <p className="location-mode">{sourceLabel}</p>
          {locationError && <p className="console-error" role="alert">{locationError}</p>}
        </section>

        <section className="zone-list-section">
          <div className="section-rule-title">ZONES ON MAP</div>
          {incidents.length === 0 ? (
            <p className="sidebar-empty">No active zones are being reported.</p>
          ) : (
            <div className="zone-list">
              {incidents.slice(0, 8).map((incident, index) => {
                const statusLabel = !location
                  ? 'SET LOCATION'
                  : incident.distanceM <= IMMINENT_DISTANCE_M
                    ? 'IMMEDIATE PROXIMITY'
                    : incident.distanceM <= APPROACHING_DISTANCE_M
                      ? 'ADVISORY RANGE'
                      : 'OUTSIDE RISK RANGE';
                const level = incident.distanceM <= IMMINENT_DISTANCE_M ? 'imminent' : incident.distanceM <= APPROACHING_DISTANCE_M ? 'advisory' : 'safe';
                return (
                  <button
                    aria-pressed={focusedZoneId === incident.id}
                    className={`zone-card zone-card--${level}${index === 0 ? ' is-nearest' : ''}${focusedZoneId === incident.id ? ' is-selected' : ''}`}
                    key={incident.id || index}
                    onClick={() => focusIncident(incident)}
                  >
                    <span className="zone-card__main">
                      <span className="zone-card__name">Zone {incident.id.slice(0, 5).toUpperCase() || 'ACTIVE'}</span>
                      <span className="mono-small">{statusLabel}</span>
                    </span>
                    <span className="zone-card__distance">
                      {location ? formatDistance(incident.distanceM) : String(index + 1).padStart(2, '0')}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="resident-counts" aria-label="Resident counts">
          <div className="section-rule-title">RESIDENT COUNTS</div>
          <div className="count-row count-row--urgent"><span>IMMEDIATE</span><strong>{totals.atRisk.toLocaleString()}</strong></div>
          <div className="count-row count-row--advisory"><span>WAITING / ADVISORY</span><strong>{totals.waiting.toLocaleString()}</strong></div>
          <div className="count-row count-row--safe"><span>HELPED</span><strong>{totals.helped.toLocaleString()}</strong></div>
        </section>

        <p className="map-reference">
          Map bands show distance from your selected location. Proximity estimates are informational;
          follow official emergency instructions.
        </p>
          </>
        )}
      </aside>
      ) : (
        <button
          aria-label="Expand incident panel"
          className="panel-edge-tab panel-edge-tab--left"
          onClick={() => setLeftPanelCollapsed(false)}
          type="button"
        >
          <span aria-hidden="true">›</span> INCIDENTS
        </button>
      )}

      <section className="map-stage" aria-label="Live incident map">
        <div className="map-stage__map" ref={mapContainerRef} />
        <div className="map-status-pills">
          <span className={`map-status-pill${status === 'connected' ? ' is-live' : ''}`}>
            <i aria-hidden="true" /> {connectionLabel}
          </span>
          <span className="map-status-pill">{incidents.length} ACTIVE ZONES</span>
        </div>
        <div className="map-legend-console">
          <span><i className="legend-dot legend-dot--fire" /> IMMINENT</span>
          <span><i className="legend-dot legend-dot--advisory" /> APPROACHING</span>
          {location && <span><i className="legend-dot legend-dot--you" /> YOU</span>}
        </div>
      </section>

      {isNear && selectedZone && riskTier && !rightPanelCollapsed && (
        <aside className="resident-desk" aria-label="Resident alert and transport desk">
          <div className="resident-desk__heading">
            <span>resident alert // transport desk</span>
            <div className="resident-desk__heading-actions">
              <span className="mono-small">{riskTier === 'evacuate' ? 'SMS TIER 1' : 'SMS TIER 2'}</span>
              <button
                aria-label="Collapse resident alert panel"
                className="panel-collapse-button"
                onClick={() => setRightPanelCollapsed(true)}
                type="button"
              >
                ›
              </button>
            </div>
          </div>
          <div className={`alert-card${riskTier === 'evacuate' ? ' alert-card--urgent' : ' alert-card--advisory'}`}>
            <div className="alert-card__eyebrow">
              {riskTier === 'evacuate' ? 'IMMEDIATE PROXIMITY ALERT' : 'ADVISORY — NEARBY INCIDENT'}
            </div>
            <h2>{riskTier === 'evacuate' ? 'You are close to danger.' : 'An incident is nearby.'}</h2>
            <p>
              {displayZoneName(selectedZone)} is approximately <strong>{formatDistance(selectedZone.distanceM)}</strong> from your selected location.
              {riskTier === 'evacuate'
                ? ' Move away from the hazard if you can do so safely.'
                : ' Stay alert and be ready to follow local guidance.'}
            </p>
            <p className="alert-card__note">This is a proximity estimate, not an official evacuation order. Follow instructions from local authorities.</p>
          </div>

          <div className="chat-heading">
            <span>LIVE CHAT // SITUATION DESK</span>
            <span className="mono-small">PREVIEW</span>
          </div>
          <div className="chat-messages" ref={chatBodyRef} aria-live="polite" aria-label="Situation desk conversation">
            {chatMessages.map((message) => (
              <div className={`chat-message chat-message--${message.sender}`} key={message.id}>
                <span className="chat-message__time">{message.time} // {message.sender === 'you' ? 'YOU' : 'SITUATION DESK'}</span>
                <p>{message.text}</p>
              </div>
            ))}
          </div>
          <div className="chat-quick-replies">
            <button onClick={() => sendChatMessage('What should I do?')}>What should I do?</button>
            <button onClick={() => sendChatMessage('I need transport')}>I need transport</button>
          </div>
          <form
            className="chat-compose"
            onSubmit={(event) => {
              event.preventDefault();
              sendChatMessage();
            }}
          >
            <input
              aria-label="Message the situation desk"
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Type a reply…"
              value={chatInput}
            />
            <button disabled={!chatInput.trim()} type="submit">SEND</button>
          </form>
        </aside>
      )}
      {isNear && rightPanelCollapsed && (
        <button
          aria-label="Expand resident alert panel"
          className="panel-edge-tab panel-edge-tab--right"
          onClick={() => setRightPanelCollapsed(false)}
          type="button"
        >
          ALERT <span aria-hidden="true">‹</span>
        </button>
      )}
    </main>
  );
}
