import { Group, Table, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';
import type { ReactNode } from 'react';

export default function SortTh({ field, sort, order, onSort, children, w }: {
  field: string; sort: string; order: 'asc' | 'desc'; onSort: (f: string) => void; children: ReactNode; w?: number | string;
}) {
  const active = sort === field;
  const Icon = active ? (order === 'asc' ? IconChevronUp : IconChevronDown) : IconSelector;
  return (
    <Table.Th w={w}>
      <UnstyledButton onClick={() => onSort(field)} aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <Group gap={4} wrap="nowrap">
          <Text fw={600} size="sm">{children}</Text>
          <Icon size={14} stroke={1.8} opacity={active ? 1 : 0.5} />
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}
