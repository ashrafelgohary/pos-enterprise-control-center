export interface DeploymentEmailPreview {
  ready: boolean;
  to: string[];
  cc: string[];
  subject: string;
  body_text: string;
  body_html: string;
  warning: string | null;
  store_id: number | null;
  configuration_url: string | null;
  details: Record<string, string>;
}

export interface EditableEmail {
  to: string;
  cc: string;
  subject: string;
  body: string;
}
