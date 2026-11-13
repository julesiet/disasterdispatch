import { useMemo, useState } from 'react';
import AddressSearch from '../components/AddressSearch';

type AdminDriver = {
  id: string;
  name: string;
  phone: string;
  available: boolean;
  lat: number;
  lng: number;
  created_at: string;
};

type AdminResident = {
  id: string;
  name: string;
  phone: string;
  lat: number;
  lng: number;
  created_at: string;
};

type AdminZone = {
  id: string;
  source: string;
  severity: 'approaching' | 'imminent';
  active: boolean;
  lat: number;
  lng: number;
  created_at: string;
  updated_at: string;
};

type AdminOverview = {
  drivers: AdminDriver[];
  residents: AdminResident[];
  zones: AdminZone[];
  generated_at: string;
};

type View = 'residents' | 'drivers' | 'zones';
type EditorTarget =
  | { kind: 'resident'; record?: AdminResident }
  | { kind: 'driver'; record?: AdminDriver }
  | { kind: 'zone'; record?: AdminZone };
const ADMIN_KEY_STORAGE = 'disasterdispatch.adminKey';
const PHONE_PATTERN = '^\\+[1-9]\\d{1,14}$';

function dateLabel(value: string): string {
  return new Date(value).toLocaleString();
}

function coordinates(lat: number, lng: number): string {
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

function AdminRecordEditor({
  target,
  apiKey,
  onClose,
  onSaved,
}: {
  target: EditorTarget;
  apiKey: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(target.record && 'name' in target.record ? target.record.name : '');
  const [phone, setPhone] = useState(target.record && 'phone' in target.record ? target.record.phone : '');
  const [lat, setLat] = useState<number | null>(target.record && 'lat' in target.record ? Number(target.record.lat) : null);
  const [lng, setLng] = useState<number | null>(target.record && 'lng' in target.record ? Number(target.record.lng) : null);
  const [available, setAvailable] = useState(target.record && 'available' in target.record ? target.record.available : true);
  const [severity, setSeverity] = useState<AdminZone['severity']>(target.record && 'severity' in target.record ? target.record.severity : 'imminent');
  const [active, setActive] = useState(target.record && 'active' in target.record ? target.record.active : true);
  const [south, setSouth] = useState('');
  const [west, setWest] = useState('');
  const [north, setNorth] = useState('');
  const [east, setEast] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isEditing = Boolean(target.record);
  const title = `${isEditing ? 'Edit' : 'Create'} ${target.kind === 'resident' ? 'user / resident' : target.kind}`;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      let url: string;
      let method: string;
      let body: Record<string, unknown>;
      if (target.kind === 'zone') {
        if (target.record) {
          url = `/api/v1/admin/overview/zones/${target.record.id}`;
          method = 'PATCH';
          body = { severity, active };
        } else {
          url = '/api/v1/admin/overview/zones';
          method = 'POST';
          body = { severity, south: Number(south), west: Number(west), north: Number(north), east: Number(east) };
        }
      } else {
        if (lat === null || lng === null) throw new Error('Search for and select a map location first.');
        const isDriver = target.kind === 'driver';
        url = `/api/v1/admin/overview/${isDriver ? 'drivers' : 'residents'}${target.record ? `/${target.record.id}` : ''}`;
        method = target.record ? 'PATCH' : 'POST';
        body = { name: name.trim(), phone: phone.trim(), lat, lng, ...(isDriver ? { available } : {}) };
      }

      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not save this record.');
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this record.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="admin-editor-title" aria-modal="true" className="admin-modal" role="dialog">
        <header className="admin-modal__header">
          <div><p className="eyebrow">Database record</p><h2 id="admin-editor-title">{title}</h2></div>
          <button aria-label="Close editor" className="admin-modal__close" onClick={onClose} type="button">×</button>
        </header>
        <form className="admin-editor-form" onSubmit={submit}>
          {target.kind !== 'zone' ? (
            <>
              <label className="admin-field"><span>Name</span><input maxLength={120} onChange={(event) => setName(event.target.value)} required value={name} /></label>
              <label className="admin-field"><span>Phone (international format)</span><input onChange={(event) => setPhone(event.target.value)} pattern={PHONE_PATTERN} placeholder="+15551234567" required value={phone} /></label>
              <div className="admin-location-field">
                <AddressSearch
                  id="admin-record-location"
                  label="Search for a location"
                  onSelect={(selected) => { setLat(selected.lat); setLng(selected.lng); }}
                />
                <p className={`admin-selected-location${lat === null || lng === null ? ' is-missing' : ''}`}>
                  {lat === null || lng === null ? 'Select a search result to set the map point.' : `Current map point: ${coordinates(lat, lng)}`}
                </p>
              </div>
              {target.kind === 'driver' && (
                <label className="admin-checkbox"><input checked={available} onChange={(event) => setAvailable(event.target.checked)} type="checkbox" /><span>Available for requests</span></label>
              )}
            </>
          ) : (
            <>
              <label className="admin-field"><span>Severity</span><select onChange={(event) => setSeverity(event.target.value as AdminZone['severity'])} value={severity}><option value="imminent">Imminent</option><option value="approaching">Approaching</option></select></label>
              {target.record ? (
                <label className="admin-checkbox"><input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" /><span>Zone is active</span></label>
              ) : (
                <>
                  <p className="admin-editor-help">Create a rectangular zone. Coordinates are decimal degrees; use west/east longitudes and south/north latitudes.</p>
                  <div className="admin-zone-coordinates">
                    <label className="admin-field"><span>South latitude</span><input max="90" min="-90" onChange={(event) => setSouth(event.target.value)} required step="any" type="number" value={south} /></label>
                    <label className="admin-field"><span>West longitude</span><input max="180" min="-180" onChange={(event) => setWest(event.target.value)} required step="any" type="number" value={west} /></label>
                    <label className="admin-field"><span>North latitude</span><input max="90" min="-90" onChange={(event) => setNorth(event.target.value)} required step="any" type="number" value={north} /></label>
                    <label className="admin-field"><span>East longitude</span><input max="180" min="-180" onChange={(event) => setEast(event.target.value)} required step="any" type="number" value={east} /></label>
                  </div>
                </>
              )}
            </>
          )}
          {error && <p className="form-feedback form-feedback--error" role="alert">{error}</p>}
          <footer className="admin-modal__actions">
            <button className="driver-secondary-button" disabled={saving} onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={saving} type="submit">{saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create record'}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function AdminDebugPage() {
  const [apiKey, setApiKey] = useState(() => window.sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? '');
  const [data, setData] = useState<AdminOverview | null>(null);
  const [view, setView] = useState<View>('residents');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  const loadOverview = async (key = apiKey) => {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      setError('Enter the ADMIN_API_KEY from your local .env file.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/v1/admin/overview', {
        headers: { 'x-api-key': trimmedKey },
      });
      const result = (await response.json()) as AdminOverview | { error?: string };
      if (!response.ok) {
        const apiError = 'error' in result ? result.error : undefined;
        throw new Error(response.status === 401 ? 'That admin key was not accepted.' : apiError ?? 'Could not load admin data.');
      }
      setData(result as AdminOverview);
      setApiKey(trimmedKey);
      window.sessionStorage.setItem(ADMIN_KEY_STORAGE, trimmedKey);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : 'Could not load admin data.');
    } finally {
      setLoading(false);
    }
  };

  const clearKey = () => {
    window.sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    setApiKey('');
    setData(null);
    setError('');
  };

  const deleteRecord = async (kind: 'resident' | 'driver' | 'zone', id: string, label: string) => {
    const effect = kind === 'resident'
      ? 'This also permanently deletes that resident’s alerts and transport requests.'
      : kind === 'zone'
        ? 'This also permanently deletes alerts linked to the zone.'
        : 'Past transport requests will remain, but this driver will be removed from them. Drivers with an active assigned request cannot be deleted.';
    if (!window.confirm(`Permanently delete ${label}? ${effect}`)) return;

    setLoading(true);
    setError('');
    try {
      const endpoint = kind === 'zone' ? 'zones' : kind === 'driver' ? 'drivers' : 'residents';
      const response = await fetch(`/api/v1/admin/overview/${endpoint}/${id}`, {
        method: 'DELETE',
        headers: { 'x-api-key': apiKey },
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `Could not delete ${label}.`);
      await loadOverview(apiKey);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : `Could not delete ${label}.`);
    } finally {
      setLoading(false);
    }
  };

  const startCreate = () => {
    setEditor(view === 'residents' ? { kind: 'resident' } : view === 'drivers' ? { kind: 'driver' } : { kind: 'zone' });
  };

  const finishSave = () => {
    setEditor(null);
    void loadOverview(apiKey);
  };

  const filteredResidents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.residents ?? []).filter((resident) =>
      !needle || [resident.name, resident.phone, resident.id, resident.lat, resident.lng].join(' ').toLowerCase().includes(needle),
    );
  }, [data, search]);

  const filteredDrivers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.drivers ?? []).filter((driver) =>
      !needle || [driver.name, driver.phone, driver.id, driver.lat, driver.lng, driver.available ? 'available' : 'unavailable'].join(' ').toLowerCase().includes(needle),
    );
  }, [data, search]);

  const filteredZones = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.zones ?? []).filter((zone) =>
      !needle || [zone.id, zone.source, zone.severity, zone.active ? 'active' : 'inactive', zone.lat, zone.lng].join(' ').toLowerCase().includes(needle),
    );
  }, [data, search]);

  const counts = {
    residents: data?.residents.length ?? 0,
    drivers: data?.drivers.length ?? 0,
    availableDrivers: data?.drivers.filter((driver) => driver.available).length ?? 0,
    activeZones: data?.zones.filter((zone) => zone.active).length ?? 0,
  };

  return (
    <main className="admin-page">
      <header className="admin-page__header">
        <div>
          <p className="eyebrow">Local development tools</p>
          <h1 className="page-title">Admin debug view</h1>
          <p className="page-description">
            Review registered residents, drivers, and every incident zone in the local database.
          </p>
        </div>
        {data && (
          <button className="driver-secondary-button" disabled={loading} onClick={() => void loadOverview()}>
            {loading ? 'Refreshing…' : 'Refresh data'}
          </button>
        )}
      </header>

      <form
        className="admin-key-card"
        onSubmit={(event) => {
          event.preventDefault();
          void loadOverview();
        }}
      >
        <div>
          <strong>Connect to local admin data</strong>
          <p>Enter ADMIN_API_KEY from this project’s .env file. The key stays in this browser tab session.</p>
        </div>
        <label className="admin-key-card__field">
          <span>Admin API key</span>
          <input
            autoComplete="current-password"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Enter your local admin key"
            type="password"
            value={apiKey}
          />
        </label>
        <div className="admin-key-card__actions">
          <button className="primary-button" disabled={loading || !apiKey.trim()} type="submit">
            {loading ? 'Connecting…' : data ? 'Reconnect' : 'Connect'}
          </button>
          {apiKey && <button className="driver-text-button" onClick={clearKey} type="button">Clear key</button>}
        </div>
        {error && <p className="form-feedback form-feedback--error" role="alert">{error}</p>}
      </form>

      {data && (
        <>
          <section className="admin-stats" aria-label="Database totals">
            <div><strong>{counts.residents}</strong><span>Users / residents</span></div>
            <div><strong>{counts.drivers}</strong><span>Drivers</span></div>
            <div><strong>{counts.availableDrivers}</strong><span>Available drivers</span></div>
            <div><strong>{counts.activeZones}</strong><span>Active zones</span></div>
            <p>Updated {dateLabel(data.generated_at)}</p>
          </section>

          <section className="admin-data-card" aria-label="Database records">
            <div className="admin-data-card__toolbar">
              <div className="admin-tabs" role="tablist" aria-label="Admin data categories">
                {([
                  ['residents', 'Users / residents', counts.residents],
                  ['drivers', 'Drivers', counts.drivers],
                  ['zones', 'Zones', data.zones.length],
                ] as const).map(([id, label, count]) => (
                  <button
                    aria-selected={view === id}
                    className={`admin-tab${view === id ? ' is-active' : ''}`}
                    key={id}
                    onClick={() => {
                      setView(id);
                      setSearch('');
                    }}
                    role="tab"
                    type="button"
                  >
                    {label}<span>{count}</span>
                  </button>
                ))}
              </div>
              <label className="admin-search">
                <span>Filter {view}</span>
                <input
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={view === 'zones' ? 'ID, source, severity…' : 'Name, phone, or ID…'}
                  value={search}
                />
              </label>
              <button className="admin-create-button" disabled={loading} onClick={startCreate} type="button">
                + Add {view === 'residents' ? 'user' : view === 'drivers' ? 'driver' : 'zone'}
              </button>
            </div>

            {view === 'residents' && (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Resident</th><th>Phone</th><th>Location</th><th>Registered</th><th>Record ID</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredResidents.map((resident) => (
                      <tr key={resident.id}>
                        <td data-label="Resident">{resident.name}</td>
                        <td data-label="Phone">{resident.phone}</td>
                        <td data-label="Location"><a href={`https://www.openstreetmap.org/?mlat=${resident.lat}&mlon=${resident.lng}#map=16/${resident.lat}/${resident.lng}`} rel="noreferrer" target="_blank">{coordinates(resident.lat, resident.lng)}</a></td>
                        <td data-label="Registered">{dateLabel(resident.created_at)}</td>
                        <td className="admin-id" data-label="Record ID">{resident.id}</td>
                        <td className="admin-actions" data-label="Actions">
                          <button onClick={() => setEditor({ kind: 'resident', record: resident })} type="button">Edit</button>
                          <button className="is-delete" disabled={loading} onClick={() => void deleteRecord('resident', resident.id, resident.name)} type="button">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredResidents.length === 0 && <p className="admin-empty">No residents match this filter.</p>}
              </div>
            )}

            {view === 'drivers' && (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Driver</th><th>Phone</th><th>Availability</th><th>Service location</th><th>Registered</th><th>Record ID</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredDrivers.map((driver) => (
                      <tr key={driver.id}>
                        <td data-label="Driver">{driver.name}</td>
                        <td data-label="Phone">{driver.phone}</td>
                        <td data-label="Availability"><span className={`admin-status${driver.available ? ' is-good' : ' is-muted'}`}>{driver.available ? 'Available' : 'Unavailable'}</span></td>
                        <td data-label="Service location"><a href={`https://www.openstreetmap.org/?mlat=${driver.lat}&mlon=${driver.lng}#map=16/${driver.lat}/${driver.lng}`} rel="noreferrer" target="_blank">{coordinates(driver.lat, driver.lng)}</a></td>
                        <td data-label="Registered">{dateLabel(driver.created_at)}</td>
                        <td className="admin-id" data-label="Record ID">{driver.id}</td>
                        <td className="admin-actions" data-label="Actions">
                          <button onClick={() => setEditor({ kind: 'driver', record: driver })} type="button">Edit</button>
                          <button className="is-delete" disabled={loading} onClick={() => void deleteRecord('driver', driver.id, driver.name)} type="button">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredDrivers.length === 0 && <p className="admin-empty">No drivers match this filter.</p>}
              </div>
            )}

            {view === 'zones' && (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Zone</th><th>Source</th><th>Severity</th><th>Status</th><th>Map center</th><th>Created</th><th>Record ID</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredZones.map((zone) => (
                      <tr key={zone.id}>
                        <td data-label="Zone">{zone.source === 'firms' ? 'NASA FIRMS hotspot' : 'Reported incident'}</td>
                        <td data-label="Source">{zone.source.toUpperCase()}</td>
                        <td data-label="Severity"><span className={`admin-status${zone.severity === 'imminent' ? ' is-danger' : ' is-warning'}`}>{zone.severity}</span></td>
                        <td data-label="Status"><span className={`admin-status${zone.active ? ' is-good' : ' is-muted'}`}>{zone.active ? 'Active' : 'Inactive'}</span></td>
                        <td data-label="Map center"><a href={`https://www.openstreetmap.org/?mlat=${zone.lat}&mlon=${zone.lng}#map=15/${zone.lat}/${zone.lng}`} rel="noreferrer" target="_blank">{coordinates(zone.lat, zone.lng)}</a></td>
                        <td data-label="Created">{dateLabel(zone.created_at)}</td>
                        <td className="admin-id" data-label="Record ID">{zone.id}</td>
                        <td className="admin-actions" data-label="Actions">
                          <button onClick={() => setEditor({ kind: 'zone', record: zone })} type="button">Edit</button>
                          <button className="is-delete" disabled={loading} onClick={() => void deleteRecord('zone', zone.id, `${zone.severity} zone`)} type="button">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredZones.length === 0 && <p className="admin-empty">No zones match this filter.</p>}
              </div>
            )}
          </section>
        </>
      )}
      {editor && (
        <AdminRecordEditor
          apiKey={apiKey}
          onClose={() => setEditor(null)}
          onSaved={finishSave}
          target={editor}
        />
      )}
    </main>
  );
}
