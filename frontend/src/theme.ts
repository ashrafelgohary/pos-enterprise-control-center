import { createTheme, type MantineColorsTuple } from '@mantine/core';

const brand: MantineColorsTuple = [
  '#eef4ff', '#dbe6ff', '#b4caff', '#8aacfd', '#6892fb', '#5282fa', '#4479fa', '#3567df', '#2b5bc8', '#1c4eb1',
];

export const theme = createTheme({
  primaryColor: 'brand',
  colors: { brand },
  primaryShade: { light: 7, dark: 5 },
  defaultRadius: 'md',
  fontFamily: "Inter, 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', 'Cascadia Code', Consolas, 'Liberation Mono', monospace",
  headings: { fontWeight: '650' },
  components: {
    Card: { defaultProps: { withBorder: true, radius: 'lg', shadow: 'xs' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Badge: { defaultProps: { radius: 'sm' } },
    Table: { defaultProps: { verticalSpacing: 'sm', highlightOnHover: true } },
    Modal: { defaultProps: { radius: 'lg', centered: true, overlayProps: { backgroundOpacity: 0.45, blur: 2 } } },
    Tooltip: { defaultProps: { withArrow: true } },
  },
});
