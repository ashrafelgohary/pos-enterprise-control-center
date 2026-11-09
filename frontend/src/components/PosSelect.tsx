import { Select } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '@/api/client';
import type { Pos, PosRef } from '@/api/types';

/** Async, server-filtered POS picker used for manual XML -> POS matching. */
export default function PosSelect({ value, onChange, disabled }: {
  value: PosRef | null; onChange: (p: PosRef | null) => void; disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 250);
  const { data, isFetching } = useQuery({
    queryKey: ['pos', 'lookup', debounced],
    queryFn: async () => (await api.get<Pos[]>('/pos/lookup', { params: { q: debounced } })).data,
    enabled: debounced.length > 0,
    staleTime: 30_000,
  });

  const options = useMemo(() => {
    const map = new Map<string, PosRef>();
    if (value) map.set(String(value.id), value);
    data?.forEach((p) => map.set(String(p.id), { id: p.id, hostname: p.hostname, ip_address: p.ip_address, store_name: p.store_name }));
    return map;
  }, [data, value]);

  return (
    <Select
      size="xs" w={220} searchable clearable disabled={disabled} placeholder="Search POS…"
      value={value ? String(value.id) : null}
      data={[...options.values()].map((p) => ({ value: String(p.id), label: `${p.hostname} · ${p.ip_address}` }))}
      searchValue={search} onSearchChange={setSearch}
      filter={({ options: o }) => o}
      nothingFoundMessage={debounced ? (isFetching ? 'Searching…' : 'No POS found') : 'Type to search'}
      onChange={(v) => onChange(v ? options.get(v) ?? null : null)}
      comboboxProps={{ withinPortal: true }}
    />
  );
}
