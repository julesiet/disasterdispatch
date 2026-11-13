import { useEffect, useState } from 'react';

export type HeatmapPayload = {
  zones: GeoJSON.FeatureCollection;
  grid: GeoJSON.FeatureCollection;
};

export type StreamStatus = 'connecting' | 'connected' | 'reconnecting';

export function useHeatmapStream() {
  const [data, setData] = useState<HeatmapPayload | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    const source = new EventSource('/api/v1/heatmap/stream');

    const handleUpdate = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as HeatmapPayload;
        if (!payload.zones?.features || !payload.grid?.features) return;
        setData(payload);
        setStatus('connected');
      } catch {
        // Ignore malformed messages and keep the connection available for the next update.
      }
    };

    source.addEventListener('open', () => setStatus('connected'));
    source.addEventListener('error', () => setStatus('reconnecting'));
    source.addEventListener('heatmap-update', handleUpdate as EventListener);

    return () => source.close();
  }, []);

  return { data, status };
}
