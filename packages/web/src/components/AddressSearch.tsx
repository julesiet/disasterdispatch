import { useState } from 'react';

export type GeocodedAddress = { lat: number; lng: number; label: string };

type PhotonFeature = {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
};

type PhotonResult = {
  features?: PhotonFeature[];
};

function formatAddress(properties: Record<string, unknown> = {}): string {
  const street = [properties['housenumber'], properties['street']]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
  const parts = [
    properties['name'],
    street,
    properties['city'] ?? properties['district'] ?? properties['county'],
    properties['state'],
    properties['postcode'],
    properties['country'],
  ].filter((part): part is string => typeof part === 'string' && part.length > 0);
  return [...new Set(parts)].join(', ');
}

export default function AddressSearch({
  id,
  label,
  placeholder = 'Enter an address, place, or intersection',
  onSelect,
  onQueryChange,
}: {
  id: string;
  label: string;
  placeholder?: string;
  onSelect: (location: GeocodedAddress) => void;
  onQueryChange?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodedAddress[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const search = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const searchText = query.trim();
    if (!searchText) {
      setError('Enter an address or place to search.');
      setResults([]);
      return;
    }

    setSearching(true);
    setError('');
    setResults([]);
    try {
      const params = new URLSearchParams({ q: searchText, limit: '5', lang: 'en' });
      const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`);
      if (!response.ok) throw new Error('Address search is temporarily unavailable.');
      const data = (await response.json()) as PhotonResult;
      const matches = (data.features ?? []).flatMap((feature) => {
        const coordinates = feature.geometry?.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
        const [lng, lat] = coordinates;
        if (typeof lat !== 'number' || typeof lng !== 'number') return [];
        const label = formatAddress(feature.properties);
        return label ? [{ lat, lng, label }] : [];
      });
      setResults(matches);
      if (matches.length === 0) setError('No matching places found. Try adding a city or region.');
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Address search failed. Try again.');
    } finally {
      setSearching(false);
    }
  };

  const choose = (result: GeocodedAddress) => {
    setQuery(result.label);
    setResults([]);
    setError('');
    onSelect(result);
  };

  return (
    <div className="address-search">
      <form className="address-search__form" onSubmit={search}>
        <label htmlFor={id}>{label}</label>
        <div className="address-search__controls">
          <input
            autoComplete="street-address"
            id={id}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults([]);
              setError('');
              onQueryChange?.();
            }}
            placeholder={placeholder}
            value={query}
          />
          <button className="console-button" disabled={searching} type="submit">
            {searching ? 'Searching…' : 'Find'}
          </button>
        </div>
      </form>
      <p className="address-search__privacy">
        Search is sent to Photon using OpenStreetMap data. Use a nearby landmark if you prefer not to share an exact address.
      </p>
      {error && <p className="console-error" role="alert">{error}</p>}
      {results.length > 0 && (
        <div className="address-search__results" aria-label="Matching places">
          {results.map((result) => (
            <button
              className="address-search__result"
              key={`${result.label}:${result.lat}:${result.lng}`}
              onClick={() => choose(result)}
              type="button"
            >
              {result.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
