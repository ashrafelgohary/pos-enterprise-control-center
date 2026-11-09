import { Group, Pagination, Select, Text } from '@mantine/core';

export default function TableFooter({ page, pageSize, total, onPage, onPageSize, sizes = [25, 50, 100] }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize?: (s: number) => void; sizes?: number[];
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <Group justify="space-between" p="md" wrap="wrap" gap="sm">
      <Group gap="sm">
        <Text size="sm" c="dimmed">Showing {from}–{to} of {total}</Text>
        {onPageSize && (
          <Select size="xs" w={110} value={String(pageSize)} allowDeselect={false}
            data={sizes.map((s) => ({ value: String(s), label: `${s} / page` }))}
            onChange={(v) => v && onPageSize(Number(v))} />
        )}
      </Group>
      <Pagination size="sm" total={pages} value={Math.min(page, pages)} onChange={onPage} withEdges />
    </Group>
  );
}
